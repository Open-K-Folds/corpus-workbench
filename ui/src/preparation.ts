import {h, renderInto} from './effect-view';
export type PreparationFormat='utf8-text'|'omnilingual-json';
export interface PreparationPreview {
  token:string;duplicate:boolean;key:string;
  sources:{audio:{name:string;sha256:string;bytes:number};transcript:{name:string;sha256:string;bytes:number}};
  summary:{format:string;segments:number;tokens:number;text:string;timing:string;warnings?:string[]};
}
export interface PreparationBridge {
  previewPreparation(options:{format:PreparationFormat;title:string}):Promise<PreparationPreview|null>;
  commitPreparation(token:string):Promise<{cancelled?:boolean}>;
  cancelPreparation(token:string):Promise<unknown>;
}
const size=(bytes:number)=>bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1024/1024).toFixed(1)} MB`;

export function openPreparation(bridge:PreparationBridge){
  if(document.querySelector('#preparation-dialog'))return;
  const previous=document.activeElement as HTMLElement|null;
  const dialog=document.createElement('dialog');dialog.id='preparation-dialog';dialog.className='preparation-dialog';
  dialog.setAttribute('aria-labelledby','preparation-heading');dialog.setAttribute('aria-describedby','preparation-intro');
  renderInto(dialog,
    h.div
    .class('preparation-heading')
    .children(
      h.h2.id('preparation-heading').children('Recording + transcript'),
      h.p
        .id('preparation-intro')
        .children('Choose a recording and its transcript, then review the files together.'),
    ),
    h.div.class('preparation-body').children(
      h.div.class('preparation-fields').children(
        h.label.attrs({for: 'preparation-format'}).children(
          'Transcript format',
          h.select
            .id('preparation-format')
            .attrs({'aria-describedby': 'preparation-format-help'})
            .children(
              h.option.attrs({value: 'utf8-text'}).children('Plain text · UTF-8'),
              h.option.attrs({value: 'omnilingual-json'}).children('Omnilingual JSON'),
            ),
        ),
        h.label
          .attrs({for: 'preparation-title'})
          .children(
            'Project title ',
            h.span.class('preparation-optional').children('(optional)'),
            h.input
              .id('preparation-title')
              .attrs({maxlength: '160', placeholder: 'Uses the transcript filename', autocomplete: 'off'}),
          ),
      ),
      h.p
        .class('preparation-help')
        .id('preparation-format-help')
        .children('Exact text and spacing are preserved. Word times remain unknown.'),
      h.details
        .class('preparation-input-help')
        .children(
          h.summary('Supported inputs and limits'),
          h.p(
            'Recording: up to 64 MiB, in WAV, MP3, FLAC, OGG, M4A, AAC, OPUS or WEBM. Playback depends on local codec support.',
          ),
          h.p(
            'Transcript: up to 2 MiB of UTF-8. Plain text is kept exactly. Omnilingual accepts ',
            h.code('{"text":"supplied words"}'),
            ' or the local batch wrapper with ',
            h.code('request_endpoint'),
            ', ',
            h.code('response_format'),
            ', matching ',
            h.code('source_sha256'),
            ', ',
            h.code('decoded_duration_seconds'),
            ' and successful ordered ',
            h.code('chunks'),
            '. Other schemas and word-alignment formats need a separate adapter.',
          ),
          h.p(
            'Preparation supports up to 50,000 mechanical tokens and 10,000 supplied chunks. It retains source bytes and never runs recognition.',
          ),
        ),
      h.button.id('preparation-choose').class('secondary').children('Choose recording and transcript'),
      h.div.id('preparation-preview').attrs({hidden: ''}),
      h.p.id('preparation-status').attrs({role: 'status', 'aria-live': 'polite'}),
    ),
    h.footer
    .class('preparation-footer')
    .children(
      h.p('Import creates a separate working copy.'),
      h.div(
        h.button.id('preparation-cancel').class('secondary').children('Cancel'),
        h.button.id('preparation-confirm').attrs({disabled: ''}).children('Import for review'),
      ),
    ),
  );
  document.body.append(dialog);dialog.showModal();
  // Keep workspace shortcuts from changing the background selection or drafts.
  // Native dialog defaults (Tab, Escape and editing shortcuts) still apply.
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  const format=dialog.querySelector<HTMLSelectElement>('#preparation-format')!,title=dialog.querySelector<HTMLInputElement>('#preparation-title')!;
  const choose=dialog.querySelector<HTMLButtonElement>('#preparation-choose')!,confirm=dialog.querySelector<HTMLButtonElement>('#preparation-confirm')!,cancel=dialog.querySelector<HTMLButtonElement>('#preparation-cancel')!;
  const preview=dialog.querySelector<HTMLElement>('#preparation-preview')!,status=dialog.querySelector<HTMLElement>('#preparation-status')!;
  let selected:PreparationPreview|null=null,busy=false,valid=false;
  const message=(text:string,error=false)=>{status.textContent=text;status.className=error?'notice error':'';status.setAttribute('role',error?'alert':'status')};
  const setBusy=(value:boolean,keepEditing=false)=>{busy=value;dialog.setAttribute('aria-busy',String(value));choose.disabled=cancel.disabled=value;format.disabled=title.disabled=value&&!keepEditing;confirm.disabled=value||!selected||!valid};
  const forget=async()=>{if(selected)await bridge.cancelPreparation(selected.token);selected=null;valid=false;preview.hidden=true;preview.replaceChildren();confirm.disabled=true;confirm.textContent='Import for review'};
  const close=async()=>{if(busy)return;setBusy(true);try{await forget();dialog.close();dialog.remove();previous?.focus()}catch(error){message(`Could not clear the preview. ${String(error)}`,true);setBusy(false)}};
  cancel.onclick=()=>void close();
  dialog.addEventListener('cancel',event=>{event.preventDefault();void close()});
  const invalidate=()=>{if(busy||!selected)return;valid=false;setBusy(true,true);void forget().then(()=>message('Settings changed. Choose the files again to prepare a new preview.')).catch(error=>message(String(error),true)).finally(()=>setBusy(false))};
  format.onchange=()=>{dialog.querySelector('#preparation-format-help')!.textContent=format.value==='utf8-text'?'Exact text and spacing are preserved. Word times remain unknown.':'Use the supported Omnilingual output schema. Available chunk bounds remain chunk bounds; they do not align words.';invalidate()};
  title.oninput=invalidate;
  choose.onclick=async()=>{
    if(busy)return;setBusy(true);message('Choose the local recording, then its existing transcript.');
    try{
      await forget();
      selected=await bridge.previewPreparation({format:format.value as PreparationFormat,title:title.value});
      if(!selected){message('File selection cancelled. No project was imported.');return}
      valid=true;
      const {sources,summary}=selected;
      renderInto(preview,
        h.div
        .class('preparation-summary')
        .children(
          h.h3(selected.duplicate ? 'Existing working copy found' : 'Preview before import'),
          h.span(
            summary.segments
              ? `${summary.segments} chunk${summary.segments === 1 ? '' : 's'}`
              : 'Untimed text',
            ' · ',
            String(summary.tokens),
            ' token',
            summary.tokens === 1 ? '' : 's',
          ),
        ),
        h.dl
        .class('preparation-sources')
        .children(
          (['audio', 'transcript'] as const).map((key) =>
            h.div(
              h.dt(key === 'audio' ? 'Recording' : 'Raw transcript'),
              h.dd(
                h.strong(sources[key].name),
                h.span(
                  size(sources[key].bytes),
                  ' · SHA-256 ',
                  h.code.attrs({title: sources[key].sha256}).children(sources[key].sha256.slice(0, 12), '…'),
                ),
              ),
            ),
          ),
        ),
        h.p.class('preparation-timing').children(summary.timing),
        h.pre.class('preparation-excerpt').attrs({'aria-label': 'Transcript excerpt'}),
        (summary.warnings ?? []).map((w) => h.p.class('preparation-help').children(w)),
        h.p
        .class('preparation-policy')
        .children(
          selected.duplicate
            ? 'The same source bytes and preparation version already have a working copy. Opening it preserves every correction and review.'
            : 'A new unreviewed working copy will retain both original files and source hashes. Correct and annotate it, then explicitly review the saved revision before a research handoff.',
        ),
      );
      preview.querySelector('.preparation-excerpt')!.textContent=summary.text;
      preview.hidden=false;confirm.textContent=selected.duplicate?'Open existing copy':'Import for review';
      message('Preview ready. Review the files before importing.');
    }catch(error){message(String(error),true)}finally{
      setBusy(false);
      const heading=preview.querySelector('h3');
      if(selected && valid && heading){heading.tabIndex=-1;heading.focus()}
      else choose.focus();
    }
  };
  confirm.onclick=async()=>{
    if(busy||!selected||!valid)return;setBusy(true);message(selected.duplicate?'Opening the existing working copy.':'Importing the previewed files. Keep this window open until it finishes.');
    try{const result=await bridge.commitPreparation(selected.token);if(result?.cancelled)message('Import was not started. The preview remains available.');else{selected=null;dialog.close();dialog.remove()}}
    catch(error){message(`Import did not finish. You can retry this preview. ${String(error)}`,true)}finally{if(dialog.isConnected){setBusy(false);confirm.focus()}}
  };
  format.focus();
}
