import {expect, test} from '@playwright/test';
import type {Document, Segment, Token} from '../src/contracts';
import {suppliedCue} from '../src/listening';
import {buildPlaybackCues} from '../src/playback-cues';

function word(id: string, start_us: number | null, end_us: number | null, utterance: string | null = null): Token {
  return {id, internal_id: id, original: id, corrected: null, normalized: null, attrs: {}, utterance,
    start_us, end_us, language_effective: null, language_source: 'unknown', editable: true};
}

function turn(id: string, start_us: number | null, end_us: number | null): Segment {
  return {id, start_us, end_us, attrs: {}};
}

function documentWith(tokens: Token[], segments: Segment[] = []): Document {
  return {path:'record.xml',title:'Recording',tokens,segments,spans:[],media:[],metadata:{},opaque_elements:[]};
}

test('word boundaries are end-exclusive; turn-only and uncovered periods retain their true precision', () => {
  const cues = buildPlaybackCues({
    tokens: [word('first', 1_000_001, 1_200_000, 'speaker'), word('next', 1_200_000, 1_500_000, 'speaker'),
      word('untimed', null, null, 'speaker'), word('standalone', 2_000_000, 2_750_000)],
    segments: [turn('speaker', 1_000_000, 1_700_000)],
  }, 3);
  expect(cues.available).toBe(true);
  expect(cues.wordStarts).toEqual([
    {id:'untimed',seconds:1}, {id:'first',seconds:1.000001},
    {id:'next',seconds:1.2}, {id:'standalone',seconds:2},
  ]);
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
    expect(cues.wordStarts).toEqual([]);
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

test('a short decoder endpoint difference preserves the final chunk through native audio end', () => {
  const duration = 262.593016;
  const doc = documentWith([word('last', null, null, 'chunk')], [turn('chunk', 235_000_000, 262_595_875)]);
  const cues = buildPlaybackCues(doc, duration);
  expect(cues.at(235)).toEqual({wordIds: [], turnIds: ['chunk']});
  expect(cues.at(duration - 0.000001)).toEqual({wordIds: [], turnIds: ['chunk']});
  expect(cues.at(duration)).toBeNull();
  expect(suppliedCue(doc, ['last'], duration)).toEqual({basis:'utterance', start:235, end:duration});
  // The saved-context preflight runs before media metadata is loaded.
  expect(suppliedCue(doc, ['last'], Infinity)).toEqual({basis:'utterance', start:235, end:262.595875});
});

test('decoder allowance is bounded, end-only and checked on every selected word', () => {
  const duration = 262.593016, endUs = 262_593_016;
  const accepted = documentWith([word('within', endUs - 1_000, endUs + 5_000)]);
  expect(suppliedCue(accepted, ['within'], duration)).toEqual({basis:'word', start:262.592016, end:duration});
  expect(buildPlaybackCues(accepted, duration).at(duration - 0.0005)).toEqual({wordIds:['within'], turnIds:[]});
  for (const invalid of [word('beyond', endUs - 1_000, endUs + 5_001), word('at-end', endUs, endUs + 1),
    word('past-end', endUs + 1, endUs + 2), word('reversed', endUs + 1, endUs)]) {
    expect(buildPlaybackCues(documentWith([invalid]), duration).available).toBe(false);
    const doc = documentWith([word('first', 0, 1_000), invalid]);
    expect(suppliedCue(doc, ['first', invalid.id], duration)).toHaveProperty('reason');
  }
});
