import type {Document,Operation,Token,View} from './contracts';
import {esc,field,formValues} from './dom';
export function tokenInspector(view:View,doc:Document,token:Token,onSave:(operations:Operation[],label:string)=>Promise<void>,onDirty:()=>void):HTMLElement {
  const section=document.createElement('section');
  const options=Object.entries(view.snapshot.config.language_values).map(([v,d])=>`<option value="${esc(v)}">${esc(d||v)}</option>`).join('');
  section.innerHTML=`<h2>Token ${esc(token.id)}</h2><p class="original">Original ASR / source<br><strong>${esc(token.original)}</strong></p><p class="muted">${token.start_us===null?'No word timing. Listen to its utterance.':'Observed word timing.'}</p><form id="token-form">
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
  form.addEventListener('input',onDirty);
  form.addEventListener('reset',()=>setTimeout(onDirty));
  form.addEventListener('submit',async event=>{
    event.preventDefault();const values=formValues(form);const fields:Record<string,string>={};
    for(const key of ['nform','wb_normalized','variety','annotation','note']) if(values[key]!==initial[key]) fields[key]=values[key];
    if(!Object.keys(fields).length)return;
    await onSave([{kind:'set_token',document:doc.path,token:token.id,fields}],values.revision_label||'Correct token');
  });return section;
}
export function annotationInspector(view:View,doc:Document,selected:string[],onSave:(operations:Operation[],label:string)=>Promise<void>):HTMLElement {
  const section=document.createElement('section');
  section.innerHTML=`<h2>Annotate selection</h2><p>${selected.length} selected: ${esc(selected.join(', '))}</p><p class="muted">Shift-click selects a range. Ctrl / Command-click selects discontinuous tokens.</p>
    <form id="span-form">${field('label','Span label')}${field('variety','Language / variety')}${field('note','Note')}
    <details><summary>Subtoken judgment (one token)</summary><p class="muted">Offsets count Unicode code points in the corrected reading.</p>${field('start','Start code point')}${field('end','End code point')}${field('quote','Exact quote')}</details>
    <button type="submit" ${selected.length?'':'disabled'}>Create span</button></form>
    <h3>Directed relation</h3><form id="relation-form">${field('target','Target token ID',selected[1]??'')}${field('relation_type','Relation type')}${field('note','Relation note')}<button type="submit" ${selected.length?'':'disabled'}>Create relation</button></form>
    <h3>Saved spans</h3><div>${doc.spans.map(s=>`<article class="annotation"><strong>${esc(s.id)}</strong><p>${esc(s.token_ids.join(' → '))}</p><pre>${esc(JSON.stringify(s.fields,null,2))}</pre></article>`).join('')||'<p class="muted">No supported spans yet.</p>'}</div>
    <h3>Saved relations</h3>${doc.tokens.filter(t=>t.attrs.relation_target).map(t=>`<p>${esc(t.id)} → ${esc(t.attrs.relation_target)} · ${esc(t.attrs.relation_type)}</p>`).join('')||'<p class="muted">No relations yet.</p>'}`;
  section.querySelector<HTMLFormElement>('#span-form')!.onsubmit=async e=>{e.preventDefault();const v=formValues(e.currentTarget as HTMLFormElement);await onSave([{kind:'add_span',document:doc.path,id:`an-${crypto.randomUUID()}`,token_ids:selected,fields:{label:v.label,variety:v.variety,note:v.note},character:v.start!==''?{token:selected[0],start:Number(v.start),end:Number(v.end),quote:v.quote,coordinate:'unicode-codepoint',layer:'corrected'}:null}],`Create span: ${v.label}`)};
  section.querySelector<HTMLFormElement>('#relation-form')!.onsubmit=async e=>{e.preventDefault();const v=formValues(e.currentTarget as HTMLFormElement);await onSave([{kind:'add_relation',document:doc.path,from:selected[0],to:v.target,relation_type:v.relation_type,note:v.note}],`Relation: ${v.relation_type}`)};
  return section;
}
