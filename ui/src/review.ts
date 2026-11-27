import {h, renderInto} from './effect-view';
import {api} from './api';
import type {Revision,RevisionReviews,ReviewRecord,View} from './contracts';
const decisionNames:Record<ReviewRecord['decision'],string>={approved:'Approved exact revision',rejected:'Rejected','needs-adjudication':'Needs adjudication'};

// Each response is checked against a captured immutable revision. Browsing old
// decisions never changes the revision of the separate current-review form.
export function reviewInspector(view:View):HTMLElement {
  const section=document.createElement('section');section.className='review-panel';
  renderInto(section,
    h.h2('Review exact R', String(view.revision.id)),
    h.p.id('review-current-status').attrs({role: 'status'}).children('Loading current decision…'),
    h.p.class('muted').children('Full package scope · solo self-review. A later edit requires new review.'),
    h.div
    .class('revision-basis')
    .children(
      h.strong('R', String(view.revision.id), ' · ', view.revision.label),
      h.details(
        h.summary(
          String(Object.keys(view.snapshot.files).length),
          ' files · ',
          String(view.documents.length),
          ' documents · snapshot',
        ),
        h.code(view.revision.snapshot_hash),
      ),
    ),
    h.details
    .class('review-validation')
    .attrs({open: view.issues.some((i) => i.blocking) ? '' : undefined})
    .children(
      h.summary(
        'Validation · ',
        String(view.issues.filter((i) => i.blocking).length),
        ' blocking · ',
        String(view.issues.filter((i) => !i.blocking).length),
        ' advisory',
      ),
      h.p
        .class('muted')
        .children('Approval covers this transcript, sidecars, definitions, settings and media hashes.'),
      h.ul(
        view.issues.length
          ? view.issues.map((i) =>
              h.li
                .class(i.blocking ? 'error' : '')
                .children(i.target, ': ', i.message, ' ', i.blocking ? '(blocks approval)' : ''),
            )
          : h.li('No validation issues.'),
      ),
    ),
    h.form
    .id('review-form')
    .children(
      h.label(
        'Decision',
        h.select
          .attrs({name: 'decision'})
          .children(
            h.option.attrs({value: 'approved'}).children('Approve exact revision'),
            h.option.attrs({value: 'rejected'}).children('Reject'),
            h.option.attrs({value: 'needs-adjudication'}).children('Needs adjudication'),
          ),
      ),
      h.label(
        'Review rationale',
        h.textarea.attrs({
          name: 'note',
          rows: '3',
          placeholder: 'What did you check or what needs attention?',
        }),
      ),
      h.button('Record review'),
    ),
    h.div
    .class('review-history-heading')
    .children(h.h3('Decision history'), h.span.class('muted').children('Read-only')),
    h.label(
      'Decision history for',
      h.select
        .id('review-history-revision')
        .attrs({disabled: ''})
        .children(
          h.option
            .attrs({value: String(view.revision.id)})
            .children('R', String(view.revision.id), ' · ', view.revision.label, ' · current'),
        ),
    ),
    h.p.id('review-revisions-status').class('muted').attrs({role: 'status'}),
    h.button
    .id('retry-review-revisions')
    .class('secondary')
    .attrs({type: 'button', hidden: ''})
    .children('Retry revision list'),
    h.div
    .id('review-history')
    .attrs({'aria-busy': 'true'})
    .children(h.p.attrs({role: 'status'}).children('Loading review history…')),
    h.button
    .id('retry-review-history')
    .class('secondary')
    .attrs({type: 'button', hidden: ''})
    .children('Retry review history'),
    h.div
    .class('review-contract')
    .children(
      h.button
        .id('compiler-contract')
        .class('secondary')
        .attrs({type: 'button', disabled: ''})
        .children('Inspect approved export contract'),
      h.pre.id('contract-preview'),
    ),
  );
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
  const recordRow=(record:ReviewRecord,latest=false)=>h.li
    .attrs({'data-review-id': String(record.id)})
    .children(
      h.div
        .class('review-record-heading')
        .children(
          h.strong(decisionNames[record.decision]),
          latest ? h.span.class('review-latest').children('Latest') : '',
        ),
      h.p
        .class('review-record-meta')
        .children(
          record.actor,
          ' · ',
          record.self_review ? 'solo self-review' : 'reviewer',
          ' · ',
          record.scope === 'full' ? 'full package' : record.scope,
          h.br,
          h.time.attrs({datetime: record.created_at}).children(record.created_at),
        ),
      h.p
        .class('review-rationale ' + (record.note ? '' : 'muted'))
        .children(record.note ? record.note : 'No rationale recorded.'),
    );
  async function loadHistory(){
    const request=++epoch;const revision=Number(selector.value);const expected=revisions.find(r=>r.id===revision)!;
    if(revision===view.revision.id)currentEpoch=request;
    history.setAttribute('aria-busy','true');renderInto(history, h.p.attrs({role: 'status'}).children('Loading review history…'));retry.hidden=true;
    try{
      const result=await api<RevisionReviews>(`/api/reviews?revision=${revision}`);
      if(result.revision!==expected.id||result.snapshot_hash!==expected.snapshot_hash||!Array.isArray(result.reviews)||result.reviews.some(r=>r.revision!==expected.id||r.snapshot_hash!==expected.snapshot_hash||!Object.hasOwn(decisionNames,r.decision)))throw new Error('Review history does not match the requested exact revision.');
      if(revision===view.revision.id&&request===currentEpoch)currentStatus(result.reviews);
      if(request!==epoch)return;
      renderInto(history,
        h.p
        .class('review-history-context')
        .attrs({role: 'status'})
        .children(
          revision === view.revision.id
            ? `Current R${revision}`
            : `Historical R${revision} · current review remains R${view.revision.id}`,
          ' · ',
          String(result.reviews.length),
          ' ',
          result.reviews.length === 1 ? 'decision' : 'decisions',
        ),
        h.ol
        .class('review-records')
        .children(
          result.reviews[0]
            ? recordRow(result.reviews[0], true)
            : h.li.class('empty-state').children('No review decisions recorded for this exact revision.'),
        ),
        result.reviews.length > 1
        ? h.details.class('review-earlier').children(
            h.summary('Earlier decisions (', String(result.reviews.length - 1), ')'),
            h.ol
              .class('review-records')
              .attrs({start: '2'})
              .children(result.reviews.slice(1).map((record) => recordRow(record))),
          )
        : '',
      );
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
      revisions=available;const selected=selector.value;renderInto(selector,
        revisions.map((r) =>
          h.option
            .attrs({value: String(r.id)})
            .children('R', String(r.id), ' · ', r.label, r.id === view.revision.id ? ' · current' : ''),
        ),
      );selector.value=selected;selector.disabled=false;revisionStatus.textContent='';
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
