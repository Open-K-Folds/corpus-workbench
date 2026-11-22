import assert from 'node:assert/strict';
import test from 'node:test';
import {findCandidates, makePassage} from '../src/training-candidates.ts';

const hash = 'a'.repeat(64), file = 'b'.repeat(64);
const limit = {limit: 10};
function doc(path, groups) {
  let number = 0;
  const tokens = groups.flatMap(([utterance, words]) => words.map(original => ({
    id: 'w' + ++number, utterance, original, corrected: null, normalized: null,
    language_effective: null, start_us: null, end_us: null, attrs: {},
  })));
  return {
    path, title: path, tokens, segments: groups.filter(([id]) => id !== null).map(([id, , who]) => ({
      id, attrs: who ? {who} : {}, start_us: null, end_us: null,
    })),
  };
}
function view(...documents) {
  return {
    revision: {id: 12, snapshot_hash: hash},
    snapshot: {project: 'research', files: Object.fromEntries(documents.map(d => [d.path, {sha256: file}]))},
    documents,
  };
}

test('grounding reconstructs the saved reading and retains its exact authority, identities and observed metadata', () => {
  const d = doc('field.xml', [['a', ['A', 'cafe\u0301', 'opens.'], '#s1 #s2'], ['b', ['Later.']]]);
  d.tokens[0].corrected = 'The';
  d.media = ['interview.wav'];
  d.tokens[1].normalized = 'coffeehouse';
  for (const [i, token] of d.tokens.slice(0, 2).entries()) {
    Object.assign(token, {start_us: 400 + i * 300, end_us: 600 + i * 300, language_effective: 'en'});
  }
  const v = view(d);
  assert.deepEqual(makePassage(v, d, ['w2', 'w1']), {
    project: 'research', revision: 12, snapshotHash: hash, document: 'field.xml', documentHash: file, title: 'field.xml',
    utterance: 'a', tokenIds: ['w1', 'w2'], quote: 'The cafe\u0301', speaker: '#s1 #s2', language: 'en',
    mediaReferences: ['interview.wav'],
    readings: [{id: 'w1', original: 'A', corrected: 'The', language: 'en'},
      {id: 'w2', original: 'cafe\u0301', corrected: null, language: 'en'}],
    startUs: 400, endUs: 900, timeBasis: 'word',
  });
  assert.equal(makePassage(v, d, ['w1', 'w2', 'w3']).language, null);
  for (const ids of [[], ['w1', 'absent'], ['w1', 'w1'], ['w1', 'w3'], ['w3', 'w4']]) assert.equal(makePassage(v, d, ids), null);
  const decoy = {...d, tokens: [{...d.tokens[0], original: 'Different text', corrected: null}]};
  assert.equal(makePassage(v, decoy, ['w1']).quote, 'The');
});

test('joined display quotes preserve separately stored punctuation, correction and mixed-language token readings', () => {
  const d = doc('punctuation.xml', [[null, ['¿', 'cafe\u0301', '?']]]);
  Object.assign(d.tokens[0], {language_effective: 'es', language_source: 'inherited'});
  Object.assign(d.tokens[1], {corrected: 'CAFÉ', language_effective: 'fr', language_source: 'explicit'});
  const p = makePassage(view(d), d, ['w1', 'w2', 'w3']);
  assert.equal(p.quote, '¿ CAFÉ ?');
  assert.equal(p.language, null);
  assert.deepEqual(p.readings, [
    {id: 'w1', original: '¿', corrected: null, language: 'es', languageSource: 'inherited'},
    {id: 'w2', original: 'cafe\u0301', corrected: 'CAFÉ', language: 'fr', languageSource: 'explicit'},
    {id: 'w3', original: '?', corrected: null, language: null},
  ]);
});

test('only the full recorded turn inherits its explicit chunk bounds; inconsistent word timing stays unknown', () => {
  const d = doc('asr.xml', [['chunk', ['Doors', 'closed.']]]);
  Object.assign(d.segments[0], {start_us: 2000000, end_us: 3750000});
  Object.assign(d.tokens[0], {start_us: 12, end_us: 2});
  const v = view(d);
  const full = makePassage(v, d, ['w1', 'w2']);
  assert.deepEqual([full.startUs, full.endUs, full.timeBasis], [2000000, 3750000, 'utterance']);
  const part = makePassage(v, d, ['w1']);
  assert.deepEqual([part.startUs, part.endUs, part.timeBasis, part.speaker, part.language], [null, null, null, null, null]);
});

test('a lexical duplicate ranks first for wording; neighbouring context can surface a different speaker or another document', () => {
  const a = doc('interview.xml', [['a', ['Fares', 'surged.'], '#p'], ['b', ['We', 'walked', 'home.'], '#q']]);
  const b = doc('notes.xml', [['x', ['Fares', 'surged.']], ['y', ['Buses', 'emptied.']]]);
  const c = doc('unrelated.xml', [['z', ['Herons', 'nested.']]]);
  const v = view(a, b, c), seed = makePassage(v, a, ['w1', 'w2']);
  const wording = findCandidates(v, seed, 'wording', limit);
  assert.deepEqual(wording.map(p => [p.document, p.quote]), [['notes.xml', 'Fares surged.']]);
  const related = findCandidates(v, seed, 'meaning', limit);
  assert(related.some(p => p.document === 'notes.xml' && p.quote === 'Buses emptied.'));
  assert(!related.some(p => p.document === 'unrelated.xml'));
  const contrast = findCandidates(v, seed, 'contrast', {limit: 1});
  assert.equal(contrast[0].quote, 'We walked home.');
  assert.equal(contrast[0].speaker, '#q');
  for (const passage of [...related, ...contrast, ...wording]) {
    assert.deepEqual(makePassage(v, v.documents.find(d => d.path === passage.document), passage.tokenIds), passage);
  }
});

test('same-turn rephrasings remain eligible without including any source word from the seed', () => {
  const d = doc('single.xml', [['u', ['Prices', 'rose,', 'in', 'other', 'words', 'it', 'cost', 'more.']]]);
  const v = view(d), seed = makePassage(v, d, ['w1', 'w2']);
  const related = findCandidates(v, seed, 'meaning', limit);
  assert.deepEqual(related.map(p => [p.utterance, p.tokenIds, p.quote]), [
    ['u', ['w3', 'w4', 'w5', 'w6', 'w7', 'w8'], 'in other words it cost more.'],
  ]);
  assert.equal(findCandidates(v, seed, 'meaning', {...limit, query: 'rose, in'}).length, 0);
});

test('plain text has punctuation and size boundaries, canonical Unicode search and no invented utterance or timing', () => {
  const plain = doc('plain.xml', [[null, ['Seed.', 'CAFÉ', 'fades。', 'Then', 'cafe\u0301', 'opens!', ...Array(60).fill('word')]]]);
  const v = view(plain), seed = makePassage(v, plain, ['w1']);
  const candidates = findCandidates(v, seed, 'meaning', limit);
  assert(candidates.length > 1);
  for (const p of candidates) {
    assert(p.tokenIds.length <= 48);
    assert.deepEqual([p.utterance, p.speaker, p.language, p.startUs, p.endUs], [null, null, null, null, null]);
  }
  const byText = query => findCandidates(v, seed, 'wording', {...limit, query});
  assert.deepEqual(byText('café').map(p => p.quote), ['CAFÉ fades。', 'Then cafe\u0301 opens!']);
  assert.deepEqual(byText('fades。 then').map(p => p.tokenIds), [['w2', 'w3', 'w4', 'w5', 'w6']]);
  assert.deepEqual(byText('no such passage'), []);
  assert.deepEqual(byText('word word').map(p => p.tokenIds.length), [48, 12]);
});

test('ambiguous IDs, unbound files and stale seed revisions or copied quotes cannot become pairs', () => {
  const a = doc('work.xml', [['u', ['Keep', 'this.']], ['v', ['Keep', 'these.']]]);
  const v = view(a), seed = makePassage(v, a, ['w1']);
  for (const altered of [{project: 'different'}, {revision: 10}, {snapshotHash: 'stale'}, {documentHash: 'stale'}, {quote: 'changed'}]) {
    assert.deepEqual(findCandidates(v, {...seed, ...altered}, 'meaning', {...limit, query: 'keep'}), []);
  }
  for (const n of [0, -2, NaN, Infinity]) assert.deepEqual(findCandidates(v, seed, 'meaning', {limit: n}), []);
  const ambiguous = doc('duplicate.xml', [['u', ['A', 'B']]]);
  ambiguous.tokens[1].id = 'w1';
  assert.equal(makePassage(view(ambiguous), ambiguous, ['w1']), null);
  const unbound = view(a);
  unbound.snapshot.files = {};
  assert.equal(makePassage(unbound, a, ['w1']), null);
});
