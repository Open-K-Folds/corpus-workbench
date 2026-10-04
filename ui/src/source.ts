import {api} from './api';
import type {View} from './contracts';
import {esc} from './dom';

export async function sourceInspector(view:View,path:string):Promise<HTMLElement> {
  const artifact=view.snapshot.files[path];if(!artifact)throw new Error('Source is absent from this exact snapshot');
  const section=document.createElement('section');section.className='source-inspector';
  section.innerHTML=`<h2>Source artifact</h2><p class="source-path">${esc(path)}</p><dl class="metadata-list"><dt>Role</dt><dd>${esc(artifact.role)}</dd><dt>Size</dt><dd>${artifact.bytes.toLocaleString()} bytes</dd><dt>Revision</dt><dd>R${view.revision.id}</dd><dt>SHA-256</dt><dd class="hash">${esc(artifact.sha256)}</dd></dl><p class="muted">Preserved immutable bytes. Imported scripts and unknown formats are inspected as data.</p>`;
  if(path.endsWith('.xml')){const response=await api<{xml:string;revision:number;artifact_hash:string}>(`/api/xml?path=${encodeURIComponent(path)}&revision=${view.revision.id}`);if(response.revision!==view.revision.id||response.artifact_hash!==artifact.sha256)throw new Error('Source revision binding mismatch');const pre=document.createElement('pre');pre.id='source-preview';pre.textContent=response.xml;section.append(pre)}
  else {const p=document.createElement('p');p.className='empty-state';p.textContent='No inline decoder for this artifact. Its complete original bytes remain in the package export.';section.append(p)}
  return section;
}
