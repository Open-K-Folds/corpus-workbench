import {api} from './api';
import type {Diff,Operation,Revision,View} from './contracts';
import {esc} from './dom';
export async function historyInspector(view:View,onSave:(ops:Operation[],label:string)=>Promise<void>):Promise<HTMLElement>{
  const revisions=await api<Revision[]>('/api/history');const section=document.createElement('section');
  section.innerHTML=`<h2>Per-edit history</h2><p class="muted">Undo, redo and restore create a new revision. Every intervening revision remains available.</p><div class="actions"><button id="undo-committed" ${view.revision.parent?'':'disabled'}>Undo last committed edit</button></div>
    <label>Compare / restore revision<select id="compare-from">${revisions.map(r=>`<option value="${r.id}" ${r.id===view.revision.parent?'selected':''}>R${r.id} · ${esc(r.label)}</option>`).join('')}</select></label>
    <div class="actions"><button id="compare-revisions" class="secondary">Compare with current</button><button id="restore-revision" class="secondary">Restore selected state</button></div><div id="diff"></div>
    <ol class="history">${revisions.map(r=>`<li><strong>R${r.id} · ${esc(r.label)}</strong><p>${esc(r.created_at)} · ${esc(r.actor)}</p><small>${esc(r.snapshot_hash.slice(0,16))}</small></li>`).join('')}</ol>`;
  section.querySelector<HTMLButtonElement>('#undo-committed')!.onclick=()=>{if(view.revision.parent) void onSave([{kind:'restore',revision:view.revision.parent}],`Undo R${view.revision.id}`)};
  section.querySelector<HTMLButtonElement>('#restore-revision')!.onclick=()=>{const rev=Number(section.querySelector<HTMLSelectElement>('#compare-from')!.value);void onSave([{kind:'restore',revision:rev}],`Restore R${rev}`)};
  section.querySelector<HTMLButtonElement>('#compare-revisions')!.onclick=async()=>{
    const from=Number(section.querySelector<HTMLSelectElement>('#compare-from')!.value);const diff=await api<Diff>(`/api/diff?from=${from}&to=${view.revision.id}`);
    section.querySelector('#diff')!.innerHTML=`<h3>R${from} → R${view.revision.id}</h3><table><thead><tr><th>Token / field</th><th>Before</th><th>After</th></tr></thead><tbody>${diff.changes.map(c=>`<tr><td>${esc(c.target)} / ${esc(c.field)}</td><td>${c.before===null?'missing':esc(c.before)}</td><td>${c.after===null?'missing':esc(c.after)}</td></tr>`).join('')}</tbody></table><p>Changed files: ${esc(diff.files.map(f=>f.path).join(', ')||'none')}</p>${JSON.stringify(diff.config_before)!==JSON.stringify(diff.config_after)?'<p>Annotation definitions / defaults changed.</p>':''}`;
  };return section;
}
