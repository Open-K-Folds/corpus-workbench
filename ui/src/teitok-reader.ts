import {api} from './api';
import type {Operation,ReaderPreview,View} from './contracts';
import {esc} from './dom';
export async function teitokReaderInspector(view:View,onSave:(operations:Operation[],label:string)=>Promise<void>):Promise<HTMLElement>{
  const result=await api<ReaderPreview>(`/api/teitok-reader?revision=${view.revision.id}`);
  if(result.revision!==view.revision.id||result.snapshot_hash!==view.revision.snapshot_hash)throw new Error('Reader configuration revision mismatch');
  const panel=document.createElement('section');
  panel.innerHTML=`<h2>TEITOK reader package</h2><p>Package the original, corrected and optional normalized reading controls and research span definitions. Installation is a named revision and requires new review. Custom settings and definitions are preserved and block installation.</p><p id="reader-state">${result.installed?'Reader profile is packaged.':result.enabled?'Ready to install on R'+view.revision.id+'.':'Installation blocked.'}</p>${result.blockers.length?`<ul class="error">${result.blockers.map(value=>`<li>${esc(value)}</li>`).join('')}</ul>`:''}${Object.entries(result.candidate_xml).map(([path,text])=>`<details><summary>${esc(path)} - ${result.before_hashes[path]?'existing file':'new file'}</summary><pre>${esc(text)}</pre></details>`).join('')}<button id="install-teitok-reader" ${result.enabled?'':'disabled'}>Install packaged TEITOK reader</button><p class="muted">This fixed profile covers review_* spans in the bounded text dialect. Other schemas and opaque carriers still require converters. Native TEITOK remains a separately installed reader.</p>`;
  panel.querySelector<HTMLButtonElement>('#install-teitok-reader')!.onclick=()=>void onSave([{kind:'install_teitok_reader',profile_hash:result.profile_hash}],'Install packaged TEITOK reader');
  return panel;
}
