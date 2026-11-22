import type {Document} from './contracts';
import {validInterval} from './listening';

export interface PlaybackCue {
  readonly wordIds: readonly string[];
  readonly turnIds: readonly string[];
}

export interface PlaybackCues {
  readonly available: boolean;
  at(seconds: number): PlaybackCue | null;
}

interface Target {
  id: string;
  level: 'word' | 'turn';
  parentTurn: string | null;
  order: number;
}

interface Boundary {
  time: number;
  enters: boolean;
  target: Target;
}

/** Build once for a verified document and loaded recording. All positions are
 * supplied intervals in the saved source, including simultaneous speech. */
export function buildPlaybackCues(doc: Pick<Document, 'tokens' | 'segments'>, durationSeconds: number): PlaybackCues {
  const boundaries: Boundary[] = [];
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    const turns = new Map(doc.segments.map(turn => [turn.id, turn]));
    const wholeTurnWords = new Set<string>();
    const repeatedTurnBounds = new Set<string>();
    for (const word of doc.tokens) {
      const turn = word.utterance === null ? undefined : turns.get(word.utterance);
      if (!turn || !validInterval(turn) || word.start_us !== turn.start_us || word.end_us !== turn.end_us) continue;
      if (wholeTurnWords.has(turn.id)) repeatedTurnBounds.add(turn.id);
      wholeTurnWords.add(turn.id);
    }
    const add = (value: {start_us: number | null; end_us: number | null}, target: Target) => {
      if (!validInterval(value) || value.end_us / 1e6 > durationSeconds) return;
      boundaries.push({time: value.start_us / 1e6, enters: true, target}, {time: value.end_us / 1e6, enters: false, target});
    };
    doc.segments.forEach((turn, order) => add(turn, {id: turn.id, level: 'turn', parentTurn: null, order}));
    doc.tokens.forEach((word, order) => {
      const turn = word.utterance === null ? undefined : turns.get(word.utterance);
      // Some imports stamp the same enclosing interval onto several words.
      // That window locates the turn, but cannot distinguish those words.
      if (turn && repeatedTurnBounds.has(turn.id) && word.start_us === turn.start_us && word.end_us === turn.end_us) return;
      add(word, {id: word.id, level: 'word', parentTurn: word.utterance, order});
    });
    boundaries.sort((a, b) => a.time - b.time);
  }

  const active = new Set<Target>();
  let next = 0;
  let current: PlaybackCue | null = null;
  return {
    available: boundaries.length > 0,
    at(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds >= durationSeconds) return null;
      const previous = next;
      // Keep the active set between clock ticks. A backwards seek reverses
      // the crossings. At a shared boundary all exits and entries take effect.
      while (next > 0 && boundaries[next - 1].time > seconds) {
        const {enters, target} = boundaries[--next];
        if (enters) active.delete(target);
        else active.add(target);
      }
      while (next < boundaries.length && boundaries[next].time <= seconds) {
        const {enters, target} = boundaries[next++];
        if (enters) active.add(target);
        else active.delete(target);
      }
      if (next === previous) return current;
      const ordered = [...active].sort((a, b) => a.order - b.order);
      const words = ordered.filter(target => target.level === 'word');
      const timedParents = new Set(words.map(word => word.parentTurn));
      const turns = ordered.filter(target => target.level === 'turn' && !timedParents.has(target.id));
      current = active.size ? {wordIds: words.map(word => word.id), turnIds: turns.map(turn => turn.id)} : null;
      return current;
    },
  };
}
