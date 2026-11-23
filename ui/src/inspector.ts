import './inspector-workflows.css';
import './token-drawer.css';
import './annotation-details.css';
import {annotationDetail} from './annotation-detail';
import type {Document, Operation, Span, Token, View} from './contracts';
import {esc, field, formValues, seconds} from './dom';
import {buttonGroup} from './controls';
import {icon} from './icons';

export function emptyTokenInspector(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'token-drawer-empty';
  section.innerHTML = `<div class="token-record-icon">${icon('book_2')}</div>
    <h2>Inspect a word</h2><p>Select a word in the transcript to review its readings, timing and source.</p>`;
  return section;
}

export function tokenInspector(
  view: View, doc: Document, token: Token,
  onSave: (operations: Operation[], label: string, source?: HTMLFormElement) => Promise<void>,
  onDirty: () => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'token-drawer';
  const options = Object.entries(view.snapshot.config.language_values).map(([value, description]) =>
    `<option value="${esc(value)}">${esc(description || value)}</option>`).join('');
  const turnIndex = doc.segments.findIndex(segment => segment.id === token.utterance);
  const wordTiming = token.start_us !== null && token.end_us !== null
    ? `${seconds(token.start_us)} – ${seconds(token.end_us)}`
    : token.start_us !== null ? `Starts at ${seconds(token.start_us)} · end unknown`
    : token.end_us !== null ? `Ends at ${seconds(token.end_us)} · start unknown` : 'No word timing';
  const languageSources: Record<string, string> = {
    'token/variety': 'Token attribute', 'ancestor/variety': 'Inherited from parent',
    'project/default': 'Project default', unknown: 'Unspecified',
  };
  const metadata = [
    ['Document', doc.path], ['Utterance', token.utterance ?? 'Unassigned'],
    ['Token ID', token.id], ['Word timing', wordTiming], ['Language', token.language_effective ?? 'Unspecified'],
    ['Language source', languageSources[token.language_source] ?? token.language_source],
    ['Definition version', String(view.snapshot.config.version)], ['Saved revision', 'R' + view.revision.id],
  ];
  const identity = `Source token ${esc(token.id)}${turnIndex < 0 ? '' : ` <span aria-hidden="true">·</span> Turn ${turnIndex + 1}`}`;
  const needsConfirmation = token.attrs.wb_normalized_status === 'unresolved';
  section.innerHTML = `
    <div class="token-record-heading">
      <div class="token-record-icon">${icon('book_2')}</div>
      <hgroup><h2 class="original" dir="auto">${esc(token.original) || 'Empty source token'}</h2><p>${identity}</p></hgroup>
    </div>
    <div class="token-record-switcher" role="tablist" aria-label="Token views">
      <button type="button" id="token-edit-tab" role="tab" aria-controls="token-edit-panel" aria-selected="true">${icon('edit_note')}Edit token</button>
      <button type="button" id="token-source-tab" role="tab" aria-controls="token-source-panel" aria-selected="false" tabindex="-1">${icon('description')}Source details</button>
    </div>
    <section id="token-edit-panel" role="tabpanel" aria-labelledby="token-edit-tab">
      <form id="token-form">
        <fieldset><legend>Readings</legend>
          ${field('nform', 'Human-corrected reading', token.corrected ?? '', token.original)}
          ${field('wb_normalized', 'Optional normalized reading', token.normalized ?? '')}
          ${needsConfirmation ? '<div class="token-confirmation"><p>Review the normalized reading after the correction.</p><button type="button" class="secondary">Confirm retained normalized reading</button></div>' : ''}
          <label>Language / variety<input name="variety" value="${esc(token.attrs.variety ?? '')}" placeholder="${esc(token.language_effective ?? '')}" list="language-values" autocomplete="off"></label>
          <datalist id="language-values">${options}</datalist>
        </fieldset>
        <fieldset><legend>Annotations</legend>
          ${field('annotation', 'Custom annotation', token.attrs.annotation ?? '')}
          ${field('note', 'Reviewer note', token.attrs.note ?? '')}
        </fieldset>
        <div class="token-revision">
          ${field('revision_label', 'Revision name', 'Correct ' + token.id)}
          <div class="token-save-actions">
            <button type="submit" id="save-token">${icon('check')}Save token</button>
            <button type="reset" class="secondary">Undo unsaved edits</button>
          </div>
        </div>
      </form>
    </section>
    <section id="token-source-panel" role="tabpanel" aria-labelledby="token-source-tab" tabindex="0" hidden>
      <h3>Source record</h3>
      <dl class="token-source-rows">${metadata.map(([name, value]) =>
        `<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
      <details><summary>All imported attributes</summary><pre>${esc(JSON.stringify(token.attrs, null, 2))}</pre></details>
    </section>`;

  const switcher = section.querySelector<HTMLElement>('[role="tablist"]')!;
  const tabs = Array.from(switcher.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  for (const tab of tabs) {
    tab.onclick = () => {
      for (const item of tabs) {
        const active = item === tab;
        item.setAttribute('aria-selected', String(active));
        item.tabIndex = active ? 0 : -1;
        section.querySelector<HTMLElement>('#' + item.getAttribute('aria-controls'))!.hidden = !active;
      }
    };
  }
  buttonGroup(switcher);

  const form = section.querySelector('form')!;
  const editableFields = ['nform', 'wb_normalized', 'variety', 'annotation', 'note'];
  const initial = formValues(form);
  const save = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const undo = form.querySelector<HTMLButtonElement>('[type="reset"]')!;
  save.disabled = true;
  undo.hidden = true;
  if (needsConfirmation) {
    form.querySelector<HTMLButtonElement>('.token-confirmation button')!.onclick = () =>
      void onSave([{kind: 'set_token', document: doc.path, token: token.id,
        fields: {wb_normalized: token.normalized ?? ''}}], `Confirm normalized reading: ${token.id}`);
  }
  if (!token.editable) {
    form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(input => input.disabled = true);
    form.insertAdjacentHTML('beforebegin', '<p class="token-read-only">This nested token is read-only.</p>');
  }
  const updateDirty = () => {
    const values = formValues(form);
    const dirty = token.editable && editableFields.some(key => values[key] !== initial[key]);
    form.dataset.dirty = String(dirty);
    save.disabled = !dirty;
    undo.hidden = !dirty;
    onDirty();
  };
  form.addEventListener('input', updateDirty);
  form.addEventListener('reset', () => setTimeout(updateDirty));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = formValues(form);
    const fields = Object.fromEntries(editableFields.filter(key => values[key] !== initial[key]).map(key => [key, values[key]]));
    if (!token.editable || !Object.keys(fields).length) return;
    await onSave([{kind: 'set_token', document: doc.path, token: token.id, fields}], values.revision_label || 'Correct token', form);
  });
  return section;
}
export function annotationInspector(view:View,doc:Document,selected:string[],onSave:(operations:Operation[],label:string,source?:HTMLFormElement)=>Promise<void>,onDirty:()=>void,onReveal?:(span:Span)=>void):HTMLElement {
  const section=document.createElement('section');
  section.className='annotation-drawer';
  const relations=doc.tokens.filter(token=>token.attrs.relation_target);
  section.innerHTML=`<hgroup class="annotation-heading"><h2>Annotations</h2><p dir="auto">${esc(doc.title)} <span>· R${view.revision.id}</span></p></hgroup>
    <details class="annotation-compose" ${selected.length?'open':''}><summary>${icon('edit_note')}Annotate selection${icon('expand_more')}</summary>
    <p class="annotation-selection">${selected.length ? `${selected.length} ${selected.length===1?'word':'words'} selected` : 'Select words in the transcript to create a span.'}</p>
    <form id="span-form">${field('label','Span label')}${field('variety','Language / variety')}${field('note','Note')}
    <details><summary>Subtoken judgment (one token)</summary><p class="muted">Offsets count Unicode code points in the corrected reading.</p>${field('start','Start code point')}${field('end','End code point')}${field('quote','Exact quote')}</details>
    <button type="submit" ${selected.length?'':'disabled'}>Create span</button></form></details>
    <h3 class="annotation-list-heading">Saved annotations <span>${doc.spans.length}</span></h3>
    <div class="annotation-list">${doc.spans.map((span,index)=>{
      const detail=annotationDetail(doc,span,view.snapshot.project);
      const caption = detail.quote && detail.title !== detail.kind ? `${detail.kind} · ${detail.title}` : detail.kind;
      return `<details class="annotation annotation-record" data-saved-annotation="${esc(span.id)}" data-sidecar="${esc(span.sidecar)}" ${doc.spans.length===1?'open':''}>
        <summary><span class="annotation-number">${index+1}</span><span class="annotation-summary">
          <strong dir="auto">${esc(detail.quote || detail.title)}</strong><small dir="auto">${esc(caption)}</small>
        </span>${icon('expand_more')}</summary>
        <div class="annotation-body">
          ${detail.note?`<p class="annotation-note" dir="auto">${esc(detail.note)}</p>`:''}
          <p class="annotation-source">${icon('menu_book')}<span dir="auto">${esc(detail.source)}</span></p>
          <div class="annotation-actions">
            ${onReveal && detail.tokenIds.length?`<button type="button" class="secondary" data-reveal-span="${index}">${icon('menu_book')}Show in transcript</button>`:''}
            <button type="button" class="secondary" data-edit-span="${index}" aria-label="Edit span ${esc(span.id)}">${icon('edit_note')}Edit span</button>
          </div>
          <div data-span-editor="${index}"></div>
          <details class="annotation-provenance"><summary>Source record</summary><dl>
            <dt>File</dt><dd>${esc(doc.path)}</dd><dt>Sidecar</dt><dd>${esc(span.sidecar)}</dd>
            <dt>Span ID</dt><dd>${esc(span.id)}</dd><dt>Tokens</dt><dd>${esc(span.token_ids.join(' → ')) || 'No token IDs supplied'}</dd>
          </dl><pre>${esc(JSON.stringify(span.fields,null,2))}</pre></details>
        </div></details>`;
    }).join('')||'<p class="annotation-empty">No saved annotations in this transcript.</p>'}</div>
    <details class="annotation-relations" ${selected.length || relations.length?'open':''}><summary>Token relations</summary>
    <h3>Directed relation</h3><form id="relation-form">${field('target','Target token ID',selected[1]??'')}${field('relation_type','Relation type')}${field('note','Relation note')}<button type="submit" ${selected.length?'':'disabled'}>Create relation</button></form>
    <h3>Saved relations</h3>${relations.map(t=>`<article class="annotation"><p>${esc(t.id)} → ${esc(t.attrs.relation_target)} · ${esc(t.attrs.relation_type)}</p><button type="button" class="secondary" data-edit-relation="${esc(t.id)}">Edit relation from ${esc(t.id)}</button><button type="button" class="secondary" data-clear-relation="${esc(t.id)}">Clear relation from ${esc(t.id)}</button><div data-relation-editor="${esc(t.id)}"></div></article>`).join('')||'<p class="muted">No relations yet.</p>'}</details>`;
  const dirty=(event:Event)=>{const form=(event.target as HTMLElement).closest("form");if(form){form.dataset.dirty="true";onDirty()}};section.addEventListener("input",dirty);section.addEventListener("change",dirty);
  section.querySelector<HTMLFormElement>('#span-form')!.onsubmit=async e=>{e.preventDefault();const v=formValues(e.currentTarget as HTMLFormElement);await onSave([{kind:'add_span',document:doc.path,id:`an-${crypto.randomUUID()}`,token_ids:selected,fields:{label:v.label,variety:v.variety,note:v.note},character:v.start!==''?{token:selected[0],start:Number(v.start),end:Number(v.end),quote:v.quote,coordinate:'unicode-codepoint',layer:'corrected'}:null}],`Create span: ${v.label}`,e.currentTarget as HTMLFormElement)};
  section.querySelector<HTMLFormElement>('#relation-form')!.onsubmit=async e=>{e.preventDefault();const v=formValues(e.currentTarget as HTMLFormElement);await onSave([{kind:'add_relation',document:doc.path,from:selected[0],to:v.target,relation_type:v.relation_type,note:v.note}],`Relation: ${v.relation_type}`,e.currentTarget as HTMLFormElement)};
  for(const button of section.querySelectorAll<HTMLButtonElement>('[data-reveal-span]')){
    button.onclick=()=>onReveal?.(doc.spans[Number(button.dataset.revealSpan)]);
  }
  section.querySelectorAll<HTMLButtonElement>('[data-edit-span]').forEach(button=>button.onclick=()=>{
    const index=Number(button.dataset.editSpan);const destination=section.querySelector(`[data-span-editor="${index}"]`)!;
    if(!destination.childElementCount)destination.replaceChildren(spanEditor(doc,doc.spans[index],selected,onSave,onDirty));
    destination.querySelector<HTMLInputElement>('input')?.focus();
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
