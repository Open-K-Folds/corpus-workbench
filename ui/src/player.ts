import {UiSchema} from '@effect/ui';
import {BrowserHost, Html} from '@effect/ui/html';
import {Schema} from 'effect';
import {runComponent} from './app-runtime';
import {icon} from './icons';

function time(value: number) {
  if (!Number.isFinite(value) || value < 0) return '--:--';
  const seconds = Math.floor(value);
  const hours = Math.floor(seconds / 3600);
  return (hours ? hours + ':' : '') + String(Math.floor(seconds / 60) % 60).padStart(hours ? 2 : 1, '0') +
    ':' + String(seconds % 60).padStart(2, '0');
}

const Media = Schema.Struct({
  hidden: Schema.Boolean, available: Schema.Boolean, paused: Schema.Boolean, ended: Schema.Boolean,
  muted: Schema.Boolean, duration: Schema.Number, position: Schema.Number, volume: Schema.Number, speed: Schema.Number,
  status: Schema.String,
});
const Control = UiSchema.TaggedEnum({
  TogglePlay: {}, ToggleMute: {}, Seek: {value: Schema.Number}, Volume: {value: Schema.Number}, Speed: {value: Schema.Number},
});
const Message = UiSchema.TaggedEnum({ReceivedMedia: {media: Media}, UsedControl: {control: Control}});
const Player = Html.component({
  name: 'RecordingPlayer', props: Schema.Struct({id: Schema.String, label: Schema.String, initial: Media}),
  model: Media, message: Message, events: Control,
}).make({
  init: ({props}) => props.initial,
  update: {
    ReceivedMedia: (_, {media}) => media,
    UsedControl: ($, {control}) => $.model.available ? $.emit(control) : $.model,
  },
  view: (h, media) => {
    const {id, label} = h.props;
    const playLabel = media.paused ? (media.ended ? 'Play recording from start' : 'Play recording') : 'Pause recording';
    const muteLabel = media.muted ? 'Unmute recording' : 'Mute recording';
    // Native form locks may temporarily disable these controls during a save.
    const disabled = media.available ? undefined : '';
    return h.div.class('media-player').attrs({role: 'group', 'aria-label': label, hidden: media.hidden ? '' : undefined}).children(
      h.div.class('player-position').children(
        h.button.id(id + '-play').class('icon-button player-play').attrs({type: 'button', title: playLabel, 'aria-label': playLabel, disabled})
          .on('click', Message.UsedControl({control: Control.TogglePlay()})).children(icon(media.paused ? 'play_arrow' : 'pause')),
        h.span.id(id + '-clock').class('player-time').attr('aria-hidden', 'true')
          .children(h.b(time(media.position)), h.span(' / ' + (media.duration ? time(media.duration) : '--:--'))),
        h.label.class('player-seek').children(h.span.class('sr-only').children('Seek recording'),
          h.input.id(id + '-seek').attrs({type: 'range', min: '0', max: String(media.duration), step: '0.1', disabled,
            'aria-valuetext': time(media.position) + ' of ' + (media.duration ? time(media.duration) : '--:--')})
            .value(String(media.position))
            .on('input', ({value}) => Message.UsedControl({control: Control.Seek({value: Number(value)})}))),
      ),
      h.div.class('player-settings').children(
        h.div.class('player-volume').children(
          h.button.id(id + '-mute').class('icon-button').attrs({type: 'button', title: muteLabel, 'aria-label': muteLabel, 'aria-pressed': String(media.muted), disabled})
            .on('click', Message.UsedControl({control: Control.ToggleMute()})).children(icon(media.muted || !media.volume ? 'volume_off' : 'volume_up')),
          h.label(h.span.class('sr-only').children('Recording volume'), h.input.id(id + '-volume')
            .attrs({type: 'range', min: '0', max: '1', step: '0.05', disabled, 'aria-valuetext': Math.round((media.muted ? 0 : media.volume) * 100) + ' percent'})
            .value(String(media.muted ? 0 : media.volume))
            .on('input', ({value}) => Message.UsedControl({control: Control.Volume({value: Number(value)})})))),
        h.label.class('player-speed').attr('title', 'Playback speed').children(h.span.class('sr-only').children('Speed'),
          h.select.id(id + '-speed').attr('disabled', disabled).value(String(media.speed))
            .on('change', ({value}) => Message.UsedControl({control: Control.Speed({value: Number(value)})}))
            .children([0.75, 1, 1.25, 1.5].map(rate => h.option.key(String(rate)).attr('value', String(rate)).children(rate + '×')))),
      ),
      h.span.id(id + '-status').class('player-status').attr('role', 'status').children(media.status),
    );
  },
});

/** One native media engine per player. The scoped view reflects media events and emits user requests. */
export class AudioPlayer {
  readonly element: HTMLElement;
  private enabled = true;
  private waiting = false;
  private readonly sync: () => void;

  constructor(audio: HTMLAudioElement, signal: AbortSignal, label = 'Recording playback') {
    audio.controls = false;
    audio.classList.add('media-engine');
    const stage = document.createElement('div');
    stage.className = 'player-mount';
    audio.after(stage);
    let playbackError = '';
    const snapshot = (): typeof Media.Type => {
      const hasSource = !!audio.getAttribute('src');
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      return {
        hidden: audio.hidden || !hasSource, available: this.enabled && hasSource && duration > 0 && audio.readyState >= 1 && !audio.error,
        duration, position: Math.max(0, Math.min(duration, audio.currentTime)), paused: audio.paused, ended: audio.ended,
        speed: audio.playbackRate, muted: audio.muted, volume: audio.volume,
        status: playbackError || (audio.error ? 'Recording unavailable. Reopen the document to retry.' :
          !this.enabled ? 'Playback unavailable for these results.' : !duration ? 'Loading recording…' :
          audio.ended ? 'Recording ended' : this.waiting && !audio.paused ? 'Buffering…' : ''),
      };
    };
    const act = (control: typeof Control.Type) => {
      switch (control._tag) {
        case 'TogglePlay':
          if (!audio.paused) { audio.pause(); break; }
          if (audio.ended) audio.currentTime = 0;
          void audio.play().catch(() => {
            this.waiting = false;
            playbackError = 'Playback could not start. Try Play again.';
            this.sync();
          });
          break;
        case 'Seek': if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, control.value)); break;
        case 'ToggleMute': audio.muted = !audio.muted; break;
        case 'Volume': audio.volume = control.value; if (audio.volume > 0) audio.muted = false; break;
        case 'Speed': audio.playbackRate = control.value; break;
      }
      this.sync();
    };
    const root = runComponent(BrowserHost.mountEffect(Player, {id: audio.id, label, initial: snapshot()}, stage,
      {head: false, onEmit: act}), signal);
    this.element = stage.firstElementChild as HTMLElement;
    const seek = this.element.querySelector<HTMLInputElement>('.player-seek input')!;
    const volume = this.element.querySelector<HTMLInputElement>('.player-volume input')!;
    this.sync = () => {
      const media = snapshot();
      root.send(Message.ReceivedMedia({media}));
      seek.style.setProperty('--range-progress', (media.duration ? media.position / media.duration * 100 : 0) + '%');
      volume.style.setProperty('--range-progress', (media.muted ? 0 : media.volume * 100) + '%');
    };
    this.sync();
    for (const type of ['loadedmetadata', 'durationchange', 'timeupdate', 'seeking', 'seeked', 'play', 'pause', 'ended',
      'volumechange', 'ratechange', 'error', 'emptied', 'waiting', 'loadstart', 'playing', 'canplay']) {
      audio.addEventListener(type, () => {
        if (type === 'waiting' || type === 'loadstart') this.waiting = true;
        if (type === 'playing' || type === 'canplay') this.waiting = false;
        playbackError = '';
        this.sync();
      }, {signal});
    }
    const observer = new MutationObserver(this.sync);
    observer.observe(audio, {attributes: true, attributeFilter: ['src', 'hidden']});
    signal.addEventListener('abort', () => observer.disconnect(), {once: true});
  }

  setEnabled(enabled: boolean) { this.enabled = enabled; this.sync(); }
}
