import type {View} from './contracts';
import {MAX_ANALYSIS_BYTES,MAX_ANALYSIS_DURATION,MAX_DECODED_SAMPLES,type AudioAnalysis} from './audio-analysis';

type Mode='waveform'|'spectrogram'|'spectrum';
const modes:Mode[]=['waveform','spectrogram','spectrum'];
const hz=(n:number)=>n>=1000?`${+(n/1000).toFixed(1)}k`:`${Math.round(n)}`;
const seconds=(n:number)=>`${+n.toFixed(1)} s`;
async function boundedBytes(response:Response){
  const reader=response.body?.getReader();if(!reader)throw new Error('Media stream unavailable');
  const chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_ANALYSIS_BYTES)throw new Error('Analysis resource limit');chunks.push(value)}}
  catch(error){await reader.cancel().catch(()=>{});throw error}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}return bytes.buffer;
}

/** One recording, one cached overview; live analysis observes the existing player. */
export class AudioView {
  private mode:Mode='waveform';
  private epoch=0;private mediaHash:string|null=null;private abort:AbortController|null=null;private worker:Worker|null=null;
  private analysis:AudioAnalysis|null=null;private state='empty';private message='No packaged recording';
  private decoding:Promise<void>=Promise.resolve();
  private base=document.createElement('canvas');private baseKey='';private frame=0;private lastFrame=0;
  private context:AudioContext|null=null;private source:MediaElementAudioSourceNode|null=null;private analyser:AnalyserNode|null=null;
  private frequencies=new Float32Array(1024);private liveError=false;private labelKey='';
  private canvas:HTMLCanvasElement;private status:HTMLElement;private caption:HTMLElement;private axes:HTMLElement;private ruler:HTMLElement;
  private reduced=matchMedia('(prefers-reduced-motion: reduce)');
  constructor(private panel:HTMLElement,private audio:HTMLAudioElement,private summary:HTMLElement){
    try{const saved=localStorage.getItem('wb-recording-view');if(modes.includes(saved as Mode))this.mode=saved as Mode}catch{/* Optional preference. */}
    panel.querySelector('.recording-heading strong')!.insertAdjacentHTML('afterend',`<fieldset class="segmented-radio audio-views"><legend class="sr-only">Audio view</legend>${modes.map(mode=>`<label><input type="radio" name="audio-view" value="${mode}" aria-label="${mode[0].toUpperCase()+mode.slice(1)}"><span>${mode[0].toUpperCase()+mode.slice(1)}</span></label>`).join('')}</fieldset>`);
    panel.querySelector('#recording-waveform')!.outerHTML='<div class="recording-visual"><canvas id="recording-waveform" aria-describedby="recording-analysis-caption recording-analysis-status"></canvas><div class="recording-frequency-axis" aria-hidden="true"></div><div class="recording-time-axis" aria-hidden="true"></div></div><div class="recording-analysis-info"><span id="recording-analysis-caption"></span><span id="recording-analysis-status" role="status"></span></div>';
    this.canvas=panel.querySelector('canvas')!;this.status=panel.querySelector('#recording-analysis-status')!;this.caption=panel.querySelector('#recording-analysis-caption')!;this.axes=panel.querySelector('.recording-frequency-axis')!;this.ruler=panel.querySelector('.recording-time-axis')!;
    for(const input of panel.querySelectorAll<HTMLInputElement>('input[name=audio-view]')){input.checked=input.value===this.mode;input.onchange=()=>{if(!input.checked)return;this.mode=input.value as Mode;try{localStorage.setItem('wb-recording-view',this.mode)}catch{/* Optional preference. */}if(this.mode==='spectrum')void this.startLive();this.draw();this.animate()}}
    const seek=(value:number)=>{if(this.mode==='spectrum'||!this.available())return;audio.currentTime=Math.max(0,Math.min(audio.duration,value));this.draw()};
    const seekPointer=(e:PointerEvent)=>{const r=this.canvas.getBoundingClientRect();if(r.width)seek((e.clientX-r.left)/r.width*audio.duration)};
    this.canvas.onpointerdown=e=>{if(e.button!==0||this.mode==='spectrum'||!this.available())return;this.canvas.focus({preventScroll:true});this.canvas.setPointerCapture(e.pointerId);seekPointer(e);e.preventDefault()};
    this.canvas.onpointermove=e=>{if(this.canvas.hasPointerCapture(e.pointerId))seekPointer(e)};
    this.canvas.onpointerup=e=>{if(this.canvas.hasPointerCapture(e.pointerId)){seekPointer(e);this.canvas.releasePointerCapture(e.pointerId)}};
    this.canvas.onpointercancel=e=>{if(this.canvas.hasPointerCapture(e.pointerId))this.canvas.releasePointerCapture(e.pointerId)};
    this.canvas.onkeydown=e=>{if(this.mode==='spectrum'||e.altKey||e.ctrlKey||e.metaKey||e.isComposing)return;if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();seek(e.key==='Home'?0:e.key==='End'?audio.duration:audio.currentTime+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?5:1))}};
    for(const event of ['timeupdate','loadedmetadata','durationchange','seeked','seeking','play','playing','pause','ended','waiting','canplay','error','emptied','volumechange'])audio.addEventListener(event,()=>{if(event==='play'&&(this.mode==='spectrum'||this.source))void this.startLive();this.draw();this.animate()});
    new MutationObserver(()=>{this.draw();this.animate()}).observe(audio,{attributes:true,attributeFilter:['src','hidden']});
    new MutationObserver(()=>{this.baseKey='';this.draw()}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    new ResizeObserver(()=>{this.draw();this.animate()}).observe(this.canvas);
    document.addEventListener('visibilitychange',()=>{this.draw();this.animate()});this.reduced.addEventListener('change',()=>this.animate());
    this.draw();
  }
  overview(){return {state:this.state,analysis:this.analysis}}
  private available(){return !this.audio.hidden&&!!this.audio.getAttribute('src')&&!this.audio.error&&Number.isFinite(this.audio.duration)&&this.audio.duration>0}
  private async startLive(){
    if(!this.available())return;
    try{
      if(!this.context){this.context=new AudioContext();this.source=this.context.createMediaElementSource(this.audio);this.source.connect(this.context.destination)}
      if(!this.analyser){this.analyser=this.context.createAnalyser();this.analyser.fftSize=2048;this.analyser.smoothingTimeConstant=0;this.analyser.minDecibels=-90;this.analyser.maxDecibels=0;this.source!.connect(this.analyser)}
      await this.context.resume();this.liveError=false;
    }catch{this.liveError=true}
    this.draw();this.animate();
  }
  async update(view:View,media:string|undefined){
    const file=media?view.snapshot.files[media]:undefined,hash=file?.sha256??'';if(hash===this.mediaHash)return;this.mediaHash=hash;
    const epoch=++this.epoch;this.abort?.abort();this.worker?.terminate();this.worker=null;this.abort=new AbortController();const signal=this.abort.signal;
    this.analysis=null;this.baseKey='';this.state=media?'loading':'empty';this.message=media?'Preparing audio views…':'No packaged recording';this.draw();this.panel.dispatchEvent(new Event('wb-audio-analysis',{bubbles:true}));
    if(!media||!file)return;
    const unavailable=(message:string)=>{if(epoch!==this.epoch)return;this.state='unavailable';this.message=message;this.draw();this.panel.dispatchEvent(new Event('wb-audio-analysis',{bubbles:true}));};
    if(file.bytes>MAX_ANALYSIS_BYTES){unavailable('Overview unavailable above 32 MiB · playback and live Spectrum available');return}
    try{
      // Metadata bounds compressed long recordings before allocating decoded PCM.
      if(this.audio.error)throw new Error('Recording metadata unavailable');
      if(!Number.isFinite(this.audio.duration)||!this.audio.duration)await new Promise<void>((resolve,reject)=>{
        const done=()=>{cleanup();resolve()},fail=()=>{cleanup();reject(new Error('Recording metadata unavailable'))};
        const cleanup=()=>{clearTimeout(timer);this.audio.removeEventListener('loadedmetadata',done);this.audio.removeEventListener('error',fail);signal.removeEventListener('abort',fail)};
        const timer=setTimeout(fail,10000);this.audio.addEventListener('loadedmetadata',done,{once:true});this.audio.addEventListener('error',fail,{once:true});signal.addEventListener('abort',fail,{once:true});
      });
      if(signal.aborted)return;
      if(this.audio.duration>MAX_ANALYSIS_DURATION){unavailable('Overview unavailable above 10 minutes · playback and live Spectrum available');return}
      // Browser decoding itself cannot be aborted. Keep at most one in flight,
      // and let only the latest document proceed when an old decode finishes.
      await this.decoding;if(signal.aborted)return;
      const response=await fetch(`/api/media?path=${encodeURIComponent(media)}&revision=${view.revision.id}`,{signal});if(!response.ok)throw new Error('Media read failed');
      if(Number(response.headers.get('Content-Length'))>MAX_ANALYSIS_BYTES)throw new Error('Analysis resource limit');
      const bytes=await boundedBytes(response);
      if(signal.aborted)return;
      // Fixed decode rate bounds memory and supplies a useful speech-frequency overview.
      const decoder=new OfflineAudioContext(1,1,16000),decode=decoder.decodeAudioData(bytes);this.decoding=decode.then(()=>{},()=>{});const decoded=await decode;
      if(signal.aborted)return;
      if(decoded.duration>MAX_ANALYSIS_DURATION||decoded.length*decoded.numberOfChannels>MAX_DECODED_SAMPLES){unavailable('Overview exceeds analysis limits · playback and live Spectrum available');return}
      const channels=Array.from({length:decoded.numberOfChannels},(_,channel)=>decoded.getChannelData(channel));
      this.worker=new Worker(new URL('./audio-analysis.worker.ts',import.meta.url),{type:'module'});const worker=this.worker;
      const result=await new Promise<AudioAnalysis>((resolve,reject)=>{
        worker.onmessage=event=>event.data.error?reject(new Error(event.data.error)):resolve(event.data.result);
        worker.onerror=()=>reject(new Error('Analysis worker unavailable'));
        signal.addEventListener('abort',()=>reject(new Error('Analysis cancelled')),{once:true});
        worker.postMessage({id:epoch,channels,sampleRate:decoded.sampleRate},channels.map(channel=>channel.buffer));
      });
      worker.terminate();if(this.worker===worker)this.worker=null;if(epoch!==this.epoch)return;
      this.analysis=result;this.state='ready';this.message='';this.baseKey='';this.draw();this.panel.dispatchEvent(new Event('wb-audio-analysis',{bubbles:true}));
    }catch{unavailable('Audio overview unavailable · use recording playback')}
    finally{if(epoch===this.epoch){this.worker?.terminate();this.worker=null}}
  }
  private animate(){
    cancelAnimationFrame(this.frame);this.frame=0;
    if(document.hidden||this.audio.paused||!this.available()||!this.canvas.getBoundingClientRect().height)return;
    const tick=(now:number)=>{if(now-this.lastFrame>=(this.reduced.matches?125:33)){this.lastFrame=now;this.draw()}this.frame=requestAnimationFrame(tick)};
    this.frame=requestAnimationFrame(tick);
  }
  private live(){return this.available()&&!this.audio.paused&&!this.audio.ended&&!this.audio.seeking&&this.audio.readyState>=3&&this.context?.state==='running'&&!!this.analyser&&!this.liveError}
  private labels(){
    const available=this.available(),spectrum=this.mode==='spectrum',a=this.analysis;
    this.panel.dataset.audioView=this.mode;this.panel.dataset.analysisState=this.state;
    const summary=available?`${seconds(this.audio.duration)} · original recording`:this.state==='empty'?'No recording':this.state==='loading'?'Loading recording…':'Recording unavailable';if(this.summary.textContent!==summary)this.summary.textContent=summary;
    this.canvas.setAttribute('role',spectrum?'img':'slider');this.canvas.setAttribute('aria-label',spectrum?'Live frequency spectrum':`Seek recording on ${this.mode}`);this.canvas.tabIndex=available&&!spectrum?0:-1;
    if(spectrum){for(const attr of ['aria-valuemin','aria-valuemax','aria-valuenow','aria-valuetext','aria-disabled','aria-description'])this.canvas.removeAttribute(attr)}
    else{this.canvas.setAttribute('aria-disabled',String(!available));this.canvas.setAttribute('aria-valuemin','0');this.canvas.setAttribute('aria-valuemax',String(available?this.audio.duration:0));this.canvas.setAttribute('aria-valuenow',String(available?this.audio.currentTime:0));this.canvas.setAttribute('aria-valuetext',available?`${seconds(this.audio.currentTime)} of ${seconds(this.audio.duration)}`:'No playable recording');this.canvas.setAttribute('aria-description','Drag to scrub. Left and Right arrows seek one second; Shift seeks five seconds. Home and End seek to the recording bounds.')}
    const status=spectrum?(!available?'No playable recording':this.liveError?'Live Spectrum unavailable · playback remains available':this.audio.paused?'Paused — play recording for live frequencies':this.live()?'Live · output frequencies':this.audio.seeking?'Seeking…':'Waiting for audio…'):this.message;
    if(this.status.textContent!==status)this.status.textContent=status;
    const labelKey=[this.mode,this.state,available,this.audio.duration,a?.maxFrequency,this.context?.sampleRate].join(':');
    if(this.labelKey===labelKey)return;this.labelKey=labelKey;
    this.caption.textContent=this.mode==='waveform'?'Amplitude · recording time':this.mode==='spectrogram'?'Sampled overview · log Hz · dBFS −90 to 0':'Live output · log Hz · FFT dB −90 to 0 · seek with player';
    const max=spectrum?Math.min(20000,(this.context?.sampleRate??48000)/2):a?.maxFrequency??8000,min=a?.minFrequency??20;
    this.axes.hidden=this.mode==='waveform';this.axes.innerHTML=spectrum?'<span>0 dB</span><span>−90 dB</span>':`<span>${hz(max)} Hz</span><span>${hz(Math.sqrt(min*max))} Hz</span><span>${hz(min)} Hz</span>`;
    this.ruler.innerHTML=spectrum?`<span>20 Hz</span><span>${hz(Math.sqrt(20*max))} Hz</span><span>${hz(max)} Hz</span>`:`<span>0 s</span><span>${available?seconds(this.audio.duration/2):'Recording time'}</span><span>${available?seconds(this.audio.duration):'—'}</span>`;
  }
  draw(){
    this.labels();const r=this.canvas.getBoundingClientRect();if(!r.width||!r.height)return;
    const ratio=Math.min(2,window.devicePixelRatio||1),width=Math.round(r.width*ratio),height=Math.round(r.height*ratio);
    if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height;this.baseKey=''}
    const c=this.canvas.getContext('2d');if(!c)return;
    const style=getComputedStyle(document.documentElement),ink=style.getPropertyValue('--ink').trim(),wave=style.getPropertyValue('--wave').trim()||'#888';
    const key=[width,height,this.mode,this.state,ink].join(':');
    if(this.baseKey!==key){
      this.baseKey=key;this.base.width=width;this.base.height=height;const b=this.base.getContext('2d')!;
      if(this.mode==='spectrogram'&&this.analysis){
        const a=this.analysis,texture=document.createElement('canvas');texture.width=a.columns;texture.height=a.bins;const t=texture.getContext('2d')!,pixels=t.createImageData(a.columns,a.bins);
        for(let x=0;x<a.columns;x++)for(let y=0;y<a.bins;y++){const value=a.spectrogram[x*a.bins+y],i=((a.bins-1-y)*a.columns+x)*4;pixels.data[i]=20+value*.80;pixels.data[i+1]=23+value*.84;pixels.data[i+2]=25+value*.85;pixels.data[i+3]=255}
        t.putImageData(pixels,0,0);b.imageSmoothingEnabled=false;b.drawImage(texture,0,0,width,height);
      }else if(this.mode==='waveform'&&this.analysis){
        b.strokeStyle=wave;b.lineWidth=ratio;b.beginPath();const peaks=this.analysis.peaks;
        for(let i=0;i<peaks.length;i++){const x=i/peaks.length*width,y=peaks[i]*(height/2-3*ratio);b.moveTo(x,height/2-y);b.lineTo(x,height/2+y)}b.stroke();
      }else{b.strokeStyle=wave;b.globalAlpha=.3;b.beginPath();b.moveTo(0,height/2);b.lineTo(width,height/2);b.stroke();b.globalAlpha=1}
    }
    c.clearRect(0,0,width,height);c.drawImage(this.base,0,0);
    if(this.mode==='spectrum'){
      if(this.live()){
        this.analyser!.getFloatFrequencyData(this.frequencies);const max=Math.min(20000,this.context!.sampleRate/2),count=96;
        c.fillStyle=wave;for(let i=0;i<count;i++){const lo=20*(max/20)**(i/count),hi=20*(max/20)**((i+1)/count);let db=-90;const first=Math.max(1,Math.floor(lo/this.context!.sampleRate*2048)),last=Math.min(this.frequencies.length-1,Math.ceil(hi/this.context!.sampleRate*2048));for(let bin=first;bin<=last;bin++)db=Math.max(db,this.frequencies[bin]);const h=Math.max(0,Math.min(1,(db+90)/90))*(height-3*ratio);c.fillRect(i/count*width,height-h,Math.max(ratio,width/count-2*ratio),h)}
      }
    }else if(this.available()){
      const x=this.audio.currentTime/this.audio.duration*width;c.strokeStyle=this.mode==='spectrogram'?'#f2f2f2':ink;c.lineWidth=ratio;c.beginPath();c.moveTo(x,0);c.lineTo(x,height);c.stroke();
    }
  }
}
