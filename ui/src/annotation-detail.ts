import type {Document, Span} from './contracts';
import {savedExcerpt, type Memo} from './coanalysis-memo';
import {readTrainingRecord} from './training-store';

type CharacterAnchor = {token:string; start:number; end:number; quote:string};
const indexes = new WeakMap<Document, Map<string, number>>();
export const isMeaningSpan = (span: Span) =>
  /^meaning-[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(span.id);

function tokenPositions(doc: Document) {
  let positions = indexes.get(doc);
  if (!positions) {
    positions = new Map();
    for (const [index, token] of doc.tokens.entries()) {
      positions.set(token.id, positions.has(token.id) ? -1 : index);
    }
    indexes.set(doc, positions);
  }
  return positions;
}

// A reviewed record keeps the wording used for its judgment even after a correction.
function reviewedEvidence(span: Span) {
  if (span.id.startsWith('training-')) {
    const record = readTrainingRecord(span.id, null, span.fields.note);
    if (record) return {
      kind:'Training example', title:record.label, note:record.note, quote:record.seed.quote,
      project:record.seed.project, document:record.seed.document,
      ids:record.seed.tokenIds, words:record.seed.readings?.map(r => r.corrected ?? r.original),
      revision:record.seed.revision, by:'Reviewed by '+record.reviewer, model:record.assistance?.model,
      utterances:[record.seed.utterance], gaps:[] as number[],
    };
  }
  if (!span.id.startsWith('coanalysis-')) return null;
  try {
    const memo = JSON.parse(span.fields.note) as Memo;
    if (memo?.format !== 'corpus-workbench/coanalysis-1' || typeof memo.document !== 'string' || typeof memo.project !== 'string' ||
        typeof memo.interpretation !== 'string' || typeof memo.decision !== 'string' || !Number.isSafeInteger(memo.revision)) return null;
    const groups = savedExcerpt(memo) ?? [];
    const ids:string[] = [], gaps:number[] = [], utterances:(string|null)[] = [];
    for (const group of groups) {
      if (group.gap_before) gaps.push(ids.length);
      for (const token of group.tokens) {ids.push(token.id); utterances.push(group.utterance);}
    }
    return {
      kind:'Co-analysis', title:memo.decision, note:memo.interpretation, project:memo.project, document:memo.document,
      quote:groups.map(group => (group.gap_before ? '… ' : '') + group.tokens.map(token => token.text).join(' ')).join(' '),
      ids, words:groups.flatMap(group => group.tokens.map(t => t.text)),
      revision:memo.revision, by:'', model:typeof memo.model === 'string' ? memo.model : '', utterances, gaps,
    };
  } catch {return null;}
}

export function anchoredReading(doc: Document, tokenIds: string[]) {
  const index = tokenPositions(doc);
  const positions = tokenIds.map(id => index.get(id) ?? -1).sort((a,b) => a-b);
  const known = positions.length > 0 && positions[0] >= 0 && new Set(positions).size === positions.length;
  const tokens = known ? positions.map(position => doc.tokens[position]) : [];
  const ids = tokens.map(token => token.id);
  const gaps:number[] = [];
  const currentQuote = tokens.map((token, i) => {
    const text = token.corrected ?? token.original;
    if (i === 0 || positions[i-1] === positions[i]-1) return text;
    gaps.push(i);
    return '… ' + text;
  }).join(' ');
  return {known, tokens, ids, gaps, currentQuote};
}

export function annotationDetail(doc: Document, span: Span, project?: string) {
  const {known, tokens, ids, gaps, currentQuote} = anchoredReading(doc, span.token_ids);
  const {fields} = span;
  let reason = known ? '' : 'Source anchors unavailable';
  let character:CharacterAnchor|null = null;
  let quote = currentQuote;
  if (['wb_quote','wb_start','wb_end','wb_layer','wb_coordinate','wb_status'].some(key => key in fields)) {
    const start = Number(fields.wb_start), end = Number(fields.wb_end);
    quote = fields.wb_quote ?? '';
    if (tokens.length === 1 && fields.wb_status === 'resolved' && fields.wb_layer === 'corrected' &&
        fields.wb_coordinate === 'unicode-codepoint' && /^\d+$/.test(fields.wb_start) && /^\d+$/.test(fields.wb_end) &&
        start < end && end <= Array.from(currentQuote).length && Array.from(currentQuote).slice(start, end).join('') === quote) {
      character = {token:ids[0], start, end, quote};
    } else {reason = 'Character anchor needs review';}
  }
  const record = reviewedEvidence(span);
  const unsupported = !record && /^(training|coanalysis)-/.test(span.id) &&
    (/^\s*[{[]/.test(fields.note ?? '') || /^(Training|Co-analysis) · /.test(fields.label ?? ''));
  if (unsupported) {reason = 'Saved record needs review'; quote = '';}
  const sameDocument = record && record.document === doc.path && record.project === project;
  if (record) {
    const groupsMatch = record.kind === 'Training example'
      ? tokens.every(token => token.utterance === record.utterances[0])
      : tokens.every((token, i) => token.utterance === record.utterances[i]);
    const wordsMatch = !record.words || record.words.every((text, i) => text === (tokens[i]?.corrected ?? tokens[i]?.original));
    if (!known || currentQuote !== record.quote || !wordsMatch || !groupsMatch || record.gaps.join() !== gaps.join() ||
        record.ids.length !== ids.length || record.ids.some((id,i) => id !== ids[i])) {
      reason = 'Saved wording or anchors differ';
    }
    if (!sameDocument) reason = 'Different source project or document';
    quote = record.quote;
  }
  const turns = reason ? [] : [...new Set(tokens.map(t => t.utterance).filter(Boolean))];
  const location = record && !sameDocument ? record.project+' / '+record.document : doc.title || doc.path;
  const source = [location, turns.join(', '), record && 'R'+record.revision, record?.by || fields.resp,
    record?.model && 'Model: '+record.model, reason].filter(Boolean).join(' · ');
  return {
    title:record?.title || fields.label || fields.type || 'Untitled annotation',
    kind:record?.kind ?? (unsupported ? 'Saved record' : isMeaningSpan(span) ? 'English meaning' : 'Annotation'),
    quote, note:unsupported ? '' : record?.note ?? fields.note ?? '', source,
    tokenIds:reason ? [] : ids, character:reason ? null : character,
  };
}
