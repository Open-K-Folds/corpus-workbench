import {expect, test} from '@playwright/test';
import {Story} from '@effect/ui/testing';
import {Effect} from 'effect';
import {CorpusSearch, SearchMessage, runSearch} from '../src/search-workflow';
import type {SearchQuery, SearchResponse} from '../src/search-contract';
import {RevisionReview, ReviewMessage, loadDecisions} from '../src/review';
import {TrainingWorkflow, TrainingMessage as T} from '../src/training-workflow';
import {PassageReading, ReadingMessage as R} from '../src/coanalysis-workflow';

const head = {revision:2, hash:'snapshot-2'};
const query: SearchQuery = {schema:1, project:'synthetic', revision:2, snapshot_hash:head.hash, mode:'current',
  reading:'corrected', terms:[{text:'one',language:null}], documents:[], context:3, offset:0, limit:5};
const response: SearchResponse = {result_hash:'result', result:{schema:1, binding:{engine:'test',project:'synthetic',
  revision:2,snapshot_hash:head.hash,projection_hash:'projection'}, query, total:0, hits:[], next_offset:null, rights:''}};

test('an edited search rejects a late success and keeps its actions disabled', () => Effect.gen(function*() {
  const s = yield* Story.make(CorpusSearch, head);
  const cmd = runSearch.make({query,generation:1});
  s.send(SearchMessage.Submitted({query})).emitted({_tag:'Availability',enabled:false}).expectExact(cmd).keepPending(cmd);
  s.send(SearchMessage.Edited()).emitted({_tag:'Availability',enabled:false});
  s.resolve(cmd, SearchMessage.Received({generation:1,response})).expectNone();
  expect(s.model.response).toBeNull();
  expect(s.model.status).toContain('Search again');
}).pipe(Effect.scoped,Effect.runSync));

test('a saved revision change ends a pending search even before its first response', () => Effect.gen(function*() {
  const s = yield* Story.make(CorpusSearch, head);
  const cmd = runSearch.make({query,generation:1});
  s.send(SearchMessage.Submitted({query})).emitted({_tag:'Availability',enabled:false}).keepPending(cmd);
  s.send(SearchMessage.HeadChanged({head:{revision:3,hash:'next'}})).emitted({_tag:'Availability',enabled:false});
  s.resolve(cmd, SearchMessage.Received({generation:1,response}));
  expect(s.model.pending).toBe(false);
  expect(s.model.status).toContain('R3');
  expect(s.model.response).toBeNull();
}).pipe(Effect.scoped,Effect.runSync));

test('switching to a historical review keeps the full decision for the current revision', () => Effect.gen(function*() {
  const current = {id:2,label:'current',snapshot_hash:head.hash}, old = {id:1,label:'older',snapshot_hash:'snapshot-1'};
  const s = yield* Story.make(RevisionReview,{head:current, files:1, documents:1, issues:[]});
  s.send(ReviewMessage.IndexReady({rows:[current,old]}));
  const cmd = loadDecisions.make({expected:old,generation:1});
  s.send(ReviewMessage.Select({revision:1})).expectExact(cmd).keepPending(cmd);
  s.send(ReviewMessage.Loaded({revision:2,generation:0,rows:[{id:5,revision:2,snapshot_hash:head.hash,actor:'test',
    decision:'approved',scope:'full',note:'',created_at:'today',self_review:true}]}));
  s.resolve(cmd,ReviewMessage.Failed({revision:1,generation:1,reason:'history unavailable'}));
  expect(s.model.current).toBe('approved');
  expect(s.model.failure).toBe('history unavailable');
}).pipe(Effect.scoped,Effect.runSync));

test('a training draft stays pinned until its own save is confirmed', () => Effect.gen(function*() {
  const s = yield* Story.make(TrainingWorkflow,{});
  s.send(T.Passage({key:'passage-a',entry:{mode:'wording',limit:6}})).send(T.Candidate({index:2})).send(T.Dirty());
  s.send(T.Page({library:true})).emitted({_tag:'Pinned'}).send(T.Passage({key:'passage-b'}));
  expect(s.model.selection).toBe('passage-a');
  expect(s.model.candidateIndex).toBe(2);
  s.send(T.Saving({collection:'Examples',id:'save-a'})).send(T.Committed({id:'other'}));
  expect(s.model.dirty).toBe(true);
  s.send(T.Committed({id:'save-a'})).send(T.Page({library:true})).emitted({_tag:'PageChanged'});
  expect(s.model.dirty).toBe(false);
  expect(s.model.libraryName).toBe('Examples');
}).pipe(Effect.scoped,Effect.runSync));

test('a model reply arriving after a revision change cannot become a reviewed reading', () => Effect.gen(function*() {
  const s = yield* Story.make(PassageReading,{});
  s.send(R.Requested()).send(R.Stale()).send(R.Reviewed({proposal:{model:'local',proposal:'late',method:'llama.cpp'}}));
  expect(s.model.proposal).toBeNull();
  expect(s.model.waiting).toBe(false);
  expect(s.model.status).toContain('older revision');
}).pipe(Effect.scoped,Effect.runSync));
