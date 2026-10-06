import {api} from './api';
import {esc,seconds} from './dom';
import {AudioPlayer} from './player';
import type {Revision,View} from './contracts';
export interface SearchQuery {schema:1;project:string;revision:number;snapshot_hash:string;mode:'current'|'historical';reading:'original'|'corrected'|'normalized';terms:{text:string;language:string|null}[];documents:string[];context:number;offset:number;limit:number}
interface Word {id:string;internal_id:string;original:string;corrected:string|null;normalized:string|null;normalized_status:string|null;language:string|null;language_source:string}
interface Audio {path:string;artifact_hash:string;start_us:number;end_us:number;basis:string}
export interface SearchHit {id:string;document:string;title:string;utterance:string|null;speaker:string|null;token_ids:string[];corpus_start:number;corpus_end:number;left:Word[];matched:Word[];right:Word[];readings:string[];audio:Audio|null}
interface Envelope {result_hash:string;result:{schema:number;binding:{engine:string;project:string;revision:number;snapshot_hash:string;projection_hash:string};query:SearchQuery;total:number;hits:SearchHit[];next_offset:number|null;rights:string}}
interface Resolved {binding:Envelope['result']['binding'];hit:SearchHit;historical:boolean}
export interface SearchPanel {element:HTMLElement;update:(view:View)=>void;pause:()=>void}
export function corpusSearch(initial:View,open:(binding:Envelope['result']['binding'],hit:SearchHit,reading:SearchQuery['reading'])=>void,refresh:()=>Promise<View>):SearchPanel {
  const panel=document.createElement('section');panel.className='search-panel';
  panel.innerHTML=`<h2>Corpus search</h2><p class="muted">Exact, case-sensitive tokens within one utterance or unsegmented document run. No regex or CQP syntax.</p><form id="corpus-search-form"><label>Exact token sequence<textarea name="tokens" rows="3" required placeholder="One token per line"></textarea></label><small class="muted">1–8 tokens, one per line. Spaces inside a line belong to that token; Unicode spelling is exact.</small><label>Search reading<select name="reading"><option value="corrected">Corrected, then original</option><option value="original">Original source</option><option value="normalized">Current normalized, then corrected / original</option></select></label><label>Language / variety filter<input name="language" autocomplete="off" placeholder="Optional exact value for every token"></label><label>Search evidence revision<select name="revision"><option value="current">Current saved R${initial.revision.id}</option></select></label><label>Search documents<select name="document"><option value="">All documents</option>${initial.documents.map(d=>`<option value="${esc(d.path)}">${esc(d.path)}</option>`).join('')}</select></label><div class="search-controls"><label>Context tokens<input name="context" type="number" min="0" max="12" value="4"></label><label>Page size<select name="limit"><option>25</option><option selected>50</option><option>100</option><option>200</option></select></label></div><button type="submit">Search corpus</button></form><p id="corpus-search-status" role="status"></p><div id="corpus-search-results"></div><audio id="search-audio" preload="metadata" hidden></audio><p id="search-audio-basis" class="muted"></p>`;
  const find=<T extends HTMLElement=HTMLElement>(id:string)=>panel.querySelector<T>('#'+id)!;
  const form=find<HTMLFormElement>('corpus-search-form');const status=find('corpus-search-status');const results=find('corpus-search-results');const audio=find<HTMLAudioElement>('search-audio');
  const player=new AudioPlayer(audio,'Search result playback');
  let view=initial;let rows:Revision[]=[initial.revision];let envelope:Envelope|null=null;let epoch=0;let action=0;let changed=false;let stopAt=0;
  const revision=form.elements.namedItem('revision') as HTMLSelectElement;
  const stale=()=>envelope?.result.query.mode==='current'&&(envelope.result.binding.revision!==view.revision.id||envelope.result.binding.snapshot_hash!==view.revision.snapshot_hash);
  const enabled=()=>{const obsolete=changed||!!stale();player.setEnabled(!obsolete);results.querySelectorAll<HTMLButtonElement>('button[data-hit],button[data-listen],button[data-page]').forEach(b=>b.disabled=obsolete)};
  const pause=()=>{audio.pause();++action};
  const clearAudio=()=>{audio.pause();audio.hidden=true;stopAt=0;if(audio.hasAttribute('src')){audio.removeAttribute('src');audio.load()}find('search-audio-basis').textContent=''};
  const options=()=>{const selected=revision.value;revision.innerHTML=`<option value="current">Current saved R${view.revision.id}</option>${rows.map(r=>`<option value="${r.id}">Historical R${r.id}: ${esc(r.label)}</option>`).join('')}`;revision.value=selected||'current'};
  const reload=document.createElement('button');reload.type='button';reload.className='secondary';reload.id='reload-search-evidence';reload.textContent='Reload saved evidence';form.after(reload);
  reload.onclick=async()=>{pause();try{const next=await refresh();if(panel.isConnected)status.textContent=`Loaded saved R${next.revision.id}. Search again to update results.`}catch(error){if(panel.isConnected)status.textContent=String(error)}};
  void api<Revision[]>('/api/history').then(history=>{rows=[...new Map([...history,...rows,view.revision].map(r=>[r.id,r])).values()].sort((a,b)=>b.id-a.id);options()}).catch(error=>{if(!envelope)status.textContent='Historical revision list unavailable: '+String(error)});
  function makeQuery():SearchQuery {
    const values=new FormData(form);const row=revision.value==='current'?view.revision:rows.find(r=>r.id===Number(revision.value));if(!row)throw new Error('Historical revision unavailable');
    const language=String(values.get('language')??'')||null;const tokens=String(values.get('tokens')??'').replace(/\r\n/g,'\n').split('\n').filter(s=>s.length>0);
    if(tokens.length<1||tokens.length>8)throw new Error('Enter 1–8 tokens, one per line.');
    return {schema:1,project:view.snapshot.project,revision:row.id,snapshot_hash:row.snapshot_hash,mode:revision.value==='current'?'current':'historical',reading:values.get('reading') as SearchQuery['reading'],terms:tokens.map(text=>({text,language})),documents:values.get('document')?[String(values.get('document'))]:[],context:Number(values.get('context')),offset:0,limit:Number(values.get('limit'))};
  }
  function draw(value:Envelope) {
    const r=value.result;const historical=r.query.mode==='historical';
    status.textContent=`${r.total} hits · ${historical?'Historical':'Saved'} R${r.binding.revision} · ${r.query.reading} reading${stale()?' · stale against saved head; search again':''}`;
    results.innerHTML=`<div class="search-result-actions"><button type="button" id="export-search" class="secondary">Export shown results (JSON)</button></div><p class="muted">${r.hits.length?`${r.query.offset+1}–${r.query.offset+r.hits.length}`:'0'} of ${r.total}. Each result carries exact evidence and query fingerprints.</p>${r.hits.map((hit,index)=>{
      const left=hit.readings.slice(0,hit.left.length).join(' ');const matched=hit.readings.slice(hit.left.length,hit.left.length+hit.matched.length).join(' ');const right=hit.readings.slice(hit.left.length+hit.matched.length).join(' ');
      return `<article class="search-hit"><small>${esc(hit.document)} · ${esc(hit.utterance??'unsegmented')} ${esc(hit.speaker??'')}</small><p class="kwic"><span>${esc(left)}</span> <mark>${esc(matched)}</mark> <span>${esc(right)}</span></p><small>${esc(hit.token_ids.join(', '))}</small><div class="search-hit-actions"><button type="button" class="secondary" data-hit="${index}">${historical?'Inspect historical hit':'Open matched tokens'}</button>${hit.audio?`<button type="button" class="secondary" data-listen="${index}">Play ${hit.audio.basis==='word_intervals'?'word intervals':'utterance'}</button>`:'<span class="muted">No observed audio interval</span>'}</div></article>`;
    }).join('')}${!r.hits.length?'<p class="empty-state">No matches on this page.</p>':''}<div class="search-result-actions">${r.query.offset?'<button type="button" class="secondary" data-page="previous">Previous page</button>':''}${r.next_offset!==null?'<button type="button" class="secondary" data-page="next">Next page</button>':''}</div><details><summary>Result provenance and scope</summary><p class="muted">${esc(r.rights)}</p><code class="hash">Snapshot ${esc(r.binding.snapshot_hash)}<br>Projection ${esc(r.binding.projection_hash)}<br>Result ${esc(value.result_hash)}</code></details><div id="historical-search-inspection"></div>`;
    find<HTMLButtonElement>('export-search').onclick=()=>{const blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`corpus-search-r${r.binding.revision}-${r.query.offset}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
    results.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(b=>b.onclick=()=>void run({...r.query,offset:b.dataset.page==='next'?r.next_offset!:Math.max(0,r.query.offset-r.query.limit)}));
    results.querySelectorAll<HTMLButtonElement>('[data-hit],[data-listen]').forEach(button=>button.onclick=async()=>{
      const intent=++action;try {
        const hit=r.hits[Number(button.dataset.hit??button.dataset.listen)];const resolved=await api<Resolved>('/api/search/resolve',{query:r.query,result_hash:value.result_hash,hit_id:hit.id});
        if(intent!==action||!panel.isConnected)return;
        if(stale())throw new Error('Search result is stale. Search the saved revision again.');
        if(button.dataset.listen!==undefined){
          const observed=resolved.hit.audio;if(!observed)throw new Error('No observed interval');
          const url=`/api/media?path=${encodeURIComponent(observed.path)}&revision=${resolved.binding.revision}`;
          if(audio.getAttribute('src')!==url){audio.src=url;audio.load();}
          audio.hidden=false;stopAt=observed.end_us/1e6;
          find('search-audio-basis').textContent=`${resolved.historical?'Historical':'Saved'} R${resolved.binding.revision}: ${observed.basis==='word_intervals'?'observed word intervals':'whole utterance; word timings are absent'} ${seconds(observed.start_us)}–${seconds(observed.end_us)}.`;
          if(audio.readyState<1)await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(new Error('Audio metadata unavailable'))},5000);const done=()=>{cleanup();resolve()};const fail=()=>{cleanup();reject(new Error('Audio media error'))};const cleanup=()=>{clearTimeout(timer);audio.removeEventListener('loadedmetadata',done);audio.removeEventListener('error',fail)};audio.addEventListener('loadedmetadata',done,{once:true});audio.addEventListener('error',fail,{once:true})});
          if(intent!==action||!panel.isConnected)return;audio.currentTime=observed.start_us/1e6;await audio.play();
        } else if(resolved.historical){
          find('historical-search-inspection').innerHTML=`<h3>Historical R${resolved.binding.revision} · read only</h3><p>${esc(resolved.hit.document)}</p><pre>${esc(JSON.stringify(resolved.hit.matched,null,2))}</pre><p class="muted">Current authoring remains on saved R${view.revision.id}.</p>`;
        } else {open(resolved.binding,resolved.hit,r.query.reading)}
      }catch(error){if(intent===action&&panel.isConnected){status.textContent=String(error);audio.pause()}}
    });enabled();
  }
  async function run(query:SearchQuery){const intent=++epoch;++action;clearAudio();status.textContent=`Searching exact R${query.revision}…`;try{const value=await api<Envelope>('/api/search',query);if(intent!==epoch)return;envelope=value;changed=false;draw(value)}catch(error){if(intent===epoch){status.textContent=String(error);enabled()}}}
  form.onsubmit=e=>{e.preventDefault();try{void run(makeQuery())}catch(error){status.textContent=String(error)}};
  form.oninput=()=>{++epoch;++action;changed=true;clearAudio();status.textContent='Query changed. Search again to update results.';enabled()};
  audio.ontimeupdate=()=>{if(stopAt&&audio.currentTime>=stopAt)audio.pause()};
  return {element:panel,pause,update:next=>{const prior=view.revision.id;view=next;if(!rows.some(r=>r.id===next.revision.id))rows.unshift(next.revision);options();if(prior!==next.revision.id){audio.pause();++epoch;++action;if(envelope&&stale()){status.textContent=`Results R${envelope.result.binding.revision} are stale against saved R${view.revision.id}. Search again.`;enabled()}}}};
}
