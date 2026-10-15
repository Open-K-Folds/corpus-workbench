import {esc} from './dom';

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
  dialog.innerHTML=`<div class="preparation-heading"><span class="preparation-eyebrow">LOCAL IMPORT</span><h2 id="preparation-heading">Recording + transcript</h2><p id="preparation-intro">Prepare an existing transcript for listening, correction and review.</p></div><div class="preparation-body"><div class="preparation-fields"><label for="preparation-format">Transcript format<select id="preparation-format"><option value="utf8-text">Plain text · UTF-8</option><option value="omnilingual-json">Omnilingual JSON</option></select></label><label for="preparation-title">Project title <span class="preparation-optional">(optional)</span><input id="preparation-title" maxlength="160" placeholder="Uses the transcript filename" autocomplete="off"></label></div><p class="preparation-help" id="preparation-format-help">Exact text and spacing are preserved. Word times remain unknown.</p><details class="preparation-input-help"><summary>Supported inputs and limits</summary><p>Recording: up to 64 MiB, in WAV, MP3, FLAC, OGG, M4A, AAC, OPUS or WEBM. Playback depends on local codec support.</p><p>Transcript: up to 2 MiB of UTF-8. Plain text is kept exactly. Omnilingual accepts <code>{"text":"supplied words"}</code> or the local batch wrapper with <code>request_endpoint</code>, <code>response_format</code>, matching <code>source_sha256</code>, <code>decoded_duration_seconds</code> and successful ordered <code>chunks</code>. Other schemas and word-alignment formats need a separate adapter.</p><p>Preparation supports up to 50,000 mechanical tokens and 10,000 supplied chunks. It retains source bytes and never runs recognition.</p></details><button id="preparation-choose" class="secondary">Choose recording and transcript</button><div id="preparation-preview" hidden></div><p id="preparation-status" role="status" aria-live="polite"></p></div><footer class="preparation-footer"><p>Sources stay local and unchanged. Import does not approve a transcript.</p><div><button id="preparation-cancel" class="secondary">Cancel</button><button id="preparation-confirm" disabled>Import for review</button></div></footer>`;
  document.body.append(dialog);dialog.showModal();
  // Keep workspace shortcuts from changing the background selection or drafts.
  // Native dialog defaults (Tab, Escape and editing shortcuts) still apply.
  dialog.addEventListener('keydown',event=>event.stopPropagation());
  const format=dialog.querySelector<HTMLSelectElement>('#preparation-format')!,title=dialog.querySelector<HTMLInputElement>('#preparation-title')!;
  const choose=dialog.querySelector<HTMLButtonElement>('#preparation-choose')!,confirm=dialog.querySelector<HTMLButtonElement>('#preparation-confirm')!,cancel=dialog.querySelector<HTMLButtonElement>('#preparation-cancel')!;
  const preview=dialog.querySelector<HTMLElement>('#preparation-preview')!,status=dialog.querySelector<HTMLElement>('#preparation-status')!;
  let selected:PreparationPreview|null=null,busy=false,valid=false;
  const message=(text:string,error=false)=>{status.textContent=text;status.className=error?'notice error':'';status.setAttribute('role',error?'alert':'status')};
  const setBusy=(value:boolean)=>{busy=value;dialog.setAttribute('aria-busy',String(value));for(const control of [choose,format,title,cancel])control.disabled=value;confirm.disabled=value||!selected||!valid};
  const forget=async()=>{if(selected)await bridge.cancelPreparation(selected.token);selected=null;valid=false;preview.hidden=true;preview.replaceChildren();confirm.disabled=true;confirm.textContent='Import for review'};
  const close=async()=>{if(busy)return;setBusy(true);try{await forget();dialog.close();dialog.remove();previous?.focus()}catch(error){message(`Could not clear the preview. ${String(error)}`,true);setBusy(false)}};
  cancel.onclick=()=>void close();
  dialog.addEventListener('cancel',event=>{event.preventDefault();void close()});
  const invalidate=()=>{if(busy||!selected)return;valid=false;setBusy(true);void forget().then(()=>message('Settings changed. Choose the files again to prepare a new preview.')).catch(error=>message(String(error),true)).finally(()=>setBusy(false))};
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
      preview.innerHTML=`<div class="preparation-summary"><h3>${selected.duplicate?'Existing working copy found':'Preview before import'}</h3><span>${summary.segments?`${summary.segments} chunk${summary.segments===1?'':'s'}`:'Untimed text'} · ${summary.tokens} token${summary.tokens===1?'':'s'}</span></div><dl class="preparation-sources">${(['audio','transcript'] as const).map(key=>`<div><dt>${key==='audio'?'Recording':'Raw transcript'}</dt><dd><strong>${esc(sources[key].name)}</strong><span>${size(sources[key].bytes)} · SHA-256 <code title="${esc(sources[key].sha256)}">${esc(sources[key].sha256.slice(0,12))}…</code></span></dd></div>`).join('')}</dl><p class="preparation-timing">${esc(summary.timing)}</p><pre class="preparation-excerpt" aria-label="Transcript excerpt">${esc(summary.text)}</pre>${(summary.warnings??[]).map(w=>`<p class="preparation-help">${esc(w)}</p>`).join('')}<p class="preparation-policy">${selected.duplicate?'The same source bytes and preparation version already have a working copy. Opening it preserves every correction and review.':'A new unreviewed working copy will retain both original files and source hashes. Correct and annotate it, then explicitly review the saved revision before a research handoff.'}</p>`;
      preview.hidden=false;confirm.textContent=selected.duplicate?'Open existing copy':'Import for review';
      message('Preview ready. Only the selected, preserved bytes will be imported.');
    }catch(error){message(String(error),true)}finally{setBusy(false)}
  };
  confirm.onclick=async()=>{
    if(busy||!selected||!valid)return;setBusy(true);message(selected.duplicate?'Opening the existing working copy.':'Importing the previewed files. Keep this window open until it finishes.');
    try{const result=await bridge.commitPreparation(selected.token);if(result?.cancelled)message('Import was not started. The preview remains available.');else{selected=null;dialog.close();dialog.remove()}}
    catch(error){message(`Import did not finish. You can retry this preview. ${String(error)}`,true)}finally{if(dialog.isConnected)setBusy(false)}
  };
  format.focus();
}
