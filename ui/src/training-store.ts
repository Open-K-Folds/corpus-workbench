import type {Operation, View} from './contracts';
import {makePassage, type Passage, type TrainingLens} from './training-candidates';

const format = 'corpus-workbench/training-example-1';
const pairLenses = new Set<TrainingLens>(['meaning', 'wording', 'contrast']);

export interface TrainingAssistance {model: string; reply: string; prompt: string}

export interface TrainingInput {
  collection: string;
  lens: TrainingLens | 'label';
  seed: Passage;
  candidate?: Passage | null;
  label: string;
  note?: string;
  discovery?: string;
  assistance?: TrainingAssistance;
}

export interface TrainingRecord {
  format: typeof format;
  id: string;
  collection: string;
  kind: 'classification' | 'pair';
  lens: TrainingInput['lens'];
  seed: Passage;
  candidate: Passage | null;
  label: string;
  note: string;
  discovery: string;
  reviewer: string;
  assistance?: TrainingAssistance;
}

const present = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nullableString = (value: unknown) => value === null || typeof value === 'string';
const nullableTime = (value: unknown) => value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function isAssistance(value: unknown): value is TrainingAssistance {
  if (!value || typeof value !== 'object') return false;
  const a = value as Partial<TrainingAssistance>;
  return present(a.model) && present(a.reply) && present(a.prompt);
}

function isPassage(value: unknown): value is Passage {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<Passage>;
  return present(p.project) && Number.isSafeInteger(p.revision) && Number(p.revision) >= 1 &&
    hash(p.snapshotHash) && present(p.document) && hash(p.documentHash) && typeof p.title === 'string' &&
    nullableString(p.utterance) && Array.isArray(p.tokenIds) && p.tokenIds.length > 0 &&
    p.tokenIds.every(present) && new Set(p.tokenIds).size === p.tokenIds.length &&
    present(p.quote) && nullableString(p.speaker) && nullableString(p.language) &&
    nullableTime(p.startUs) && nullableTime(p.endUs) &&
    (p.startUs === null && p.endUs === null || typeof p.startUs === 'number' && typeof p.endUs === 'number' && p.endUs >= p.startUs) &&
    (p.timeBasis == null || p.timeBasis === 'word' || p.timeBasis === 'utterance');
}

function sameSnapshot(a: Passage, b: Passage) {
  return a.project === b.project && a.revision === b.revision && a.snapshotHash === b.snapshotHash;
}

function readRecord(id: string, document: string, note: string): TrainingRecord | null {
  try {
    const record = JSON.parse(note) as Partial<TrainingRecord> | null;
    if (!record || record.format !== format || id !== record.id || !present(record.collection) ||
        !present(record.label) || !present(record.reviewer) || typeof record.note !== 'string' ||
        typeof record.discovery !== 'string' || !isPassage(record.seed) || record.seed.document !== document ||
        record.assistance !== undefined && !isAssistance(record.assistance)) return null;
    if (record.kind === 'classification' && record.lens === 'label' && record.candidate === null ||
        record.kind === 'pair' && record.lens && record.lens !== 'label' && pairLenses.has(record.lens) &&
        isPassage(record.candidate) && sameSnapshot(record.seed, record.candidate)) return record as TrainingRecord;
  } catch { /* Imported sidecars may also contain ordinary or older notes. */ }
  return null;
}

export function trainingCollections(view: View): Map<string, TrainingRecord[]> {
  const collections = new Map<string, TrainingRecord[]>();
  for (const doc of view.documents) {
    for (const span of doc.spans) {
      if (!span.id.startsWith('training-')) continue;
      const record = readRecord(span.id, doc.path, span.fields.note);
      if (!record) continue;
      const entries = collections.get(record.collection);
      if (entries) entries.push(record);
      else collections.set(record.collection, [record]);
    }
  }
  return collections;
}

// The same token IDs can occur in different transcripts. Corrections can change
// the text under stable IDs. Both the document and the reviewed reading matter.
function evidenceKey(p: Passage) {
  return JSON.stringify([p.project, p.document, p.tokenIds, p.quote]);
}

function pairKey(a: Passage, b: Passage) {
  return JSON.stringify([evidenceKey(a), evidenceKey(b)].sort());
}

function ground(view: View, captured: Passage): Passage {
  const doc = view.documents.find(d => d.path === captured.document);
  if (captured.project !== view.snapshot.project || captured.revision !== view.revision.id ||
      captured.snapshotHash !== view.revision.snapshot_hash || !doc ||
      captured.documentHash !== view.snapshot.files[doc.path]?.sha256) {
    throw new Error('This example was selected on a different revision. Reopen the passages on the current revision to review them.');
  }
  const passage = makePassage(view, doc, captured.tokenIds);
  if (!passage || evidenceKey(passage) !== evidenceKey(captured)) {
    throw new Error('The reviewed words could not be resolved at their saved token anchors.');
  }
  return passage;
}

export function trainingOperation(view: View, input: TrainingInput, reviewer: string): Extract<Operation, {kind: 'add_span'}> {
  const collection = input.collection.trim(), label = input.label.trim();
  if (!collection || !label) throw new Error('Enter a collection name and a reviewer label.');
  if (!present(reviewer)) throw new Error('Reopen your Workbench session to record the reviewer.');
  if (input.assistance !== undefined && !isAssistance(input.assistance)) throw new Error('A model-assisted example requires the model name, prompt and reply that were reviewed.');
  if (input.lens === 'label' ? input.candidate != null : !pairLenses.has(input.lens) || !input.candidate) {
    throw new Error('Choose one passage for classification or two passages for a comparison.');
  }
  const seed = ground(view, input.seed);
  const candidate = input.candidate ? ground(view, input.candidate) : null;
  const existing = trainingCollections(view).get(collection) ?? [];
  if (candidate) {
    const key = pairKey(seed, candidate);
    if (evidenceKey(seed) === evidenceKey(candidate)) throw new Error('Choose a second passage for this pair.');
    const prior = existing.find(row => row.candidate && key === pairKey(row.seed, row.candidate));
    if (prior) throw new Error(`This pair is already saved in “${collection}” with the label “${prior.label}”.`);
  } else if (existing.some(row => !row.candidate && row.label === label && evidenceKey(row.seed) === evidenceKey(seed))) {
    throw new Error(`This passage already has the label “${label}” in “${collection}”.`);
  }
  const id = 'training-' + crypto.randomUUID();
  const record: TrainingRecord = {
    format, id, kind: candidate ? 'pair' : 'classification', collection, lens: input.lens, label, seed, candidate,
    note: input.note?.trim() ?? '', discovery: input.discovery?.trim() ?? '', reviewer,
  };
  if (input.assistance) {
    const {model, prompt, reply} = input.assistance;
    record.assistance = {model, prompt, reply};
  }
  const note = JSON.stringify(record);
  if (new TextEncoder().encode(note).length > 65536) {
    throw new Error('The reviewed example exceeds the 64 KiB annotation limit. Choose shorter passages, a shorter note or a shorter model exchange.');
  }
  return {kind: 'add_span', document: seed.document, id, token_ids: [...seed.tokenIds], fields: {label: 'Training · ' + label, note}, character: null};
}

export function trainingCounts(records: TrainingRecord[]) {
  const utterances = new Set<string>(), unidentified = new Set<string>();
  const speakers = new Set<string>(), unattributed = new Set<string>();
  for (const row of records) {
    for (const p of [row.seed, row.candidate]) {
      if (!p) continue;
      const key = JSON.stringify([p.project, p.document, p.utterance ?? p.tokenIds]);
      (p.utterance ? utterances : unidentified).add(key);
      // TEI who is a whitespace-separated list. Bare local IDs and their #id
      // references belong to this transcript's namespace.
      const ids = p.speaker?.trim().split(/\s+/).filter(Boolean) ?? [];
      for (const id of ids) speakers.add(JSON.stringify([p.project, p.document, id.replace(/^#/, '')]));
      if (!ids.length) unattributed.add(key);
    }
  }
  return {examples: records.length, utterances: utterances.size, unknownUtterances: unidentified.size,
    speakers: speakers.size, unknownSpeakers: unattributed.size};
}

export function trainingJsonl(view: View, collection: string): string {
  const rows = trainingCollections(view).get(collection);
  if (!rows?.length) throw new Error('Save a reviewed example in this collection before exporting it.');
  const exportedFrom = {project: view.snapshot.project, revision: view.revision.id, snapshotHash: view.revision.snapshot_hash};
  return rows.map(row => JSON.stringify({...row, exportedFrom})).join('\n') + '\n';
}

export function exportTraining(view: View, collection: string): void {
  const url = URL.createObjectURL(new Blob([trainingJsonl(view, collection)], {type: 'application/x-ndjson;charset=utf-8'}));
  const link = document.createElement('a');
  const filename = collection.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 72).replace(/^-+|-+$/g, '') || 'collection';
  link.href = url;
  link.download = `training-${filename}-r${view.revision.id}.jsonl`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
