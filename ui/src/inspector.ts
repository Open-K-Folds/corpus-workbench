import {group, h, renderInto, viewFragment} from './effect-view';
import './inspector-workflows.css';
import './token-drawer.css';
import './annotation-details.css';
import {annotationDetail} from './annotation-detail';
import type {Document, Operation, Span, Token, View} from './contracts';
import {field, formValues, seconds} from './dom';
import {buttonGroup} from './controls';
import {icon} from './icons';

export function emptyTokenInspector(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'token-drawer-empty';
  renderInto(section,
    h.div.class('token-record-icon').children(icon('book_2')),
    h.h2('Inspect a word'),
    h.p('Select a word in the transcript to review its readings, timing and source.'),
  );
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
    h.option.attrs({value: value}).children(description || value),
  );
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
  const identity = group(
    'Source token ',
    token.id,
    turnIndex < 0
      ? ''
      : group(' ', h.span.attrs({'aria-hidden': 'true'}).children('·'), ' Turn ', String(turnIndex + 1)),
  );
  const needsConfirmation = token.attrs.wb_normalized_status === 'unresolved';
  renderInto(section,
    h.div.class('token-record-heading').children(
      h.div.class('token-record-icon').children(icon('book_2')),
      h.hgroup(
        h.h2
          .class('original')
          .attrs({dir: 'auto'})
          .children(token.original || 'Empty source token'),
        h.p(identity),
      ),
    ),
    h.div
    .class('token-record-switcher')
    .attrs({role: 'tablist', 'aria-label': 'Token views'})
    .children(
      h.button
        .id('token-edit-tab')
        .attrs({
          type: 'button',
          role: 'tab',
          'aria-controls': 'token-edit-panel',
          'aria-selected': 'true',
        })
        .children(icon('edit_note'), 'Edit token'),
      h.button
        .id('token-source-tab')
        .attrs({
          type: 'button',
          role: 'tab',
          'aria-controls': 'token-source-panel',
          'aria-selected': 'false',
          tabindex: '-1',
        })
        .children(icon('description'), 'Source details'),
    ),
    h.section
    .id('token-edit-panel')
    .attrs({role: 'tabpanel', 'aria-labelledby': 'token-edit-tab'})
    .children(
      h.form
        .id('token-form')
        .children(
          h.fieldset(
            h.legend('Readings'),
            field('nform', 'Human-corrected reading', token.corrected ?? '', token.original),
            field('wb_normalized', 'Optional normalized reading', token.normalized ?? ''),
            needsConfirmation
              ? h.div
                  .class('token-confirmation')
                  .children(
                    h.p('Review the normalized reading after the correction.'),
                    h.button
                      .class('secondary')
                      .attrs({type: 'button'})
                      .children('Confirm retained normalized reading'),
                  )
              : '',
            h.label(
              'Language / variety',
              h.input.attrs({
                name: 'variety',
                value: token.attrs.variety ?? '',
                placeholder: token.language_effective ?? '',
                list: 'language-values',
                autocomplete: 'off',
              }),
            ),
            h.datalist.id('language-values').children(options),
          ),
          h.fieldset(
            h.legend('Annotations'),
            field('annotation', 'Custom annotation', token.attrs.annotation ?? ''),
            field('note', 'Reviewer note', token.attrs.note ?? ''),
          ),
          h.div
            .class('token-revision')
            .children(
              field('revision_label', 'Revision name', 'Correct ' + token.id),
              h.div
                .class('token-save-actions')
                .children(
                  h.button.id('save-token').attrs({type: 'submit'}).children(icon('check'), 'Save token'),
                  h.button.class('secondary').attrs({type: 'reset'}).children('Undo unsaved edits'),
                ),
            ),
        ),
    ),
    h.section
    .id('token-source-panel')
    .attrs({role: 'tabpanel', 'aria-labelledby': 'token-source-tab', tabindex: '0', hidden: ''})
    .children(
      h.h3('Source record'),
      h.dl
        .class('token-source-rows')
        .children(metadata.map(([name, value]) => h.div(h.dt(name), h.dd(value)))),
      h.details(h.summary('All imported attributes'), h.pre(JSON.stringify(token.attrs, null, 2))),
    ),
  );

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
    form.before(
      viewFragment(h.p.class('token-read-only').children('This nested token is read-only.')),
    );
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
  renderInto(section,
    h.hgroup
    .class('annotation-heading')
    .children(
      h.h2('Annotations'),
      h.p.attrs({dir: 'auto'}).children(doc.title, ' ', h.span('· R', String(view.revision.id))),
    ),
    h.details
    .class('annotation-compose')
    .attrs({open: selected.length ? '' : undefined})
    .children(
      h.summary(icon('edit_note'), 'Annotate selection', icon('expand_more')),
      h.p
        .class('annotation-selection')
        .children(
          selected.length
            ? `${selected.length} ${selected.length === 1 ? 'word' : 'words'} selected`
            : 'Select words in the transcript to create a span.',
        ),
      h.form
        .id('span-form')
        .children(
          field('label', 'Span label'),
          field('variety', 'Language / variety'),
          field('note', 'Note'),
          h.details(
            h.summary('Subtoken judgment (one token)'),
            h.p.class('muted').children('Offsets count Unicode code points in the corrected reading.'),
            field('start', 'Start code point'),
            field('end', 'End code point'),
            field('quote', 'Exact quote'),
          ),
          h.button
            .attrs({type: 'submit', disabled: selected.length ? undefined : ''})
            .children('Create span'),
        ),
    ),
    h.h3.class('annotation-list-heading').children('Saved annotations ', h.span(String(doc.spans.length))),
    h.div.class('annotation-list').children(
      doc.spans.length
        ? doc.spans.map((span, index) => {
            const detail = annotationDetail(doc, span, view.snapshot.project);
            const caption =
              detail.quote && detail.title !== detail.kind
                ? `${detail.kind} · ${detail.title}`
                : detail.kind;
            return h.details
              .class('annotation annotation-record')
              .attrs({
                'data-saved-annotation': span.id,
                'data-sidecar': span.sidecar,
                open: doc.spans.length === 1 ? '' : undefined,
              })
              .children(
                h.summary(
                  h.span.class('annotation-number').children(String(index + 1)),
                  h.span
                    .class('annotation-summary')
                    .children(
                      h.strong.attrs({dir: 'auto'}).children(detail.quote || detail.title),
                      h.small.attrs({dir: 'auto'}).children(caption),
                    ),
                  icon('expand_more'),
                ),
                h.div.class('annotation-body').children(
                  detail.note
                    ? h.p.class('annotation-note').attrs({dir: 'auto'}).children(detail.note)
                    : '',
                  h.p
                    .class('annotation-source')
                    .children(icon('menu_book'), h.span.attrs({dir: 'auto'}).children(detail.source)),
                  h.div.class('annotation-actions').children(
                    onReveal && detail.tokenIds.length
                      ? h.button
                          .class('secondary')
                          .attrs({type: 'button', 'data-reveal-span': String(index)})
                          .children(icon('menu_book'), 'Show in transcript')
                      : '',
                    h.button
                      .class('secondary')
                      .attrs({
                        type: 'button',
                        'data-edit-span': String(index),
                        'aria-label': 'Edit span ' + span.id,
                      })
                      .children(icon('edit_note'), 'Edit span'),
                  ),
                  h.div.attrs({'data-span-editor': String(index)}),
                  h.details
                    .class('annotation-provenance')
                    .children(
                      h.summary('Source record'),
                      h.dl(
                        h.dt('File'),
                        h.dd(doc.path),
                        h.dt('Sidecar'),
                        h.dd(span.sidecar),
                        h.dt('Span ID'),
                        h.dd(span.id),
                        h.dt('Tokens'),
                        h.dd(span.token_ids.join(' → ') || 'No token IDs supplied'),
                      ),
                      h.pre(JSON.stringify(span.fields, null, 2)),
                    ),
                ),
              );
          })
        : h.p.class('annotation-empty').children('No saved annotations in this transcript.'),
    ),
    h.details
    .class('annotation-relations')
    .attrs({open: selected.length || relations.length ? '' : undefined})
    .children(
      h.summary('Token relations'),
      h.h3('Directed relation'),
      h.form
        .id('relation-form')
        .children(
          field('target', 'Target token ID', selected[1] ?? ''),
          field('relation_type', 'Relation type'),
          field('note', 'Relation note'),
          h.button
            .attrs({type: 'submit', disabled: selected.length ? undefined : ''})
            .children('Create relation'),
        ),
      h.h3('Saved relations'),
      relations.length
        ? relations.map((t) =>
            h.article
              .class('annotation')
              .children(
                h.p(t.id, ' → ', t.attrs.relation_target, ' · ', t.attrs.relation_type),
                h.button
                  .class('secondary')
                  .attrs({type: 'button', 'data-edit-relation': t.id})
                  .children('Edit relation from ', t.id),
                h.button
                  .class('secondary')
                  .attrs({type: 'button', 'data-clear-relation': t.id})
                  .children('Clear relation from ', t.id),
                h.div.attrs({'data-relation-editor': t.id}),
              ),
          )
        : h.p.class('muted').children('No relations yet.'),
    ),
  );
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
  const section=document.createElement('section');renderInto(section,
    h.h4('Edit ', span.id),
    h.p
    .class('muted')
    .children(
      'Stable ID and supplied XML content remain intact. Anchors define the selection. Unsupported dialects stay read-only.',
    ),
    h.form.class('span-edit-form').children(
      field('label', 'Saved span label', span.fields.label ?? ''),
      field('variety', 'Saved span language / variety', span.fields.variety ?? ''),
      field('note', 'Saved span note', span.fields.note ?? ''),
      h.label(
        'Anchor change',
        h.select
          .attrs({name: 'anchor_mode'})
          .children(
            h.option.attrs({value: 'keep'}).children('Keep existing anchors'),
            h.option.attrs({value: 'tokens'}).children('Whole-token anchors'),
            h.option.attrs({value: 'character'}).children('Subtoken anchor'),
          ),
      ),
      field('token_ids', 'Token IDs in order', span.token_ids.join(' ')),
      h.button
        .class('secondary use-selected')
        .attrs({type: 'button', disabled: selected.length ? undefined : ''})
        .children('Use selected tokens'),
      field('start', 'Saved start code point', span.fields.wb_start ?? ''),
      field('end', 'Saved end code point', span.fields.wb_end ?? ''),
      field('quote', 'Saved exact quote', span.fields.wb_quote ?? ''),
      h.p
        .class('muted')
        .children(
          'Subtoken coordinates count Unicode code points in the corrected reading. Whole-token mode removes character coordinates; keeping anchors retains any unresolved status.',
        ),
      h.p.class('editor-error error').attrs({role: 'alert'}),
      h.button.attrs({type: 'submit'}).children('Save span changes'),
    ),
  );
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
  const section=document.createElement('section');renderInto(section,
    h.h4('Edit relation from ', token.id),
    h.p.class('muted').children("Clearing a relation preserves the token's note and identity."),
    h.form(
      field('target', 'Saved relation target', token.attrs.relation_target ?? ''),
      field('relation_type', 'Saved relation type', token.attrs.relation_type ?? ''),
      field('note', 'Saved relation note', token.attrs.note ?? ''),
      h.button('Save relation changes'),
    ),
  );
  const form=section.querySelector('form')!;const initial=formValues(form);
  form.onsubmit=async event=>{event.preventDefault();const v=formValues(form);if(v.target===initial.target&&v.relation_type===initial.relation_type&&v.note===initial.note)return;await onSave([{kind:'set_relation',document:doc.path,from:token.id,to:v.target,relation_type:v.relation_type,note:v.note===initial.note?null:v.note}],`Edit relation: ${token.id}`,form)};return section;
}
