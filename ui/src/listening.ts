import type {Document, View} from './contracts';

export interface PassageAnchor {project:string; revision:number; snapshot_hash:string; document:string; token_ids:string[]}
export interface RecordingCue {basis:'word'|'utterance'; start:number; end:number}
export type CueState = RecordingCue | {reason:string};
export interface Listening {
  check:(anchor:PassageAnchor)=>CueState;
  play:(anchor:PassageAnchor, bounded?:boolean)=>Promise<void>;
}

export function passageAnchor(view:View, document:string, ids:string[]):PassageAnchor {
  return {project:view.snapshot.project,revision:view.revision.id,snapshot_hash:view.revision.snapshot_hash,document,token_ids:ids};
}

export function suppliedCue(doc:Document, ids:string[], duration:number):CueState {
  if (!ids.length) return {reason:'Select a timed passage.'};
  const tokens = new Map(doc.tokens.map(token => [token.id,token]));
  const segments = new Map(doc.segments.map(segment => [segment.id,segment]));
  let start = Infinity, end = -Infinity, basis:RecordingCue['basis'] = 'word';
  for (const id of ids) {
    const token = tokens.get(id);
    if (!token) return {reason:'The source token is unavailable.'};
    const wordTimed = validInterval(token);
    const interval = wordTimed ? token : segments.get(token.utterance ?? '');
    if (!interval || !validInterval(interval)) return {reason:'No complete supplied timing for this passage.'};
    const bounds = boundsOnRecording(interval, duration);
    if (!bounds) return {reason:'The supplied timing extends beyond this recording.'};
    if (!wordTimed) basis = 'utterance';
    start = Math.min(start, bounds.start);
    end = Math.max(end, bounds.end);
  }
  return {basis,start,end};
}

export function validInterval(value:{start_us:number|null;end_us:number|null}):value is {start_us:number;end_us:number} {
  return value.start_us !== null && value.end_us !== null && Number.isFinite(value.start_us)
    && Number.isFinite(value.end_us) && value.start_us >= 0 && value.end_us > value.start_us;
}

// A hash-matched AAC reported a duration 2,859 µs shorter than its decoded
// PCM's supplied endpoint. Limit that allowance to the last 5 ms of playback.
const decoderEndToleranceUs = 5_000;

export function boundsOnRecording(value:{start_us:number|null;end_us:number|null}, duration:number) {
  if (!validInterval(value) || !(duration > 0)) return null;
  const start = value.start_us / 1e6;
  if (start >= duration || (value.end_us - decoderEndToleranceUs) / 1e6 > duration) return null;
  return {start, end: Math.min(value.end_us / 1e6, duration)};
}
