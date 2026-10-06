import {icon} from './icons';

const time=(value:number)=>{
  if(!Number.isFinite(value)||value<0)return '--:--';
  const s=Math.floor(value),hours=Math.floor(s/3600);
  return (hours?hours+':':'')+String(Math.floor(s/60)%60).padStart(hours?2:1,'0')+':'+String(s%60).padStart(2,'0');
};

/** Native media engine, shared accessible controls; never loads or autoplays media. */
export class AudioPlayer {
  readonly element:HTMLElement;
  private play:HTMLButtonElement;private mute:HTMLButtonElement;private seek:HTMLInputElement;
  private volume:HTMLInputElement;private speed:HTMLSelectElement;private clock:HTMLElement;private status:HTMLElement;
  private waiting=false;private enabled=true;private playable:boolean|undefined;
  constructor(private audio:HTMLAudioElement,label='Recording playback'){
    audio.controls=false;audio.classList.add('media-engine');
    const prefix=audio.id;
    this.element=document.createElement('div');this.element.className='media-player';this.element.setAttribute('role','group');this.element.setAttribute('aria-label',label);
    this.element.innerHTML=`<button type="button" id="${prefix}-play" class="icon-button player-play" aria-label="Play recording">${icon('play_arrow')}</button><span id="${prefix}-clock" class="player-time" aria-hidden="true">0:00 / --:--</span><label class="player-seek"><span class="sr-only">Seek recording</span><input id="${prefix}-seek" type="range" min="0" max="0" step="0.1" value="0"></label><div class="player-volume"><button type="button" id="${prefix}-mute" class="icon-button" aria-label="Mute recording" aria-pressed="false">${icon('volume_up')}</button><label><span class="sr-only">Recording volume</span><input id="${prefix}-volume" type="range" min="0" max="1" step="0.05" value="1"></label></div><label class="player-speed">Speed<select id="${prefix}-speed"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></label><span id="${prefix}-status" class="player-status" role="status"></span>`;
    audio.after(this.element);
    const find=<T extends HTMLElement>(id:string)=>this.element.querySelector<T>('#'+prefix+'-'+id)!;
    this.play=find('play');this.mute=find('mute');this.seek=find('seek');this.volume=find('volume');this.speed=find('speed');this.clock=find('clock');this.status=find('status');
    this.play.onclick=()=>{if(!audio.paused){audio.pause();return}if(audio.ended)audio.currentTime=0;void audio.play().catch(()=>{this.waiting=false;this.sync();this.status.textContent='Playback could not start. Try Play again.'})};
    this.seek.oninput=()=>{if(Number.isFinite(audio.duration)&&audio.duration>0)audio.currentTime=Math.max(0,Math.min(audio.duration,Number(this.seek.value)))};
    this.mute.onclick=()=>{audio.muted=!audio.muted};
    this.volume.oninput=()=>{audio.volume=Number(this.volume.value);if(audio.volume>0)audio.muted=false};
    this.speed.onchange=()=>{audio.playbackRate=Number(this.speed.value)};
    for(const event of ['loadedmetadata','durationchange','timeupdate','play','pause','ended','volumechange','ratechange','error','emptied'])audio.addEventListener(event,()=>this.sync());
    audio.addEventListener('waiting',()=>{this.waiting=true;this.sync()});
    audio.addEventListener('loadstart',()=>{this.waiting=true;this.sync()});
    audio.addEventListener('playing',()=>{this.waiting=false;this.sync()});
    audio.addEventListener('canplay',()=>{this.waiting=false;this.sync()});
    new MutationObserver(()=>this.sync()).observe(audio,{attributes:true,attributeFilter:['src','hidden']});
    this.sync();
  }
  setEnabled(enabled:boolean){this.enabled=enabled;this.sync()}
  private sync(){
    const a=this.audio,hasSource=!!a.getAttribute('src');
    this.element.hidden=a.hidden||!hasSource;
    const duration=Number.isFinite(a.duration)&&a.duration>0?a.duration:0;
    const available=this.enabled&&hasSource&&duration>0&&a.readyState>=1&&!a.error;
    // Do not undo an authoring lock on each timeupdate.
    if(available!==this.playable){this.playable=available;for(const control of [this.play,this.mute,this.seek,this.volume,this.speed])control.disabled=!available}
    this.play.innerHTML=icon(a.paused?'play_arrow':'pause');
    this.play.setAttribute('aria-label',a.paused?(a.ended?'Play recording from start':'Play recording'):'Pause recording');
    this.mute.innerHTML=icon(a.muted||a.volume===0?'volume_off':'volume_up');this.mute.setAttribute('aria-pressed',String(a.muted));
    this.clock.textContent=time(a.currentTime)+' / '+time(a.duration);
    this.seek.max=String(duration);this.seek.value=String(Math.max(0,Math.min(duration,a.currentTime)));
    this.seek.setAttribute('aria-valuetext',time(a.currentTime)+' of '+time(a.duration));
    this.seek.style.setProperty('--range-progress',duration?a.currentTime/duration*100+'%':'0%');
    this.volume.value=String(a.muted?0:a.volume);this.volume.setAttribute('aria-valuetext',Math.round((a.muted?0:a.volume)*100)+' percent');
    this.volume.style.setProperty('--range-progress',(a.muted?0:a.volume)*100+'%');this.speed.value=String(a.playbackRate);
    this.status.textContent=a.error?'Recording unavailable. Reopen the document to retry.':!this.enabled?'Playback unavailable for these results.':!duration?'Loading recording…':a.ended?'Recording ended':this.waiting&&!a.paused?'Buffering…':'';
  }
}
