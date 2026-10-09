import type {Document,View} from './contracts';
import {esc} from './dom';
import {icon} from './icons';
import {AudioPlayer} from './player';

function preference(key:string,fallback:number,min:number,max:number){try{const n=Number(localStorage.getItem(key));return n>=min&&n<=max?n:fallback}catch{return fallback}}
export function resizePane(handle:HTMLElement,key:string,min:number,max:number,initial:number,axis:'x'|'y',direction:number,apply:(size:number)=>void,maximum?:()=>number){
  let size=preference(key,initial,min,max),start=0,origin=size;
  const set=(n:number,persist=true)=>{const limit=Math.max(min,Math.min(max,maximum?.()??max));size=Math.round(Math.max(min,Math.min(limit,n)));apply(size);handle.setAttribute('aria-valuemax',String(Math.round(limit)));handle.setAttribute('aria-valuenow',String(size));handle.setAttribute('aria-valuetext',`${size} pixels`);if(persist)try{localStorage.setItem(key,String(size))}catch{/* Optional preference. */}};
  const keys=axis==='y'?['ArrowUp','ArrowDown']:['ArrowLeft','ArrowRight'];
  handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation',axis==='y'?'horizontal':'vertical');handle.setAttribute('aria-valuemin',String(min));handle.setAttribute('aria-valuemax',String(max));
  handle.setAttribute('aria-description',`${axis==='y'?'Up and Down':'Left and Right'} arrows resize. Shift resizes faster. Home collapses to the minimum; End expands to the maximum.`);
  handle.title=handle.getAttribute('aria-label')+`. ${axis==='y'?'Up / Down':'Left / Right'} to resize; Shift for larger steps.`;
  const finish=()=>document.documentElement.removeAttribute('data-resizing');
  handle.onpointerdown=e=>{if(e.button!==0)return;start=axis==='y'?e.clientY:e.clientX;origin=size;handle.setPointerCapture(e.pointerId);document.documentElement.dataset.resizing=axis;e.preventDefault()};
  handle.onpointermove=e=>{if(handle.hasPointerCapture(e.pointerId))set(origin+direction*((axis==='y'?e.clientY:e.clientX)-start),false)};
  handle.onpointerup=e=>{if(handle.hasPointerCapture(e.pointerId)){handle.releasePointerCapture(e.pointerId);set(size)}finish()};
  handle.onpointercancel=e=>{if(handle.hasPointerCapture(e.pointerId)){handle.releasePointerCapture(e.pointerId);set(origin)}finish()};
  handle.onlostpointercapture=finish;
  handle.onkeydown=e=>{if(e.altKey||e.ctrlKey||e.metaKey||e.isComposing)return;if([...keys,'Home','End'].includes(e.key)){e.preventDefault();set(e.key==='Home'?min:e.key==='End'?max:size+(e.key===keys[0]?-1:1)*direction*(e.shiftKey?40:12))}};
  set(size,false);return {set,getSize:()=>size};
}

/** Keep a useful reading surface when saved side panes meet a smaller window. */
export function resizeWorkbenchSides(workspace:HTMLElement,navigationHandle:HTMLElement,propertiesHandle:HTMLElement){
  const root=document.documentElement,navigationPane=navigationHandle.parentElement!,propertiesPane=propertiesHandle.parentElement!;
  const visible=(side:string)=>!workspace.classList.contains(side+'-folded');
  const budget=()=>workspace.clientWidth-320;
  let fitting=true;
  const navigation=resizePane(navigationHandle,'wb-navigation-width',160,360,208,'x',1,size=>root.style.setProperty('--navigation-width',size+'px'),()=>fitting?360:budget()-(visible('properties')?propertiesPane.getBoundingClientRect().width:0));
  const properties=resizePane(propertiesHandle,'wb-properties-width',260,520,304,'x',-1,size=>root.style.setProperty('--properties-width',size+'px'),()=>fitting?520:budget()-(visible('navigation')?navigationPane.getBoundingClientRect().width:0));
  const fit=()=>{
    if(matchMedia('(max-width:700px)').matches){fitting=false;return}
    const showNavigation=visible('navigation'),showProperties=visible('properties');
    let left=navigation.getSize(),right=properties.getSize();
    const available=Math.max((showNavigation?160:0)+(showProperties?260:0),budget());
    const total=(showNavigation?left:0)+(showProperties?right:0);
    if(total>available){
      if(showNavigation&&showProperties){left=Math.max(160,Math.min(available-260,Math.round(left*available/total)));right=available-left}
      else if(showNavigation)left=Math.min(left,available);
      else if(showProperties)right=Math.min(right,available);
    }
    // Apply both values together before deriving either control's moving bound.
    // Automatic fitting leaves the user's saved larger-window preference intact.
    fitting=true;navigation.set(left,false);properties.set(right,false);
    fitting=false;navigation.set(left,false);properties.set(right,false);
  };
  fit();window.addEventListener('resize',fit);
  new MutationObserver(fit).observe(workspace,{attributes:true,attributeFilter:['class']});
  const layout=new ResizeObserver(fit);layout.observe(navigationPane);layout.observe(propertiesPane);
  return {navigation,properties};
}
export class RecordingPanel {
  private canvas:HTMLCanvasElement;private lanes:HTMLElement;private summary:HTMLElement;private peaks:number[]=[];private mediaHash:string|null=null;private epoch=0;private height=100;private view:View|null=null;private doc:Document|null=null;
  constructor(private panel:HTMLElement,private audio:HTMLAudioElement){
    panel.insertAdjacentHTML('afterbegin',`<div id="timeline-resizer" class="pane-resizer" aria-label="Resize recording panel"><span class="resize-grip" aria-hidden="true"></span></div><div class="recording-heading"><strong>${icon("graphic_eq")}Recording</strong><span id="recording-summary"></span><button id="timeline-toggle" class="secondary" aria-label="Cycle recording detail">${icon("unfold_more")}</button></div><canvas id="recording-waveform" aria-label="Recorded audio waveform"></canvas><div id="recording-layers"></div>`);
    const player=new AudioPlayer(audio);
    this.canvas=panel.querySelector('canvas')!;this.lanes=panel.querySelector('#recording-layers')!;this.summary=panel.querySelector('#recording-summary')!;panel.append(this.lanes);
    const resize=resizePane(panel.querySelector('#timeline-resizer')!,'wb-recording-height',70,440,130,'y',-1,size=>{this.height=size;panel.style.height=size+'px';document.documentElement.style.setProperty('--recording-height',size+'px');panel.dataset.detail=size<110?'minimal':size<220?'compact':'expanded';const toggle=panel.querySelector<HTMLButtonElement>('#timeline-toggle')!;toggle.innerHTML=icon(size<220?'expand_less':'expand_more');toggle.setAttribute('aria-label',size<110?'Expand recording panel':size<220?'Show recording timeline':'Collapse recording timeline');toggle.title=toggle.getAttribute('aria-label')!;this.draw();this.renderLanes()});
    panel.querySelector<HTMLButtonElement>('#timeline-toggle')!.onclick=()=>resize.set(this.height<110?180:this.height<220?360:70);
    audio.addEventListener('timeupdate',()=>this.draw());audio.addEventListener('loadedmetadata',()=>{this.draw();this.renderLanes()});new ResizeObserver(()=>this.draw()).observe(this.canvas);
    const fitLanes=()=>{const bounds=panel.getBoundingClientRect();document.documentElement.style.setProperty('--recording-height',bounds.height+'px');const padding=parseFloat(getComputedStyle(panel).paddingBottom)||0;this.lanes.style.maxHeight=Math.max(0,Math.floor(bounds.bottom-this.lanes.getBoundingClientRect().top-padding))+'px'};
    const layout=new ResizeObserver(fitLanes);for(const region of [panel,player.element,this.canvas,panel.querySelector<HTMLElement>('.actions')!])layout.observe(region);
    this.canvas.tabIndex=0;this.canvas.setAttribute('role','slider');this.canvas.setAttribute('aria-label','Seek recording on waveform');this.canvas.setAttribute('aria-valuemin','0');this.canvas.setAttribute('aria-description','Drag to scrub. Left and Right arrows seek one second; Shift seeks five seconds. Home and End seek to the recording bounds.');
    const seek=(value:number)=>{if(!audio.hidden&&!audio.error&&Number.isFinite(audio.duration)&&audio.duration>0){audio.currentTime=Math.max(0,Math.min(audio.duration,value));this.draw()}};
    const seekPointer=(e:PointerEvent)=>{const r=this.canvas.getBoundingClientRect();if(r.width>0)seek((e.clientX-r.left)/r.width*audio.duration)};
    this.canvas.addEventListener('pointerdown',e=>{if(e.button!==0||audio.hidden||audio.error||!Number.isFinite(audio.duration)||audio.duration<=0)return;this.canvas.setPointerCapture(e.pointerId);this.canvas.focus({preventScroll:true});seekPointer(e);e.preventDefault()});
    this.canvas.addEventListener('pointermove',e=>{if(this.canvas.hasPointerCapture(e.pointerId))seekPointer(e)});
    this.canvas.addEventListener('pointerup',e=>{if(this.canvas.hasPointerCapture(e.pointerId)){seekPointer(e);this.canvas.releasePointerCapture(e.pointerId)}});
    this.canvas.addEventListener('pointercancel',e=>{if(this.canvas.hasPointerCapture(e.pointerId))this.canvas.releasePointerCapture(e.pointerId)});
    this.canvas.addEventListener('keydown',e=>{if(e.altKey||e.ctrlKey||e.metaKey||e.isComposing)return;if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();seek(e.key==='Home'?0:e.key==='End'?audio.duration:audio.currentTime+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?5:1))}});
    for(const event of ['emptied','error','durationchange','seeked'])audio.addEventListener(event,()=>this.draw());
    new MutationObserver(()=>this.draw()).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
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
  private draw(){if(!this.canvas)return;const available=!this.audio.hidden&&!this.audio.error&&Number.isFinite(this.audio.duration)&&this.audio.duration>0;this.canvas.setAttribute('aria-disabled',String(!available));this.canvas.setAttribute('aria-valuemax',String(available?this.audio.duration:0));this.canvas.setAttribute('aria-valuenow',String(available?this.audio.currentTime:0));this.canvas.setAttribute('aria-valuetext',available?`${this.audio.currentTime.toFixed(1)} of ${this.audio.duration.toFixed(1)} seconds`:'No playable recording');this.canvas.tabIndex=available?0:-1;const r=this.canvas.getBoundingClientRect(),ratio=window.devicePixelRatio||1;this.canvas.width=Math.max(1,r.width*ratio);this.canvas.height=Math.max(1,r.height*ratio);const c=this.canvas.getContext('2d');if(!c)return;c.scale(ratio,ratio);const color=getComputedStyle(document.documentElement).getPropertyValue('--wave').trim()||'#8a8a8a';c.strokeStyle=color;c.lineWidth=1;
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
