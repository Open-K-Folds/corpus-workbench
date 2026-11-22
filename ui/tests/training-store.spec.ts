import {expect} from '@playwright/test';
import type {Operation, View} from '../src/contracts';
import {makePassage} from '../src/training-candidates';
import {trainingCollections, trainingCounts, trainingJsonl, trainingOperation} from '../src/training-store';
import {test} from './practice-fixture';

test('training reviews survive native rereads, retain historical evidence and reject duplicate or stale pairs', async ({request, practiceUrl}) => {
  const {origin, hash} = new URL(practiceUrl);
  const login = await request.post(origin + '/api/session', {
    headers: {Origin: origin}, data: {code: new URLSearchParams(hash.slice(1)).get('session')},
  });
  expect(login.ok()).toBe(true);
  const {actor, csrf} = await login.json();
  const read = async (): Promise<View> => (await request.get(origin + '/api/view')).json();
  const save = (view: View, ...operations: Operation[]) => request.post(origin + '/api/command', {
    headers: {Origin: origin, 'X-WB-CSRF': csrf},
    data: {schema: 1, project: view.snapshot.project, command_id: 'test-' + crypto.randomUUID(), base_revision: view.revision.id,
      preimage_hash: view.revision.snapshot_hash, config_version: view.snapshot.config.version, label: 'Training fixture review', operations},
  });
  const path = 'xmlfiles/noticeboard.xml';
  const passage = (v: View, ids: string[]) => makePassage(v, v.documents.find(d => d.path === path)!, ids)!;
  const base = await read();
  const seed = passage(base, ['b1', 'b2', 'b3']), candidate = passage(base, ['c1', 'c2', 'c3']);
  const collection = 'Meeting accounts';
  const assistance = {model: 'test model', prompt: 'Compare both quoted fragments.', reply: 'A possible change of timing.'};
  const input = {collection, seed, candidate, lens: 'contrast' as const, label: 'Needs context', note: 'Ask the speaker.\n¿Antes?', assistance};
  expect(() => trainingOperation(base, {...input, seed: {...seed, quote: 'invented words'}}, actor)).toThrow(/saved token anchors/);
  expect(() => trainingOperation(base, {...input, assistance: {...assistance, model: ''}}, actor)).toThrow(/model name/);
  expect(() => trainingOperation(base, {...input, note: 'é'.repeat(33000)}, actor)).toThrow(/64 KiB/);
  const operation = trainingOperation(base, input, actor);
  expect((await save(base, operation)).ok()).toBe(true);
  const reviewed = await read();
  expect(reviewed.revision.id).toBe(base.revision.id + 1);
  const rows = trainingCollections(reviewed).get(collection)!;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({...input, id: operation.id, reviewer: actor, kind: 'pair'});
  expect(trainingCounts(rows)).toEqual({examples: 1, utterances: 2, unknownUtterances: 0, speakers: 2, unknownSpeakers: 0});
  const imported = structuredClone(reviewed);
  const stored = imported.documents.find(d => d.path === path)!.spans.find(s => s.id === operation.id)!;
  const old = JSON.parse(stored.fields.note);
  delete old.seed.readings;
  stored.fields.note = JSON.stringify(old);
  expect(trainingCollections(imported).get(collection)).toHaveLength(1);
  old.seed.readings = [{id: 'wrong-id', original: 'invented', corrected: null, language: null}];
  stored.fields.note = JSON.stringify(old);
  expect(trainingCollections(imported).has(collection)).toBe(false);
  expect(() => trainingOperation(reviewed, input, actor)).toThrow(/different revision/);
  expect((await save(base, operation)).status()).toBe(409);
  expect(() => trainingOperation(reviewed, {...input, seed: passage(reviewed, candidate.tokenIds),
    candidate: passage(reviewed, seed.tokenIds), label: 'Different'}, actor)).toThrow(/already saved.*Needs context/);

  const classification = {collection, lens: 'label' as const, seed: passage(reviewed, seed.tokenIds), label: 'Notification'};
  expect((await save(reviewed, trainingOperation(reviewed, classification, actor))).ok()).toBe(true);
  const classified = await read();
  expect(() => trainingOperation(classified, {...classification, seed: passage(classified, seed.tokenIds)}, actor)).toThrow(/already has the label/);
  const extraLabel = trainingOperation(classified, {...classification, seed: passage(classified, seed.tokenIds), label: 'Timing'}, actor);
  expect((await save(classified, extraLabel, {kind: 'set_token', document: path, token: 'b2', fields: {nform: 'recently'}})).ok()).toBe(true);
  const corrected = await read();
  expect(passage(corrected, seed.tokenIds).quote).not.toBe(seed.quote);
  const jsonl = trainingJsonl(corrected, collection);
  const exported = jsonl.trimEnd().split('\n').map(line => JSON.parse(line));
  expect(exported).toHaveLength(3);
  const original = exported.find(row => row.id === operation.id);
  expect(original).toMatchObject({kind: 'pair', label: input.label, seed, candidate, reviewer: actor, assistance,
    exportedFrom: {revision: corrected.revision.id, snapshotHash: corrected.revision.snapshot_hash}});
  expect(exported.filter(row => row.kind === 'classification').map(row => row.label).sort()).toEqual(['Notification', 'Timing']);
  expect(trainingCounts(trainingCollections(corrected).get(collection)!)).toEqual({...trainingCounts(rows), examples: 3});
  expect(() => trainingJsonl(corrected, 'Unreviewed suggestions')).toThrow(/Save a reviewed example/);

  const other = {...rows[0].seed, document: 'xmlfiles/elsewhere.xml', speaker: '#A #B', utterance: 't1'};
  const unknown = {...other, utterance: null, speaker: null};
  const counts = trainingCounts([...rows, {...rows[0], seed: other, candidate: unknown}, {...rows[0], seed: other, candidate: unknown}]);
  expect(counts).toEqual({examples: 3, utterances: 3, unknownUtterances: 1, speakers: 4, unknownSpeakers: 1});
});
