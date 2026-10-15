import type {Document,View} from './contracts';
import type {AudioAnalysis} from './audio-analysis';
import {desktop,type SemanticaState} from './desktop';
import {esc} from './dom';
import './overview.css';

interface Sources {
  view:()=>View;doc:()=>Document;selected:()=>string[];audio:HTMLAudioElement;
  analysis:()=>{state:string;analysis:AudioAnalysis|null};
  busy:()=>boolean;
  go:(target:'review'|'research')=>void;
}
const stamp=()=>new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
const duration=(n:number)=>Number.isFinite(n)&&n>=0?`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`:'—';
const bytes=(n:number)=>n<1048576?`${(n/1024).toFixed(1)} KiB`:`${(n/1048576).toFixed(1)} MiB`;

/** Read-only instrument view. Every line is snapshot membership, never inference. */
export class ResearchOverview {
  private dialog=document.createElement('dialog');
  private reduced=matchMedia('(prefers-reduced-motion: reduce)');
  private paused=false;private previous:HTMLElement|null=null;private frame=0;private lastFrame=0;
  private timer:ReturnType<typeof setInterval>|null=null;private request=0;private pending=false;
  private basis='';private selection='';private media:string|undefined;private state:SemanticaState|null=null;
  private stateKey='';private events:{time:string;text:string}[]=[];private abort=new AbortController();
  private resize:ResizeObserver;private theme:MutationObserver;
  private displayTime=0;
  constructor(private sources:Sources){
    this.dialog.id='research-overview';this.dialog.className='overview';
    this.dialog.setAttribute('aria-labelledby','overview-heading');this.dialog.setAttribute('aria-describedby','overview-intro');
    this.dialog.innerHTML=`<div class="overview-header"><div class="overview-title"><h2 id="overview-heading">Research overview</h2><p id="overview-intro">Follow the evidence. Keep the source in view.</p><span class="overview-project"></span></div><div class="overview-controls"><button id="overview-refresh" class="secondary">Refresh state</button><button id="overview-pause" class="secondary" aria-pressed="false">Pause motion</button><button id="overview-close">Return to transcript</button></div></div>
      <div id="overview-basis" class="overview-basis"></div>
      <div class="overview-stage"><section class="overview-evidence" aria-labelledby="overview-evidence-heading"><h3 id="overview-evidence-heading">Preserved evidence <span class="overview-label">Snapshot membership</span></h3><svg id="overview-map" role="img" viewBox="0 0 570 390" aria-labelledby="overview-map-title overview-map-description"></svg><p class="overview-label">Lines connect files to this saved package. They are not semantic relationships or a claim that one file generated another.</p></section>
      <section class="overview-signal" aria-labelledby="overview-signal-heading"><h3 id="overview-signal-heading">Recording trace <span id="overview-media" class="overview-label"></span></h3><canvas id="overview-traces" role="img" aria-label="Recording peak envelope and eight sampled frequency bands"></canvas><p id="overview-analysis-status" class="overview-label"></p><div class="overview-player"><button id="overview-play" class="secondary">Play recording</button><label>Recording position<input id="overview-seek" type="range" min="0" max="1" step="0.1" value="0" aria-label="Seek recording"></label><output id="overview-time"></output></div><p id="overview-motion-status" class="overview-label"></p></section></div>
      <div class="overview-instruments"><section class="overview-instrument"><span>Preserved files</span><strong id="overview-file-count"></strong><small id="overview-file-bytes"></small></section><section class="overview-instrument"><span>Selected tokens</span><strong id="overview-selection-count"></strong><small id="overview-token-total"></small></section><section class="overview-instrument"><span>Exact-revision review</span><strong id="overview-review"></strong><button id="overview-open-review" class="secondary">Inspect review</button></section><section class="overview-instrument"><span>Local Semantica</span><strong id="overview-runtime"></strong><small id="overview-generation"></small><button id="overview-open-handoff" class="secondary">Open handoff</button></section></div>
      <div class="overview-detail-row"><section class="overview-selection"><h3>Selection in context</h3><p id="overview-selection-text"></p><p id="overview-selection-timing" class="overview-label"></p><p id="overview-draft-status" class="overview-label">Saved readings only. Unsaved drafts are excluded.</p></section><section class="overview-activity"><h3>This session <span class="overview-label">Observed changes</span></h3><ol id="overview-events"></ol></section></div>
      <details class="overview-files"><summary id="overview-files-summary"></summary><ul id="overview-files-list"></ul></details><footer class="overview-footer">Local evidence, not inferred certainty. Waveforms and sampled frequency bands describe the recording, not speech alignment, language, confidence or transcription accuracy.</footer>`;
    document.body.append(this.dialog);
    this.find('overview-close').onclick=()=>this.close();
    this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.close()});
    this.dialog.addEventListener('keydown',event=>event.stopPropagation());
    this.find('overview-pause').onclick=()=>{this.paused=!this.paused;this.motion();this.draw();this.animate()};
    this.find('overview-refresh').onclick=()=>void this.refresh();
    this.find('overview-open-review').onclick=()=>{this.close();sources.go('review')};
    this.find('overview-open-handoff').onclick=()=>{this.close();sources.go('research')};
    this.find('overview-play').onclick=()=>{if(sources.audio.paused)void sources.audio.play().catch(()=>{this.find('overview-media').textContent='Playback unavailable; use the recording panel to retry.'});else sources.audio.pause()};
    this.find<HTMLInputElement>('overview-seek').oninput=event=>{if(this.playable()){sources.audio.currentTime=Number((event.target as HTMLInputElement).value);this.displayTime=sources.audio.currentTime;this.draw();this.player()}};
    for(const event of ['play','pause','ended','seeking','seeked','loadedmetadata','durationchange','error','emptied','timeupdate','canplay'])sources.audio.addEventListener(event,()=>{
      if(!this.dialog.open)return;
      if(['play','pause','ended','seeked'].includes(event))this.record(event==='play'?'Recording playback started':event==='pause'?'Recording playback paused':event==='ended'?'Recording playback ended':`Recording seeked to ${duration(sources.audio.currentTime)}`);
      this.player();this.motion();if(!this.paused&&event!=='timeupdate')this.draw();this.animate();
    },{signal:this.abort.signal});
    document.addEventListener('visibilitychange',()=>{this.motion();this.animate();if(!document.hidden&&this.dialog.open){this.draw();void this.refresh()}},{signal:this.abort.signal});
    document.addEventListener('wb-audio-analysis',()=>{if(this.dialog.open){this.draw();this.player()}},{signal:this.abort.signal});
    this.resize=new ResizeObserver(()=>{if(this.dialog.open)this.draw()});this.resize.observe(this.dialog);
    this.theme=new MutationObserver(()=>{if(this.dialog.open)this.draw()});this.theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    this.reduced.addEventListener('change',()=>{this.motion();this.draw();this.animate()},{signal:this.abort.signal});
  }
  private find<T extends HTMLElement=HTMLElement>(id:string){return this.dialog.querySelector<T>('#'+id)!}
  open(){if(this.dialog.open)return;this.previous=document.activeElement as HTMLElement;this.displayTime=this.sources.audio.currentTime;this.dialog.showModal();this.record('Overview opened on the saved editor basis');this.update();this.player();this.motion();this.draw();this.animate();void this.refresh();this.timer=setInterval(()=>{if(!document.hidden)void this.refresh()},3000);this.find('overview-close').focus()}
  private close(){this.dialog.close();this.request++;if(this.timer)clearInterval(this.timer);this.timer=null;cancelAnimationFrame(this.frame);this.frame=0;this.previous?.focus()}
  dispose(){this.close();this.abort.abort();this.resize.disconnect();this.theme.disconnect();this.dialog.remove()}
  update(){
    if(!this.dialog.open)return;
    const {view,doc,selected}=this.sources,v=view(),d=doc(),ids=new Set(selected()),tokens=d.tokens.filter(token=>ids.has(token.id));
    const basis=[v.snapshot.project,v.revision.id,v.revision.snapshot_hash,v.approved,d.path].join(':');
    if(this.basis!==basis){if(this.basis)this.record(`Saved basis observed: R${v.revision.id}${v.approved?' approved':' unreviewed'}`);this.basis=basis;this.state=null;this.stateKey='';this.generation();}
    const selection=[d.path,...tokens.map(token=>token.id)].join(':');if(this.selection!==selection){if(this.selection)this.record(`${tokens.length} token${tokens.length===1?'':'s'} selected`);this.selection=selection;}
    this.media=this.resolveMedia(v,d);
    const priority=(path:string)=>path===d.path?0:path===this.media?1:2;
    const entries=Object.entries(v.snapshot.files).sort(([a],[b])=>priority(a)-priority(b)||a.localeCompare(b));
    this.find('overview-basis').textContent=`Saved R${v.revision.id} · ${v.revision.snapshot_hash} · ${v.documents.length} document${v.documents.length===1?'':'s'}`;
    this.dialog.querySelector('.overview-project')!.textContent=d.title;
    this.find('overview-file-count').textContent=String(entries.length);this.find('overview-file-bytes').textContent=`${bytes(entries.reduce((sum,[,file])=>sum+file.bytes,0))} retained in this snapshot`;
    this.find('overview-selection-count').textContent=String(tokens.length);this.find('overview-token-total').textContent=`of ${d.tokens.length} saved tokens in this document`;
    this.find('overview-review').textContent=v.approved?'Approved':'Unreviewed';
    this.find<HTMLButtonElement>('overview-open-review').disabled=this.sources.busy();this.find<HTMLButtonElement>('overview-open-handoff').disabled=this.sources.busy();
    this.find('overview-selection-text').textContent=tokens.length?tokens.slice(0,32).map(token=>token.corrected??token.original).join(' ')+(tokens.length>32?' …':''):'Select transcript tokens, then open this overview to follow their saved context.';
    const timed=tokens.filter(t=>t.start_us!==null&&t.end_us!==null),bounds=this.extent();
    this.find('overview-selection-timing').textContent=!tokens.length?'No selection.':timed.length===tokens.length?`Supplied word bounds: ${duration(bounds![0])}–${duration(bounds![1])}.`:bounds?`Supplied segment/chunk bounds: ${duration(bounds[0])}–${duration(bounds[1])}. Word timing is incomplete or unknown.`:'No supplied timing. Word positions are not aligned to the recording.';
    this.find('overview-files-summary').textContent=`Inspect snapshot files · ${entries.length} total${entries.length>16?' · first 16 shown':''}`;
    this.find('overview-files-list').innerHTML=entries.slice(0,16).map(([path,file])=>`<li><span>${esc(path)}</span><code title="${esc(file.sha256)}">${esc(file.sha256.slice(0,12))}</code><small>${bytes(file.bytes)} · ${esc(file.role)}</small></li>`).join('');
    this.map(entries);this.player();this.generation();this.draw();
  }
  private resolveMedia(v:View,d:Document){const paths=[...new Set(d.media.flatMap(path=>[path,`Audio/${path}`,`Video/${path}`]).filter(path=>v.snapshot.files[path]?.role==='source-media'))];return paths.length===1?paths[0]:undefined}
  private extent():[number,number]|null{const d=this.sources.doc(),ids=new Set(this.sources.selected()),bounds=d.tokens.filter(t=>ids.has(t.id)).map(t=>t.start_us!==null&&t.end_us!==null?[t.start_us,t.end_us]:d.segments.find(s=>s.id===t.utterance)).map(s=>Array.isArray(s)?s:s?.start_us!==null&&s?.end_us!==null?[s?.start_us,s?.end_us]:null).filter((s):s is number[]=>!!s&&s.every(n=>typeof n==='number'));return bounds.length?[Math.min(...bounds.map(s=>s[0]))/1e6,Math.max(...bounds.map(s=>s[1]))/1e6]:null}
  private map(entries:[string,View['snapshot']['files'][string]][]){
    const v=this.sources.view(),d=this.sources.doc(),visible=entries.slice(0,16),count=visible.length;
    this.find('overview-map').innerHTML=`<title id="overview-map-title">Files retained in saved revision ${v.revision.id}</title><desc id="overview-map-description">${entries.length} package files; first ${count} shown. Highlighted files are the active document source and its unambiguous recording association. Lines show snapshot membership, not semantic inference.</desc><circle cx="104" cy="195" r="69" class="overview-orbit"/><circle cx="104" cy="195" r="56" class="overview-orbit"/><circle cx="104" cy="195" r="42" class="overview-core"/><text x="104" y="190" text-anchor="middle" class="overview-revision">R${v.revision.id}</text><text x="104" y="211" text-anchor="middle" class="overview-svg-small">SAVED BASIS</text>${visible.map(([path,file],i)=>{const y=28+i*(334/Math.max(1,count-1)),x=320+52*Math.sin(Math.PI*i/Math.max(1,count-1)),active=path===d.path||path===this.media;return `<path class="overview-link ${active?'overview-link-current':''}" d="M 150 195 C 225 195, 235 ${y}, ${x-12} ${y}"/><path class="overview-flow" ${path===this.media?'data-recording="true"':''} d="M 150 195 C 225 195, 235 ${y}, ${x-12} ${y}"/><circle cx="${x-7}" cy="${y}" r="${active?3:1.7}" class="overview-node"/><text x="${x}" y="${y-3}" class="overview-svg-file"><title>${esc(path)}</title>${esc(path.length>25?path.slice(0,22)+'…':path)}</text><text x="${x}" y="${y+11}" class="overview-svg-small">${esc(file.role)}${path===d.path?' · active source':path===this.media?' · recording reference':''}</text>`}).join('')}<text x="30" y="382" class="overview-svg-small">${entries.length>count?`${entries.length-count} more files retained · inspect file list below`:'Original source bytes stay in the saved package'}</text>`;
  }
  private playable(){const a=this.sources.audio;return !!this.media&&!a.hidden&&!!a.getAttribute('src')&&!a.error&&Number.isFinite(a.duration)&&a.duration>0}
  private player(){const a=this.sources.audio,available=this.playable();const play=this.find<HTMLButtonElement>('overview-play'),seek=this.find<HTMLInputElement>('overview-seek');play.disabled=!available;play.textContent=a.paused?'Play recording':'Pause recording';seek.disabled=!available;seek.max=String(available?a.duration:1);seek.value=String(available?a.currentTime:0);this.find('overview-time').textContent=available?`${duration(a.currentTime)} / ${duration(a.duration)}`:'No playback';this.find('overview-media').textContent=available?this.media!:this.media?'Recording unavailable or still loading':'No unambiguous recording reference';}
  private motion(){const reduced=this.reduced.matches,a=this.sources.audio;this.dialog.dataset.motion=reduced?'reduced':this.paused?'paused':!a.paused&&this.playable()&&!document.hidden?'playing':'ready';this.dialog.dataset.canFlow=String(!document.hidden&&this.playable()&&!a.paused&&!a.ended&&!a.seeking&&a.readyState>=3);const button=this.find<HTMLButtonElement>('overview-pause');button.disabled=reduced;button.textContent=this.paused?'Resume motion':'Pause motion';button.setAttribute('aria-pressed',String(this.paused||reduced));this.find('overview-motion-status').textContent=reduced?'Reduced motion: static view':this.paused?'Motion paused; playback continues':'Motion follows playback';}
  private animate(){cancelAnimationFrame(this.frame);this.frame=0;if(!this.dialog.open||document.hidden||this.paused||this.reduced.matches||!this.playable()||this.sources.audio.paused)return;const tick=(now:number)=>{if(now-this.lastFrame>=100){this.lastFrame=now;this.draw();this.player()}this.frame=requestAnimationFrame(tick)};this.frame=requestAnimationFrame(tick)}
  private draw(){
    if(!this.dialog.open||document.hidden)return;const canvas=this.find<HTMLCanvasElement>('overview-traces'),rect=canvas.getBoundingClientRect();if(!rect.width)return;
    if(!this.paused&&!this.reduced.matches)this.displayTime=this.sources.audio.currentTime;
    const scale=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(rect.width*scale);canvas.height=Math.round(rect.height*scale);const c=canvas.getContext('2d');if(!c)return;c.scale(scale,scale);
    const styles=getComputedStyle(this.dialog),ink=styles.getPropertyValue('--ov-ink').trim()||'#fff',muted=styles.getPropertyValue('--ov-muted').trim()||'#888',line=styles.getPropertyValue('--ov-line').trim()||'#444';
    const width=rect.width,height=rect.height,left=38,right=width-15,plot=right-left;const {state,analysis:a}=this.sources.analysis();
    c.font='10px ui-monospace,Consolas,monospace';c.fillStyle=muted;c.fillText('PEAK ENVELOPE',left,17);
    if(!this.playable()||!a){this.find('overview-analysis-status').textContent=!this.media?'No recording association. No signal has been invented.':state==='loading'?'Preparing bounded local audio analysis…':'Audio overview unavailable. Playback may remain available in the recording panel.';canvas.setAttribute('aria-label',!this.media?'No recording association; no measured trace available':state==='loading'?'Recording analysis loading; no measured trace available':'Recording analysis unavailable; no measured trace available');c.fillText('No measured trace available',left,height/2);return;}
    this.find('overview-analysis-status').textContent='Peak amplitude + 8 sampled frequency bands · display intensity, low → high. No word alignment.';
    const extent=this.extent();if(extent){c.fillStyle=line;c.globalAlpha=.3;c.fillRect(left+Math.max(0,extent[0]/a.duration)*plot,25,Math.max(2,Math.min(a.duration,extent[1])/a.duration*plot-Math.max(0,extent[0]/a.duration)*plot),height-52);c.globalAlpha=1;}
    const columns=Math.min(220,a.peaks.length),point=(index:number)=>left+index/Math.max(1,columns-1)*plot;
    c.strokeStyle=ink;c.lineWidth=.9;c.beginPath();for(let i=0;i<columns;i++){let peak=0;for(let bin=Math.floor(i*a.peaks.length/columns);bin<Math.floor((i+1)*a.peaks.length/columns);bin++)peak=Math.max(peak,a.peaks[bin]);const x=point(i);c.moveTo(x,54-peak*25);c.lineTo(x,54+peak*25)}c.stroke();
    c.fillStyle=muted;c.fillText('SAMPLED FREQUENCY BANDS',left,98);const space=(height-142)/8;
    for(let band=0;band<8;band++){const y=116+(7-band)*space;c.strokeStyle=line;c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();c.strokeStyle=ink;c.globalAlpha=.6+band*.045;c.beginPath();for(let i=0;i<columns;i++){const column=Math.min(a.columns-1,Math.floor(i/columns*a.columns));let intensity=0;for(let bin=band*16;bin<(band+1)*16;bin++)intensity+=a.spectrogram[column*a.bins+Math.min(bin,a.bins-1)]/(255*16);const x=point(i),py=y-intensity*space*.82;if(i)c.lineTo(x,py);else c.moveTo(x,py)}c.stroke();c.globalAlpha=1;}
    c.fillStyle=muted;c.fillText('0:00',left,height-8);c.fillText(duration(a.duration/2),left+plot/2-10,height-8);c.fillText(duration(a.duration),right-30,height-8);
    const x=left+Math.max(0,Math.min(1,this.displayTime/a.duration))*plot;c.strokeStyle=ink;c.lineWidth=1.1;c.beginPath();c.moveTo(x,25);c.lineTo(x,height-28);c.stroke();c.fillStyle=ink;c.beginPath();c.arc(x,54,3,0,Math.PI*2);c.fill();
    canvas.setAttribute('aria-label',`Recording envelope and eight sampled frequency bands across ${duration(a.duration)}; displayed playhead ${duration(this.displayTime)}. No word alignment.`);
  }
  private async refresh(){
    if(!this.dialog.open||document.hidden||this.pending)return;
    if(!desktop){this.generation();return;}const v=this.sources.view(),basis=[v.snapshot.project,v.revision.id,v.revision.snapshot_hash].join(':'),request=++this.request;this.pending=true;
    try{const state=await desktop.semanticaState(),latest=this.sources.view();if(!this.dialog.open||request!==this.request||basis!==[latest.snapshot.project,latest.revision.id,latest.revision.snapshot_hash].join(':'))return;const key=JSON.stringify([state.status,state.current,state.export,state.lastAttempt]);if(this.stateKey&&this.stateKey!==key)this.record(`Local handoff state observed: ${state.status}`);this.stateKey=key;this.state=state;this.generation();}
    catch{if(this.dialog.open&&request===this.request){this.state=null;this.find('overview-runtime').textContent='State unavailable';this.find('overview-generation').textContent='Could not read the local runtime. Refresh to retry.';}}
    finally{this.pending=false;}
  }
  private generation(){
    const v=this.sources.view(),s=this.state,current=s?.current;
    const exact=!!current&&current.revision===v.revision.id&&current.snapshot_hash===v.revision.snapshot_hash&&v.approved&&!v.issues.some(i=>i.blocking);
    let label=!desktop?'Desktop runtime unavailable':!s?'Checking local state':exact&&current!.native_reopen?'Verified current graph':exact?'Accepted receipt':current?'Earlier graph':s.configured?'Ready after review':'Not configured';
    let detail=!desktop?'Open the desktop workbench for actual Semantica state.':!s?'No graph counts claimed until the runtime responds.':exact?`${current!.node_count} nodes · ${current!.edge_count} edges · R${current!.revision}${current!.native_reopen?' · reopened by Semantica':' · native reopening unverified'}${current!.mapping_version!=='corpus-evidence/2'?' · legacy mapping; upgrade in handoff':''}`:current?`Graph basis R${current.revision} differs in snapshot, review or validation. Not current for this saved basis.`:'No current accepted generation for this saved basis.';
    if(s){
      if(['running','checking','verifying','exporting'].includes(s.status)){label={running:'Running locally',checking:'Checking runtime',verifying:'Verifying graph',exporting:'Exporting graph'}[s.status]!;detail=`Observed local operation: ${s.status}. ${detail}`;}
      else if(s.status==='failed'||s.lastAttempt?.status==='failed'){label='Latest attempt failed';detail=`${s.lastAttempt?.message??'Open handoff, check the runtime and retry.'} ${detail}`;}
      else if(s.status==='interrupted'||s.lastAttempt?.status==='interrupted'){label='Attempt interrupted';detail=`Saved evidence is retained. Open handoff to retry safely. ${detail}`;}
      else if(s.export?.validated)detail+=` · Portable export verified${s.export.filename?`: ${s.export.filename}`:''}`;
    }
    this.find('overview-runtime').textContent=label;this.find('overview-generation').textContent=detail;
  }
  private record(text:string){this.events.unshift({time:stamp(),text});this.events=this.events.slice(0,6);this.find('overview-events').innerHTML=this.events.map(event=>`<li class="overview-event"><time>${esc(event.time)}</time><span>${esc(event.text)}</span></li>`).join('')}
}
