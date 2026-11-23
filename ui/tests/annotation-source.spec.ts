import {expect, test} from '@playwright/test';
import {annotationDetail} from '../src/annotation-detail';
import type {Document, Span, Token} from '../src/contracts';
import type {Memo} from '../src/coanalysis-memo';
import type {TrainingRecord} from '../src/training-store';

function token(id:string, original:string, corrected:string|null = null):Token {
  return {id, original, corrected, internal_id:id, utterance:'turn-1', normalized:null, attrs:{},
    start_us:null, end_us:null, language_effective:null, language_source:'unknown', editable:true};
}

const doc:Document = {path:'xmlfiles/notices.xml', title:'Notices', tokens:[
  token('a', 'Before'), token('b', 'the'), token('c', 'meeting'), token('d', 'ended'),
], spans:[], segments:[], media:[], metadata:{}, opaque_elements:[]};
const mark = (id:string, ids:string[], fields:Span['fields'] = {}):Span =>
  ({id, token_ids:ids, sidecar:'annotations.xml', fields});

test('overlapping annotations keep their own source order and omitted words', () => {
  const across = mark('across', ['d','b','a']);
  const inside = mark('inside', ['b','c']);
  expect(annotationDetail(doc, across)).toMatchObject({quote:'Before the … ended', tokenIds:['a','b','d']});
  expect(annotationDetail(doc, inside)).toMatchObject({quote:'the meeting', tokenIds:['b','c']});
});

test('unavailable or ambiguous token IDs never partially highlight a span', () => {
  for (const ids of [[], ['a','absent'], ['b','b']]) {
    expect(annotationDetail(doc, mark('broken', ids)).tokenIds).toEqual([]);
  }
  const ambiguous = {...doc, tokens:[...doc.tokens, token('b','elsewhere')]};
  expect(annotationDetail(ambiguous, mark('ambiguous', ['b'])).tokenIds).toEqual([]);
});

test('character offsets use Unicode code points in the corrected reading and retain stale evidence', () => {
  const corrected = {...doc, tokens:[token('a', 'source', '🐦a🪶b')]};
  const fields = {wb_status:'resolved', wb_start:'2', wb_end:'3', wb_layer:'corrected',
    wb_coordinate:'unicode-codepoint', wb_quote:'🪶'};
  const span = mark('character', ['a'], fields);
  expect(annotationDetail(corrected, span)).toMatchObject({
    quote:'🪶', tokenIds:['a'], character:{token:'a', start:2, end:3, quote:'🪶'},
  });
  for (const revisions of [{wb_status:'unresolved'}, {wb_start:'1'}, {wb_end:'600'}]) {
    const changed = mark('character', ['a'], {...fields, ...revisions});
    expect(annotationDetail(corrected, changed)).toMatchObject({quote:'🪶', tokenIds:[], character:null});
  }
});

test('training keeps its reviewed quote, reviewer and assistant when stable IDs change wording', () => {
  const record:TrainingRecord = {
    format:'corpus-workbench/training-example-1', id:'training-research', kind:'classification', lens:'label',
    collection:'Meetings', label:'Timing', note:'Timing matters.', discovery:'manual selection', reviewer:'Reviewer A',
    assistance:{model:'Local Qwen', reply:'It describes timing.', prompt:'Classify the passage.'}, candidate:null,
    seed:{project:'study', revision:3, snapshotHash:'a'.repeat(64), document:doc.path, documentHash:'b'.repeat(64),
      title:doc.title, utterance:'turn-1', tokenIds:['a','b'], quote:'Before the', speaker:null, language:null,
      startUs:null, endUs:null},
  };
  const span = mark(record.id, ['a','b'], {note:JSON.stringify(record)});
  const saved = annotationDetail(doc, span, 'study');
  expect(saved).toMatchObject({kind:'Training example', title:record.label, note:record.note, tokenIds:['a','b']});
  for (const provenance of ['Reviewer A','Local Qwen','R3']) expect(saved.source).toContain(provenance);
  const edited = {...doc, tokens:[token('a','Before','After'), ...doc.tokens.slice(1)]};
  expect(annotationDetail(edited, span, 'study')).toMatchObject({quote:'Before the', tokenIds:[]});
  expect(annotationDetail(doc, span, 'other-project')).toMatchObject({quote:'Before the', tokenIds:[]});
});

test('co-analysis checks the original token groups, omitted words and turns before revealing', () => {
  const memo:Memo = {
    format:'corpus-workbench/coanalysis-1', project:'study', revision:2, snapshot_hash:'a'.repeat(64),
    document:doc.path, question:'Which words mark time?', model:'Local Qwen', method:'llama.cpp', proposal:'An endpoint.',
    decision:'Partly supported', interpretation:'The events have an order.',
    prompt:'Transcript question.\n\nTranscript excerpt: ' + JSON.stringify([
      {utterance:'turn-1', gap_before:false, tokens:[{id:'a', text:'Before'}]},
      {utterance:'turn-1', gap_before:true, tokens:[{id:'d', text:'ended'}]},
    ]),
  };
  const span = mark('coanalysis-research', ['a','d'], {note:JSON.stringify(memo)});
  expect(annotationDetail(doc, span, 'study')).toMatchObject({kind:'Co-analysis', quote:'Before … ended', tokenIds:['a','d'],
    title:memo.decision, note:memo.interpretation});
  expect(annotationDetail(doc, span, 'other-project')).toMatchObject({quote:'Before … ended', tokenIds:[]});
  for (const tokens of [
    [doc.tokens[0], doc.tokens[3]],
    [token('a','Before','After'), ...doc.tokens.slice(1)],
    [{...doc.tokens[0], utterance:'turn-2'}, ...doc.tokens.slice(1)],
  ]) {
    expect(annotationDetail({...doc, tokens}, span, 'study')).toMatchObject({quote:'Before … ended', tokenIds:[]});
  }
});

test('a malformed reviewed record cannot mark live words or expose its payload as an annotation note', () => {
  for (const [id, format] of [
    ['coanalysis-broken','corpus-workbench/coanalysis-1'],
    ['training-broken','corpus-workbench/training-example-1'],
  ]) {
    const payload = JSON.stringify({format, revision:2, document:doc.path, prompt:'Private source request'});
    const detail = annotationDetail(doc, mark(id, ['a'], {note:payload}), 'study');
    expect(detail.tokenIds).toEqual([]);
    expect(detail.note).not.toContain('Private source request');
  }
});
