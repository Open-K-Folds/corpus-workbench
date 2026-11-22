import type {Document, Segment, Token, View} from './contracts';

export type TrainingLens = 'meaning' | 'wording' | 'contrast';
export interface Passage {
  project: string;
  revision: number;
  snapshotHash: string;
  document: string;
  documentHash: string;
  title: string;
  utterance: string | null;
  tokenIds: string[];
  quote: string;
  speaker: string | null;
  language: string | null;
  startUs: number | null;
  endUs: number | null;
  timeBasis?: 'word' | 'utterance' | null;
}

export const lensDescriptions: Record<TrainingLens, string> = {
  meaning: 'Uses shared vocabulary and the wording of neighbouring passages to suggest related material. Check the meaning in context.',
  wording: 'Ranks shared words and adjacent word pairs, giving more weight to words that occur in fewer passages.',
  contrast: 'Looks for repeated wording with changed terms, and nearby changes of recorded speaker. Decide whether the passages are easy to confuse.',
};

interface Range {start: number; end: number} // Half-open token positions in one document.
interface Excerpt extends Range {terms: string[]; vocabulary: Set<string>}
interface IndexedDocument {
  doc: Document;
  byId: Map<string, number>;
  segments: Map<string, Segment | null>;
  turns: Range[];
  excerpts: Excerpt[];
  excerptAt: number[];
}
interface Index {documents: Map<string, IndexedDocument>; weights: Map<string, number>}
const indices = new WeakMap<View, Index>();
const segmenter = new Intl.Segmenter(undefined, {granularity: 'word'});
const text = (token: Token) => token.corrected ?? token.original;
const comparable = (value: string) => value.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
const selectedText = (doc: Document, span: Range) => doc.tokens.slice(span.start, span.end).map(text).join(' ');
const MAX_EXCERPT_TOKENS = 48;

function termsOf(quote: string): string[] {
  return Array.from(segmenter.segment(comparable(quote)))
    .filter(part => part.isWordLike || /\p{Extended_Pictographic}/u.test(part.segment))
    .map(part => part.segment);
}

function indexView(view: View): Index {
  const cached = indices.get(view);
  if (cached) return cached;
  const documents = new Map<string, IndexedDocument>();
  const frequencies = new Map<string, number>();
  let excerptCount = 0;
  for (const doc of view.documents) {
    if (!view.snapshot.files[doc.path]?.sha256) continue;
    const byId = new Map<string, number>();
    const segments = new Map<string, Segment | null>();
    for (const segment of doc.segments) segments.set(segment.id, segments.has(segment.id) ? null : segment);
    const turns: Range[] = [], excerpts: Excerpt[] = [], excerptAt: number[] = [];
    let turnStart = 0, start = 0;
    for (const [i, token] of doc.tokens.entries()) {
      byId.set(token.id, byId.has(token.id) ? -1 : i);
      excerptAt.push(excerpts.length);
      const end = i + 1;
      const turnEnd = end === doc.tokens.length || doc.tokens[end].utterance !== token.utterance;
      if (turnEnd) { turns.push({start: turnStart, end}); turnStart = end; }
      if (!turnEnd && end - start < MAX_EXCERPT_TOKENS && !/[.!?;。！？；…—]["'’”»）)]*\s*$/u.test(text(token))) continue;
      const terms = termsOf(selectedText(doc, {start, end}));
      const vocabulary = new Set(terms);
      for (const term of vocabulary) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      excerpts.push({start, end, terms, vocabulary});
      excerptCount++;
      start = end;
    }
    documents.set(doc.path, {doc, byId, segments, turns, excerpts, excerptAt});
  }
  const weights = new Map<string, number>();
  for (const [term, count] of frequencies) weights.set(term, 1 + Math.log((1 + excerptCount) / (1 + count)));
  const index = {documents, weights};
  indices.set(view, index);
  return index;
}

function observedBounds(start: number | null, end: number | null) {
  return start !== null && end !== null && Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start;
}

function ground(view: View, source: IndexedDocument, range: Range): Passage | null {
  const {doc} = source;
  const tokens = doc.tokens.slice(range.start, range.end);
  const first = tokens[0], last = tokens.at(-1);
  if (!first || !last || tokens.some(t => !t.id || source.byId.get(t.id) === -1 || t.utterance !== first.utterance)) return null;
  const quote = tokens.map(text).join(' ');
  if (!quote.trim()) return null;
  const segment = first.utterance ? source.segments.get(first.utterance) : null;
  const language = first.language_effective;
  let startUs = null, endUs = null, timeBasis: Passage['timeBasis'] = null;
  if (tokens.every((t, i) => observedBounds(t.start_us, t.end_us)
      && (i === 0 || (t.start_us! >= tokens[i - 1].start_us! && t.end_us! >= tokens[i - 1].end_us!)))) {
    startUs = first.start_us; endUs = last.end_us; timeBasis = 'word';
  } else if (segment && doc.tokens[range.start - 1]?.utterance !== first.utterance
      && doc.tokens[range.end]?.utterance !== first.utterance && observedBounds(segment.start_us, segment.end_us)) {
    startUs = segment.start_us; endUs = segment.end_us; timeBasis = 'utterance';
  }
  return {
    project: view.snapshot.project, revision: view.revision.id, snapshotHash: view.revision.snapshot_hash,
    document: doc.path, documentHash: view.snapshot.files[doc.path].sha256, title: doc.title,
    utterance: first.utterance, tokenIds: tokens.map(t => t.id), quote,
    speaker: segment?.attrs.who?.trim() || null, language: language && tokens.every(t => t.language_effective === language) ? language : null,
    startUs, endUs, timeBasis,
  };
}

/** Resolve identities in the saved view and return one contiguous span in source order. */
export function makePassage(view: View, doc: Document, ids: string[]): Passage | null {
  const source = indexView(view).documents.get(doc.path);
  if (!source || !ids.length || new Set(ids).size !== ids.length) return null;
  let start = Infinity, end = 0;
  for (const id of ids) {
    const i = source.byId.get(id);
    if (i === undefined || i < 0) return null;
    start = Math.min(start, i); end = Math.max(end, i + 1);
  }
  return end - start === ids.length ? ground(view, source, {start, end}) : null;
}

function outside(range: Range, exclude: Range | null): Range[] {
  if (!exclude || range.end <= exclude.start || range.start >= exclude.end) return [range];
  return [{start: range.start, end: exclude.start}, {start: exclude.end, end: range.end}].filter(r => r.start < r.end);
}

/** Lookup stays inside a turn and can span excerpt boundaries in long prose. */
function manual(view: View, index: Index, seed: Passage, exclude: Range, query: string, limit: number): Passage[] {
  const found: Passage[] = [];
  for (const source of index.documents.values()) {
    for (const turn of source.turns) for (const available of outside(turn, source.doc.path === seed.document ? exclude : null)) {
      const tokens = source.doc.tokens.slice(available.start, available.end);
      const offsets: number[] = [];
      let value = '';
      for (const token of tokens) {
        const part = comparable(text(token));
        if (value && part) value += ' ';
        offsets.push(value.length);
        value += part;
      }
      let token = 0, at = value.indexOf(query);
      while (at >= 0) {
        while (token + 1 < offsets.length && offsets[token + 1] <= at) token++;
        const first = source.excerpts[source.excerptAt[available.start + token]];
        while (token + 1 < offsets.length && offsets[token + 1] < at + query.length) token++;
        const last = source.excerpts[source.excerptAt[available.start + token]];
        const start = Math.max(first.start, available.start), end = Math.min(last.end, available.end);
        const passage = ground(view, source, {start, end});
        if (passage) found.push(passage);
        if (found.length >= limit) return found;
        const next = offsets[end - available.start];
        at = next === undefined ? -1 : value.indexOf(query, next);
      }
    }
  }
  return found;
}

function neighbours(source: IndexedDocument, range: Range, omit?: Range): Set<string> {
  const before = source.excerpts[source.excerptAt[range.start] - 1];
  const after = source.excerpts[source.excerptAt[range.end - 1] + 1];
  const result = new Set<string>();
  for (const row of [before, after]) {
    if (!row || omit && row.start < omit.end && row.end > omit.start) continue;
    for (const term of row.vocabulary) result.add(term);
  }
  return result;
}

function overlap(a: Set<string>, b: Set<string>, weights: Map<string, number>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0, left = 0, right = 0;
  for (const term of a) {
    const w = weights.get(term) ?? 1;
    left += w;
    if (b.has(term)) shared += w;
  }
  for (const term of b) right += weights.get(term) ?? 1;
  return shared / Math.sqrt(left * right);
}

function pairs(terms: string[]): Set<string> {
  return new Set(terms.slice(1).map((term, i) => terms[i] + '\u0000' + term));
}

export function findCandidates(view: View, seed: Passage, lens: TrainingLens, options: {limit: number; query?: string}): Passage[] {
  const index = indexView(view);
  const source = index.documents.get(seed.document);
  const anchor = source && makePassage(view, source.doc, seed.tokenIds);
  const limit = Math.floor(options.limit);
  if (!source || !anchor || !Number.isFinite(limit) || limit < 1 || anchor.project !== seed.project || anchor.revision !== seed.revision
      || anchor.snapshotHash !== seed.snapshotHash || anchor.documentHash !== seed.documentHash || anchor.quote !== seed.quote) return [];
  const exclude = {start: source.byId.get(anchor.tokenIds[0])!, end: source.byId.get(anchor.tokenIds.at(-1)!)! + 1};
  const query = comparable(options.query ?? '');
  if (query) return manual(view, index, anchor, exclude, query, limit);
  const seedTerms = termsOf(anchor.quote), vocabulary = new Set(seedTerms), seedPairs = pairs(seedTerms);
  const context = neighbours(source, exclude);
  const ranked: {score: number; source: IndexedDocument; range: Range}[] = [];
  for (const candidate of index.documents.values()) {
    const sameDocument = candidate === source;
    for (const excerpt of candidate.excerpts) for (const range of outside(excerpt, sameDocument ? exclude : null)) {
      const terms = range === excerpt ? excerpt.terms : termsOf(selectedText(candidate.doc, range));
      if (!terms.length) continue;
      const words = range === excerpt ? excerpt.vocabulary : new Set(terms);
      const direct = overlap(vocabulary, words, index.weights);
      let score;
      if (lens === 'wording') {
        score = direct + 0.35 * overlap(seedPairs, pairs(terms), index.weights);
      } else {
        // Neither quote may supply its own contextual evidence merely by sitting next to the other.
        const surrounding = neighbours(candidate, range, sameDocument ? exclude : undefined);
        const seedContext = sameDocument ? neighbours(source, exclude, range) : context;
        const related = Math.max(overlap(seedContext, surrounding, index.weights), overlap(seedContext, words, index.weights),
          overlap(vocabulary, surrounding, index.weights));
        const distance = sameDocument ? Math.max(0, candidate.excerptAt[range.start] - source.excerptAt[exclude.end - 1],
          source.excerptAt[exclude.start] - candidate.excerptAt[range.end - 1]) : Infinity;
        const local = distance <= 2 ? 1 / (1 + distance) : 0;
        if (lens === 'meaning') score = 0.65 * direct + 0.55 * related + 0.2 * local;
        else {
          const turn = candidate.doc.tokens[range.start].utterance;
          const speaker = turn ? candidate.segments.get(turn)?.attrs.who : null;
          const change = sameDocument && speaker && anchor.speaker && speaker !== anchor.speaker ? 0.3 * local : 0;
          const sharedPairs = overlap(seedPairs, pairs(terms), index.weights);
          const repeatsSeed = terms.length === seedTerms.length && terms.every((term, i) => term === seedTerms[i]);
          score = (0.25 * related + 0.4 * local + change + 0.75 * direct + 0.4 * sharedPairs) * (repeatsSeed ? 0.05 : 1);
        }
      }
      if (score > 0) ranked.push({score, source: candidate, range});
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  const result: Passage[] = [];
  for (const item of ranked) {
    const passage = ground(view, item.source, item.range);
    if (passage) result.push(passage);
    if (result.length === limit) break;
  }
  return result;
}
