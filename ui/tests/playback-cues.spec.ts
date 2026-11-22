import {expect, test} from '@playwright/test';
import type {Segment, Token} from '../src/contracts';
import {buildPlaybackCues} from '../src/playback-cues';

function word(id: string, start_us: number | null, end_us: number | null, utterance: string | null = null): Token {
  return {id, internal_id: id, original: id, corrected: null, normalized: null, attrs: {}, utterance,
    start_us, end_us, language_effective: null, language_source: 'unknown', editable: true};
}

function turn(id: string, start_us: number | null, end_us: number | null): Segment {
  return {id, start_us, end_us, attrs: {}};
}

test('word boundaries are end-exclusive; turn-only and uncovered periods retain their true precision', () => {
  const cues = buildPlaybackCues({
    tokens: [word('first', 1_000_001, 1_200_000, 'speaker'), word('next', 1_200_000, 1_500_000, 'speaker'),
      word('untimed', null, null, 'speaker'), word('standalone', 2_000_000, 2_750_000)],
    segments: [turn('speaker', 1_000_000, 1_700_000)],
  }, 3);
  expect(cues.available).toBe(true);
  expect(cues.at(0.75)).toBeNull();
  expect(cues.at(1)).toEqual({wordIds: [], turnIds: ['speaker']});
  const first = cues.at(1.000001);
  expect(first).toEqual({wordIds: ['first'], turnIds: []});
  expect(cues.at(1.19999999)).toBe(first);
  expect(cues.at(1.2)).toEqual({wordIds: ['next'], turnIds: []});
  expect(cues.at(1.5)).toEqual({wordIds: [], turnIds: ['speaker']});
  expect(cues.at(1.7)).toBeNull();
  expect(cues.at(2.1)).toEqual({wordIds: ['standalone'], turnIds: []});
  expect(cues.at(2.75)).toBeNull();
  expect(cues.at(1.2)).toEqual({wordIds: ['next'], turnIds: []});
});

test('overlap shows each speaker at the supplied resolution, in source order after seeks in either direction', () => {
  const cues = buildPlaybackCues({
    tokens: [word('late-word', 2_000_000, 4_000_000, 'first-turn'), word('early-word', 0, 3_000_000, 'second-turn'),
      word('partial', null, 2_700_000, 'chunk')],
    segments: [turn('first-turn', 0, 5_000_000), turn('second-turn', 0, 5_000_000), turn('chunk', 1_000_000, 4_000_000)],
  }, 5);
  const overlap = cues.at(2.1);
  expect(overlap).toEqual({wordIds: ['late-word','early-word'], turnIds: ['chunk']});
  expect(cues.at(2.99)).toBe(overlap);
  expect(cues.at(4.01)).toEqual({wordIds: [], turnIds: ['first-turn','second-turn']});
  expect(cues.at(0)).toEqual({wordIds: ['early-word'], turnIds: ['first-turn']});
  expect(cues.at(2.2)).toEqual(overlap);
  expect(cues.at(5)).toBeNull();
  expect(cues.at(-1)).toBeNull();
  expect(cues.at(Number.NaN)).toBeNull();
  expect(cues.at(2.3)).toEqual(overlap);
});

test('rejects incomplete, invalid and out-of-recording intervals without stretching them to fit', () => {
  const observed = {
    tokens: [word('missing', null, null), word('partial', 1, null), word('empty', 3, 3),
      word('reversed', 3, 2), word('negative', -1, 5), word('overlong', 2_000_000, 4_000_000),
      word('nonfinite', 0, Infinity)],
    segments: [turn('past-end', 2_000_000, 4_000_000)],
  };
  for (const duration of [3, 0, Infinity, Number.NaN]) {
    const cues = buildPlaybackCues(observed, duration);
    expect(cues.available).toBe(false);
    expect(cues.at(2.5)).toBeNull();
  }
});

test('repeated full-turn windows and prepared chunks give passage cues, with individually timed words still eligible', () => {
  const cues = buildPlaybackCues({
    tokens: [word('a', 0, 2_000_000, 'legacy'), word('b', 0, 2_000_000, 'legacy'),
      word('specific', 1_000_000, 1_100_000, 'legacy'), word('chunk-token', null, null, 'chunk-000001'),
      word('one-word', 4_000_000, 5_000_000, 'single')],
    segments: [turn('legacy', 0, 2_000_000), turn('chunk-000001', 2_000_000, 3_000_000), turn('single', 4_000_000, 5_000_000)],
  }, 5);
  expect(cues.at(0.5)).toEqual({wordIds: [], turnIds: ['legacy']});
  expect(cues.at(1.05)).toEqual({wordIds: ['specific'], turnIds: []});
  expect(cues.at(2.5)).toEqual({wordIds: [], turnIds: ['chunk-000001']});
  expect(cues.at(3)).toBeNull();
  expect(cues.at(4)).toEqual({wordIds: ['one-word'], turnIds: []});
});
