import type {Document} from './contracts';
import {el} from './dom';
import {icon} from './icons';
import {buildPlaybackCues,type PlaybackCues,type PlaybackCue} from './playback-cues';
import {PlaybackReader} from './playback-reader';

/** Drive the reading surface from the same native recording as the timeline. */
export class PlaybackSync {
  private reader:PlaybackReader;
  private doc:Document|null=null;
  private scope='';
  private duration=0;
  private cues:PlaybackCues|null=null;
  private lastCue:PlaybackCue|null=null;
  private lastFollow=false;
  private following=true;
  private frame=0;
  private stalled=false;
  private events=new AbortController();
  private play=el<HTMLButtonElement>('canvas-play');
  private follow=el<HTMLButtonElement>('follow-audio');
  private controls=el('canvas-listening');

  constructor(private audio:HTMLAudioElement, surface:HTMLElement, onFollowTurn:(turn:HTMLElement|null)=>void) {
    const options={signal:this.events.signal};
    this.reader=new PlaybackReader(surface,()=>this.setFollowing(false),onFollowTurn);
    this.play.addEventListener('click',()=>el<HTMLButtonElement>('audio-play').click(),options);
    this.follow.addEventListener('click',()=>this.setFollowing(!this.following),options);
    for(const event of ['loadedmetadata','durationchange','emptied','error']) {
      audio.addEventListener(event,()=>this.refresh(),options);
    }
    audio.addEventListener('waiting',()=>{this.stalled=true;this.tick()},options);
    for(const event of ['play','playing','canplay','pause','ended','ratechange']) {
      audio.addEventListener(event,()=>{
        this.stalled=false;
        this.updateControls();
        this.tick(event==='play');
      },options);
    }
    for(const event of ['seeking','seeked'])audio.addEventListener(event,()=>this.tick(true),options);
    audio.addEventListener('timeupdate',()=>this.tick(),options);
    document.addEventListener('visibilitychange',()=>this.tick(!document.hidden),options);
  }

  bind(doc:Document|null, scope:string) {
    if(this.doc!==doc || (doc && this.scope!==scope)) {
      if(scope && this.scope!==scope)this.following=true;
      this.reader.reset();
      this.lastCue=null;
      this.lastFollow=false;
      this.cues=null;
      this.doc=doc;
      if(scope)this.scope=scope;
    }
    this.refresh();
  }

  destroy() {
    this.events.abort();
    cancelAnimationFrame(this.frame);
    this.reader.destroy();
  }

  private ready() {
    return !!this.doc && this.audio.dataset.mediaScope===this.scope &&
      !this.audio.hidden && !!this.audio.getAttribute('src') && !this.audio.error &&
      this.audio.readyState>=1 && Number.isFinite(this.audio.duration) && this.audio.duration>0;
  }

  private refresh() {
    const previous = this.cues;
    if(this.ready() && this.doc) {
      if(!this.cues || this.duration!==this.audio.duration) {
        this.duration=this.audio.duration;
        this.cues=buildPlaybackCues(this.doc,this.duration);
      }
    } else {
      this.cues=null;
      this.duration=0;
    }
    if (this.cues !== previous) this.reader.setWordStarts(this.cues?.wordStarts ?? [], this.audio.currentTime);
    this.updateControls();
    this.tick();
  }

  private updateControls() {
    this.controls.hidden=!this.doc;
    const playable=this.ready();
    const plays=!this.audio.paused && !this.audio.ended;
    const action=plays?'Pause audio on canvas':'Play audio on canvas';
    if(this.play.getAttribute('aria-label')!==action) {
      this.play.setAttribute('aria-label',action);
      this.play.title=action;
      this.play.innerHTML=icon(plays?'pause':'play_arrow');
    }
    this.play.disabled=!playable;
    this.follow.disabled=!this.cues?.available;
    this.follow.setAttribute('aria-pressed',String(this.following && !!this.cues?.available));
    this.follow.title=!playable?'Waiting for the recording':
      !this.cues?.available?'No word or utterance timestamps for this recording':
      this.following?'Following the recording. Click to read independently.':'Bring the current passage back into view';
    const label=this.follow.querySelector<HTMLElement>('.follow-label')!;
    label.textContent=playable && !this.cues?.available?'No timing':'Follow audio';
  }

  private setFollowing(value:boolean) {
    if(value===this.following || !this.cues?.available)return;
    this.following=value;
    this.updateControls();
    this.tick(value);
  }

  private tick(jump=false) {
    this.reader.updateClock(this.audio.currentTime);
    const cue=this.cues?.at(this.audio.currentTime)??null;
    const follow=this.following && !!this.cues?.available;
    if(cue!==this.lastCue || follow!==this.lastFollow || jump) {
      this.reader.show(cue,follow,{jump});
      this.lastCue=cue;
      this.lastFollow=follow;
    }
    // timeupdate may skip several short words. Only sample between media events
    // while audio is advancing and the reading surface can be seen.
    if(!this.cues?.available || this.audio.paused || this.audio.ended ||
       this.audio.seeking || this.stalled || document.hidden) {
      cancelAnimationFrame(this.frame);
      this.frame=0;
    } else if(!this.frame) {
      this.frame=requestAnimationFrame(()=>{this.frame=0;this.tick()});
    }
  }
}
