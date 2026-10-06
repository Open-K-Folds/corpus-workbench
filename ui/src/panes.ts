import type {Document,View} from './contracts';
import {esc} from './dom';
import {icon} from './icons';
import {AudioPlayer} from './player';

function preference(key:string,fallback:number,min:number,max:number){try{const n=Number(localStorage.getItem(key));return n>=min&&n<=max?n:fallback}catch{return fallback}}
export function resizePane(handle:HTMLElement,key:string,min:number,max:number,initial:number,axis:'x'|'y',direction:number,apply:(size:number)=>void){
  let size=preference(key,initial,min,max),start=0,origin=size;
  const set=(n:number,persist=true)=>{size=Math.round(Math.max(min,Math.min(max,n)));apply(size);handle.setAttribute('aria-valuenow',String(size));handle.setAttribute('aria-valuetext',`${size} pixels`);if(persist)try{localStorage.setItem(key,String(size))}catch{/* Optional preference. */}};
  handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation',axis==='y'?'horizontal':'vertical');handle.setAttribute('aria-valuemin',String(min));handle.setAttribute('aria-valuemax',String(max));
  handle.onpointerdown=e=>{if(e.button!==0)return;start=axis==='y'?e.clientY:e.clientX;origin=size;handle.setPointerCapture(e.pointerId);e.preventDefault()};
  handle.onpointermove=e=>{if(handle.hasPointerCapture(e.pointerId))set(origin+direction*((axis==='y'?e.clientY:e.clientX)-start),false)};
  handle.onpointerup=e=>{if(handle.hasPointerCapture(e.pointerId)){handle.releasePointerCapture(e.pointerId);set(size)}};
  handle.onpointercancel=e=>{if(handle.hasPointerCapture(e.pointerId)){handle.releasePointerCapture(e.pointerId);set(origin)}};
  handle.onkeydown=e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();set(e.key==='Home'?min:e.key==='End'?max:size+(e.key==='ArrowUp'||e.key==='ArrowLeft'?-1:1)*direction*(e.shiftKey?40:12))}};
  set(size,false);return {set};
}
export class RecordingPanel {
  private canvas:HTMLCanvasElement;private lanes:HTMLElement;private summary:HTMLElement;private peaks:number[]=[];private mediaHash='';private epoch=0;private height=100;private view:View|null=null;private doc:Document|null=null;
  constructor(private panel:HTMLElement,private audio:HTMLAudioElement){
    panel.insertAdjacentHTML('afterbegin',`<div id="timeline-resizer" class="pane-resizer" aria-label="Resize recording panel"><span class="resize-grip" aria-hidden="true"></span></div><div class="recording-heading"><strong>${icon("graphic_eq")}Recording</strong><span id="recording-summary"></span><button id="timeline-toggle" class="secondary" aria-label="Cycle recording detail">${icon("unfold_more")}</button></div><canvas id="recording-waveform" aria-label="Recorded audio waveform"></canvas><div id="recording-layers"></div>`);
    new AudioPlayer(audio);
    this.canvas=panel.querySelector('canvas')!;this.lanes=panel.querySelector('#recording-layers')!;this.summary=panel.querySelector('#recording-summary')!;panel.append(this.lanes);
    const resize=resizePane(panel.querySelector('#timeline-resizer')!,'wb-recording-height',70,440,130,'y',-1,size=>{this.height=size;panel.style.height=size+'px';document.documentElement.style.setProperty('--recording-height',size+'px');panel.dataset.detail=size<110?'minimal':size<220?'compact':'expanded';const toggle=panel.querySelector<HTMLButtonElement>('#timeline-toggle')!;toggle.innerHTML=icon(size<220?'expand_less':'expand_more');toggle.setAttribute('aria-label',size<110?'Expand recording panel':size<220?'Show recording timeline':'Collapse recording timeline');toggle.title=toggle.getAttribute('aria-label')!;this.draw();this.renderLanes()});
    panel.querySelector<HTMLButtonElement>('#timeline-toggle')!.onclick=()=>resize.set(this.height<110?180:this.height<220?360:70);
    audio.addEventListener('timeupdate',()=>this.draw());audio.addEventListener('loadedmetadata',()=>{this.draw();this.renderLanes()});new ResizeObserver(()=>this.draw()).observe(this.canvas);
    new ResizeObserver(()=>document.documentElement.style.setProperty('--recording-height',panel.getBoundingClientRect().height+'px')).observe(panel);
    this.canvas.addEventListener('pointerdown',e=>{if(Number.isFinite(audio.duration)&&audio.duration>0){const r=this.canvas.getBoundingClientRect();audio.currentTime=Math.max(0,Math.min(audio.duration,(e.clientX-r.left)/r.width*audio.duration))}});
  }
  async update(view:View,doc:Document,media:string|undefined){
    this.view=view;this.doc=doc;this.renderLanes();
    const hash=media?view.snapshot.files[media]?.sha256??'':'';if(hash===this.mediaHash)return;this.mediaHash=hash;const epoch=++this.epoch;this.peaks=[];this.draw();
    if(!media){this.summary.textContent='No unambiguous packaged recording';return}
    this.summary.textContent='Loading recorded waveform';
    if(view.snapshot.files[media].bytes>32*1024*1024){this.summary.textContent='Waveform unavailable above 32 MiB · playback remains available';return}
    let context:AudioContext|null=null;
    try{const response=await fetch(`/api/media?path=${encodeURIComponent(media)}&revision=${view.revision.id}`);if(!response.ok)throw new Error('Media read failed');const bytes=await response.arrayBuffer();if(bytes.byteLength>32*1024*1024)throw new Error('Waveform resource limit');context=new AudioContext();const decoded=await context.decodeAudioData(bytes);if(epoch!==this.epoch)return;
      const buckets=800;for(let b=0;b<buckets;b++){let peak=0;const first=Math.floor(b*decoded.length/buckets),last=Math.floor((b+1)*decoded.length/buckets);for(let channel=0;channel<decoded.numberOfChannels;channel++){const samples=decoded.getChannelData(channel);for(let i=first;i<last;i++)peak=Math.max(peak,Math.abs(samples[i]))}this.peaks.push(peak)}
      this.summary.textContent=`${decoded.duration.toFixed(1)} s · original recording`;this.draw();
    }catch{if(epoch===this.epoch)this.summary.textContent='Waveform unavailable · use the recording player'}finally{await context?.close()}
  }
  private draw(){if(!this.canvas)return;const r=this.canvas.getBoundingClientRect(),ratio=window.devicePixelRatio||1;this.canvas.width=Math.max(1,r.width*ratio);this.canvas.height=Math.max(1,r.height*ratio);const c=this.canvas.getContext('2d');if(!c)return;c.scale(ratio,ratio);const color=getComputedStyle(document.documentElement).getPropertyValue('--wave').trim()||'#8a8a8a';c.strokeStyle=color;c.lineWidth=1;
    c.beginPath();if(this.peaks.length){const scale=Math.max(.01,...this.peaks);this.peaks.forEach((p,i)=>{const x=i/this.peaks.length*r.width,y=Math.max(1,p/scale*(r.height/2-4));c.moveTo(x,r.height/2-y);c.lineTo(x,r.height/2+y)})}else{c.moveTo(0,r.height/2);c.lineTo(r.width,r.height/2)}c.stroke();
    if(Number.isFinite(this.audio.duration)&&this.audio.duration>0){const x=this.audio.currentTime/this.audio.duration*r.width;c.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();c.beginPath();c.moveTo(x,0);c.lineTo(x,r.height);c.stroke()}}
  private renderLanes(){if(!this.lanes||!this.doc||!this.view)return;const duration=this.audio.duration;const timed=this.doc.segments.filter(s=>s.start_us!==null&&s.end_us!==null&&s.start_us>=0&&s.end_us>s.start_us);const extent=Number.isFinite(duration)&&duration>0?duration:Math.max(0,...timed.map(s=>s.end_us!/1e6));
    const lane=(label:string,items:{id:string;start:number;end:number;className?:string;title:string}[])=>`<div class="timeline-lane"><span class="lane-label">${label}</span><div class="lane-track">${items.map(i=>`<span class="interval ${i.className??''}" data-start="${i.start}" data-end="${i.end}" title="${esc(i.title)}">${esc(i.id)}</span>`).join('')}</div></div>`;
    const segments=timed.map(s=>({id:s.id,start:s.start_us!/1e6,end:s.end_us!/1e6,title:`${s.id} · supplied utterance bounds ${s.start_us!/1e6}–${s.end_us!/1e6} s`}));
    const words=this.doc.tokens.filter(t=>t.start_us!==null&&t.end_us!==null&&t.end_us>t.start_us).map(t=>({id:t.id,start:t.start_us!/1e6,end:t.end_us!/1e6,title:`${t.id} · supplied word bounds`}));
    const changes=this.doc.tokens.filter(t=>t.corrected!==null);const groups=timed.filter(s=>changes.some(t=>t.utterance===s.id)).map(s=>({id:`${s.id} corrections`,start:s.start_us!/1e6,end:s.end_us!/1e6,className:'association',title:'Corrected tokens associated with this utterance. Exact word time may be unavailable; correction revision is inspected in History.'}));
    this.lanes.innerHTML=`<div class="timeline-ruler"><span>0 s</span><span>${extent?extent.toFixed(1)+' s':'No observed time axis'}</span></div>${extent?lane('Utterances',segments):'<p>No supplied utterance intervals</p>'}${words.length&&extent?lane('Word timing',words):'<div class="timeline-lane"><span class="lane-label">Word timing</span><small>No complete word times · no inference</small></div>'}${extent?lane('Corrections',groups):''}<div class="text-only-tray">Text-only / unresolved: ${this.doc.spans.filter(s=>s.fields.wb_status==='unresolved').map(s=>esc(s.id)).join(', ')||'none marked'} · ${this.view.issues.filter(i=>i.blocking).length} blocking / ${this.view.issues.filter(i=>!i.blocking).length} advisory package issues</div>`;
    for(const track of this.lanes.querySelectorAll<HTMLElement>('.lane-track')){
      const ends:number[]=[];
      for(const element of track.querySelectorAll<HTMLElement>('.interval')){
        const start=Number(element.dataset.start),end=Number(element.dataset.end);let row=ends.findIndex(last=>last<=start);if(row<0)row=ends.length;ends[row]=end;
        element.style.left=(start/extent*100)+'%';element.style.width=((end-start)/extent*100)+'%';element.style.top=(3+row*24)+'px';
      }
      track.style.height=Math.max(24,ends.length*24)+'px';
    }
  }
}
