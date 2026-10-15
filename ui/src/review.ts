import {api} from './api';
import type {Revision,RevisionReviews,ReviewRecord,View} from './contracts';
import {esc} from './dom';

const decisionNames:Record<ReviewRecord['decision'],string>={approved:'Approved exact revision',rejected:'Rejected','needs-adjudication':'Needs adjudication'};

// Each response is checked against a captured immutable revision. Browsing old
// decisions never changes the revision of the separate current-review form.
export function reviewInspector(view:View):HTMLElement {
  const section=document.createElement('section');section.className='review-panel';
  section.innerHTML=`<h2>Review exact R${view.revision.id}</h2>
    <p id="review-current-status" role="status">Loading current decision…</p>
    <p class="muted">Full package scope · solo self-review. A later edit requires new review.</p>
    <div class="revision-basis"><strong>R${view.revision.id} · ${esc(view.revision.label)}</strong><details><summary>${Object.keys(view.snapshot.files).length} files · ${view.documents.length} documents · snapshot</summary><code>${esc(view.revision.snapshot_hash)}</code></details></div>
    <details class="review-validation" ${view.issues.some(i=>i.blocking)?'open':''}><summary>Validation · ${view.issues.filter(i=>i.blocking).length} blocking · ${view.issues.filter(i=>!i.blocking).length} advisory</summary>
      <p class="muted">Approval covers this transcript, sidecars, definitions, settings and media hashes.</p>
      <ul>${view.issues.map(i=>`<li class="${i.blocking?'error':''}">${esc(i.target)}: ${esc(i.message)} ${i.blocking?'(blocks approval)':''}</li>`).join('')||'<li>No validation issues.</li>'}</ul></details>
    <div class="review-history-heading"><h3>Decision history</h3><span class="muted">Read-only</span></div>
    <label>Decision history for<select id="review-history-revision" disabled><option value="${view.revision.id}">R${view.revision.id} · ${esc(view.revision.label)} · current</option></select></label>
    <p id="review-revisions-status" class="muted" role="status"></p><button id="retry-review-revisions" type="button" class="secondary" hidden>Retry revision list</button>
    <div id="review-history" aria-busy="true"><p role="status">Loading review history…</p></div>
    <button id="retry-review-history" type="button" class="secondary" hidden>Retry review history</button>
    <form id="review-form"><label>Decision<select name="decision"><option value="approved">Approve exact revision</option><option value="rejected">Reject</option><option value="needs-adjudication">Needs adjudication</option></select></label>
      <label>Review rationale<textarea name="note" rows="3" placeholder="What did you check or what needs attention?"></textarea></label><button>Record review</button></form>
    <div class="review-contract"><button id="compiler-contract" type="button" class="secondary" disabled>Inspect approved export contract</button><pre id="contract-preview"></pre></div>`;
  const status=section.querySelector<HTMLElement>('#review-current-status')!;
  const history=section.querySelector<HTMLElement>('#review-history')!;
  const selector=section.querySelector<HTMLSelectElement>('#review-history-revision')!;
  const retry=section.querySelector<HTMLButtonElement>('#retry-review-history')!;
  const revisionStatus=section.querySelector<HTMLElement>('#review-revisions-status')!;
  const retryRevisions=section.querySelector<HTMLButtonElement>('#retry-review-revisions')!;
  const contract=section.querySelector<HTMLButtonElement>('#compiler-contract')!;
  let revisions:Revision[]=[view.revision];let epoch=0;let optionsEpoch=0;let currentEpoch=0;
  const currentStatus=(reviews:ReviewRecord[])=>{
    const latest=reviews.find(record=>record.scope==='full');status.textContent=latest?decisionNames[latest.decision]:'Unreviewed · no decision recorded';
    status.dataset.decision=latest?.decision??'unreviewed';
    contract.disabled=latest?.decision!=='approved';
  };
  const recordRow=(record:ReviewRecord,latest=false)=>`<li data-review-id="${record.id}"><div class="review-record-heading"><strong>${esc(decisionNames[record.decision])}</strong>${latest?'<span class="review-latest">Latest</span>':''}</div>
    <p class="review-record-meta">${esc(record.actor)} · ${record.self_review?'solo self-review':'reviewer'} · ${esc(record.scope==='full'?'full package':record.scope)}<br><time datetime="${esc(record.created_at)}">${esc(record.created_at)}</time></p>
    <p class="review-rationale ${record.note?'':'muted'}">${record.note?esc(record.note):'No rationale recorded.'}</p></li>`;
  async function loadHistory(){
    const request=++epoch;const revision=Number(selector.value);const expected=revisions.find(r=>r.id===revision)!;
    if(revision===view.revision.id)currentEpoch=request;
    history.setAttribute('aria-busy','true');history.innerHTML='<p role="status">Loading review history…</p>';retry.hidden=true;
    try{
      const result=await api<RevisionReviews>(`/api/reviews?revision=${revision}`);
      if(result.revision!==expected.id||result.snapshot_hash!==expected.snapshot_hash||!Array.isArray(result.reviews)||result.reviews.some(r=>r.revision!==expected.id||r.snapshot_hash!==expected.snapshot_hash||!Object.hasOwn(decisionNames,r.decision)))throw new Error('Review history does not match the requested exact revision.');
      if(revision===view.revision.id&&request===currentEpoch)currentStatus(result.reviews);
      if(request!==epoch)return;
      history.innerHTML=`<p class="review-history-context" role="status">${revision===view.revision.id?`Current R${revision}`:`Historical R${revision} · current review remains R${view.revision.id}`} · ${result.reviews.length} ${result.reviews.length===1?'decision':'decisions'}</p>
        <ol class="review-records">${result.reviews[0]?recordRow(result.reviews[0],true):'<li class="empty-state">No review decisions recorded for this exact revision.</li>'}</ol>
        ${result.reviews.length>1?`<details class="review-earlier"><summary>Earlier decisions (${result.reviews.length-1})</summary><ol class="review-records" start="2">${result.reviews.slice(1).map(record=>recordRow(record)).join('')}</ol></details>`:''}`;
    }catch(error){
      if(revision===view.revision.id&&request===currentEpoch){status.textContent='Current decision unavailable';delete status.dataset.decision;contract.disabled=true;}
      if(request!==epoch)return;
      history.replaceChildren();const message=document.createElement('p');message.className='error';message.setAttribute('role','alert');message.textContent=`Could not load decision history for R${revision}. ${String(error)}`;history.append(message);retry.hidden=false;
    }finally{if(request===epoch)history.setAttribute('aria-busy','false');}
  }
  async function loadOptions(){
    const request=++optionsEpoch;retryRevisions.hidden=true;revisionStatus.textContent='Loading revision list…';
    try{
      const result=await api<Revision[]>('/api/history');
      if(request!==optionsEpoch)return;
      // The current view may be older than another writer's head. Only expose
      // revisions at or before this captured view; approval still uses its hash.
      const available=result.filter(r=>r.id<=view.revision.id);
      if(!available.some(r=>r.id===view.revision.id&&r.snapshot_hash===view.revision.snapshot_hash))throw new Error('Current revision is absent from history.');
      revisions=available;const selected=selector.value;selector.innerHTML=revisions.map(r=>`<option value="${r.id}">R${r.id} · ${esc(r.label)}${r.id===view.revision.id?' · current':''}</option>`).join('');selector.value=selected;selector.disabled=false;revisionStatus.textContent='';
    }catch{
      if(request!==optionsEpoch)return;
      // Current-revision decisions remain useful if the revision index fails.
      revisionStatus.textContent='Historical revision list unavailable. Current decisions remain accessible.';retryRevisions.hidden=false;
    }
  }
  selector.onchange=()=>void loadHistory();
  retry.onclick=()=>void loadHistory();retryRevisions.onclick=()=>void loadOptions();
  void loadOptions();void loadHistory();return section;
}
