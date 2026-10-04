import type {Document,Operation,Span,Token,View} from './contracts';
import {esc,field,formValues} from './dom';
export function tokenInspector(view:View,doc:Document,token:Token,onSave:(operations:Operation[],label:string,source?:HTMLFormElement)=>Promise<void>,onDirty:()=>void):HTMLElement {
  const section=document.createElement('section');
  const options=Object.entries(view.snapshot.config.language_values).map(([v,d])=>`<option value="${esc(v)}">${esc(d||v)}</option>`).join('');
  section.innerHTML=`<h2>Token ${esc(token.id)}</h2><p class="original">Original ASR / source<br><strong>${esc(token.original)}</strong></p><p class="muted">${token.start_us===null||token.end_us===null?'No complete word timing. Listen to its utterance.':'Observed word timing.'}</p><form id="token-form">
    ${field('nform','Human-corrected reading',token.corrected??'',token.original)}
    ${field('wb_normalized','Optional normalized reading',token.normalized??'')}
    <label>Language / variety<input name="variety" value="${esc(token.attrs.variety??'')}" list="language-values" autocomplete="off"></label><datalist id="language-values">${options}</datalist>
    <p class="muted">Effective: ${esc(token.language_effective??'unknown')} · ${esc(token.language_source)} · definition v${view.snapshot.config.version}</p>
    ${field('annotation','Custom annotation',token.attrs.annotation??'')}${field('note','Reviewer note',token.attrs.note??'')}
    ${field('revision_label','Revision name','Correct '+token.id)}
    <div class="actions"><button type="submit" id="save-token">Save token</button><button type="reset" class="secondary">Undo unsaved edits</button></div>
  </form><details><summary>All imported attributes</summary><pre>${esc(JSON.stringify(token.attrs,null,2))}</pre></details>`;
  const form=section.querySelector('form')!;
  const initial=formValues(form);
  if(token.attrs.wb_normalized_status==='unresolved'){
    const note=document.createElement('p');note.className='notice';note.textContent='The retained normalized reading needs confirmation after the correction.';
    const confirm=document.createElement('button');confirm.type='button';confirm.className='secondary';confirm.textContent='Confirm retained normalized reading';
    confirm.onclick=()=>void onSave([{kind:'set_token',document:doc.path,token:token.id,fields:{wb_normalized:token.normalized??''}}],`Confirm normalized reading: ${token.id}`);
    section.append(note,confirm);
  }
  if(!token.editable){form.querySelectorAll('input,button').forEach(i=>(i as HTMLInputElement).disabled=true);section.insertAdjacentHTML('afterbegin','<p class="notice">Nested token preserved read-only. Safe editing is a later gate.</p>')}
  const updateDirty=()=>{form.dataset.dirty=String(['nform','wb_normalized','variety','annotation','note'].some(key=>formValues(form)[key]!==initial[key]));onDirty()};
  form.addEventListener('input',updateDirty);
  form.addEventListener('reset',()=>setTimeout(updateDirty));
  form.addEventListener('submit',async event=>{
    event.preventDefault();const values=formValues(form);const fields:Record<string,string>={};
    for(const key of ['nform','wb_normalized','variety','annotation','note']) if(values[key]!==initial[key]) fields[key]=values[key];
    if(!Object.keys(fields).length)return;
    await onSave([{kind:'set_token',document:doc.path,token:token.id,fields}],values.revision_label||'Correct token',form);
  });return section;
}
export function annotationInspector(view:View,doc:Document,selected:string[],onSave:(operations:Operation[],label:string,source?:HTMLFormElement)=>Promise<void>,onDirty:()=>void):HTMLElement {
  const section=document.createElement('section');
  section.innerHTML=`<h2>Annotate selection</h2><p>${selected.length} selected: ${esc(selected.join(', '))}</p><p class="muted">Shift-click selects a range. Ctrl / Command-click selects discontinuous tokens.</p>
    <form id="span-form">${field('label','Span label')}${field('variety','Language / variety')}${field('note','Note')}
    <details><summary>Subtoken judgment (one token)</summary><p class="muted">Offsets count Unicode code points in the corrected reading.</p>${field('start','Start code point')}${field('end','End code point')}${field('quote','Exact quote')}</details>
    <button type="submit" ${selected.length?'':'disabled'}>Create span</button></form>
    <h3>Directed relation</h3><form id="relation-form">${field('target','Target token ID',selected[1]??'')}${field('relation_type','Relation type')}${field('note','Relation note')}<button type="submit" ${selected.length?'':'disabled'}>Create relation</button></form>
    <h3>Saved spans</h3><div>${doc.spans.map((s,i)=>`<article class="annotation"><strong>${esc(s.id)}</strong><p class="muted">${esc(s.sidecar)}</p><p>${esc(s.token_ids.join(' → '))}</p><pre>${esc(JSON.stringify(s.fields,null,2))}</pre><button type="button" class="secondary" data-edit-span="${i}">Edit span ${esc(s.id)}</button><div data-span-editor="${i}"></div></article>`).join('')||'<p class="muted">No supported spans yet.</p>'}</div>
    <h3>Saved relations</h3>${doc.tokens.filter(t=>t.attrs.relation_target).map(t=>`<article class="annotation"><p>${esc(t.id)} → ${esc(t.attrs.relation_target)} · ${esc(t.attrs.relation_type)}</p><button type="button" class="secondary" data-edit-relation="${esc(t.id)}">Edit relation from ${esc(t.id)}</button><button type="button" class="secondary" data-clear-relation="${esc(t.id)}">Clear relation from ${esc(t.id)}</button><div data-relation-editor="${esc(t.id)}"></div></article>`).join('')||'<p class="muted">No relations yet.</p>'}`;
  const dirty=(event:Event)=>{const form=(event.target as HTMLElement).closest("form");if(form){form.dataset.dirty="true";onDirty()}};section.addEventListener("input",dirty);section.addEventListener("change",dirty);
  section.querySelector<HTMLFormElement>('#span-form')!.onsubmit=async e=>{e.preventDefault();const v=formValues(e.currentTarget as HTMLFormElement);await onSave([{kind:'add_span',document:doc.path,id:`an-${crypto.randomUUID()}`,token_ids:selected,fields:{label:v.label,variety:v.variety,note:v.note},character:v.start!==''?{token:selected[0],start:Number(v.start),end:Number(v.end),quote:v.quote,coordinate:'unicode-codepoint',layer:'corrected'}:null}],`Create span: ${v.label}`,e.currentTarget as HTMLFormElement)};
  section.querySelector<HTMLFormElement>('#relation-form')!.onsubmit=async e=>{e.preventDefault();const v=formValues(e.currentTarget as HTMLFormElement);await onSave([{kind:'add_relation',document:doc.path,from:selected[0],to:v.target,relation_type:v.relation_type,note:v.note}],`Relation: ${v.relation_type}`,e.currentTarget as HTMLFormElement)};
  section.querySelectorAll<HTMLButtonElement>('[data-edit-span]').forEach(button=>button.onclick=()=>{
    const index=Number(button.dataset.editSpan);const destination=section.querySelector(`[data-span-editor="${index}"]`)!;
    if(destination.childElementCount)return;destination.replaceChildren(spanEditor(doc,doc.spans[index],selected,onSave,onDirty));
  });
  section.querySelectorAll<HTMLButtonElement>('[data-edit-relation]').forEach(button=>button.onclick=()=>{
    const token=doc.tokens.find(t=>t.id===button.dataset.editRelation)!;
    const destination=[...section.querySelectorAll<HTMLElement>('[data-relation-editor]')].find(e=>e.dataset.relationEditor===token.id)!;
    if(destination.childElementCount)return;destination.replaceChildren(relationEditor(doc,token,onSave));
  });
  section.querySelectorAll<HTMLButtonElement>('[data-clear-relation]').forEach(button=>button.onclick=()=>void onSave([{kind:'clear_relation',document:doc.path,from:button.dataset.clearRelation!}],`Clear relation: ${button.dataset.clearRelation}`));
  return section;
}

function spanEditor(doc:Document,span:Span,selected:string[],onSave:(ops:Operation[],label:string,source?:HTMLFormElement)=>Promise<void>,onDirty:()=>void):HTMLElement {
  const section=document.createElement('section');section.innerHTML=`<h4>Edit ${esc(span.id)}</h4><p class="muted">Stable ID and supplied XML content remain intact. Anchors define the selection. Unsupported dialects stay read-only.</p><form class="span-edit-form">
    ${field('label','Saved span label',span.fields.label??'')}${field('variety','Saved span language / variety',span.fields.variety??'')}${field('note','Saved span note',span.fields.note??'')}
    <label>Anchor change<select name="anchor_mode"><option value="keep">Keep existing anchors</option><option value="tokens">Whole-token anchors</option><option value="character">Subtoken anchor</option></select></label>
    ${field('token_ids','Token IDs in order',span.token_ids.join(' '))}<button type="button" class="secondary use-selected" ${selected.length?'':'disabled'}>Use selected tokens</button>
    ${field('start','Saved start code point',span.fields.wb_start??'')}${field('end','Saved end code point',span.fields.wb_end??'')}${field('quote','Saved exact quote',span.fields.wb_quote??'')}
    <p class="muted">Subtoken coordinates count Unicode code points in the corrected reading. Whole-token mode removes character coordinates; keeping anchors retains any unresolved status.</p><p class="editor-error error" role="alert"></p><button type="submit">Save span changes</button></form>`;
  const form=section.querySelector('form')!;const initial=formValues(form);
  section.querySelector<HTMLButtonElement>('.use-selected')!.onclick=()=>{form.querySelector<HTMLInputElement>('[name="token_ids"]')!.value=selected.join(' ');form.querySelector<HTMLSelectElement>('[name="anchor_mode"]')!.value='tokens';form.dataset.dirty='true';onDirty()};
  form.onsubmit=async event=>{
    event.preventDefault();const v=formValues(form);const fields:Record<string,string>={};
    for(const key of ['label','variety','note'])if(v[key]!==initial[key])fields[key]=v[key];
    const token_ids=v.token_ids.trim().split(/\s+/).filter(Boolean);let anchor:Extract<Operation,{kind:'set_span'}>['anchor']=null;
    if(v.anchor_mode==='tokens')anchor={kind:'tokens',token_ids};
    if(v.anchor_mode==='character'){
      if(token_ids.length!==1||v.start===''||v.end===''||!Number.isSafeInteger(Number(v.start))||!Number.isSafeInteger(Number(v.end))){section.querySelector('.editor-error')!.textContent='Subtoken anchors require one token ID and integer start/end coordinates.';return}
      anchor={kind:'character',anchor:{token:token_ids[0],start:Number(v.start),end:Number(v.end),quote:v.quote,coordinate:'unicode-codepoint',layer:'corrected'}};
    }
    if(!Object.keys(fields).length&&anchor===null)return;
    await onSave([{kind:'set_span',document:doc.path,sidecar:span.sidecar,id:span.id,fields,anchor}],`Edit span: ${span.id}`,form);
  };return section;
}
function relationEditor(doc:Document,token:Token,onSave:(ops:Operation[],label:string,source?:HTMLFormElement)=>Promise<void>):HTMLElement {
  const section=document.createElement('section');section.innerHTML=`<h4>Edit relation from ${esc(token.id)}</h4><p class="muted">Clearing a relation preserves the token's note and identity.</p><form>${field('target','Saved relation target',token.attrs.relation_target??'')}${field('relation_type','Saved relation type',token.attrs.relation_type??'')}${field('note','Saved relation note',token.attrs.note??'')}<button>Save relation changes</button></form>`;
  const form=section.querySelector('form')!;const initial=formValues(form);
  form.onsubmit=async event=>{event.preventDefault();const v=formValues(form);if(v.target===initial.target&&v.relation_type===initial.relation_type&&v.note===initial.note)return;await onSave([{kind:'set_relation',document:doc.path,from:token.id,to:v.target,relation_type:v.relation_type,note:v.note===initial.note?null:v.note}],`Edit relation: ${token.id}`,form)};return section;
}
