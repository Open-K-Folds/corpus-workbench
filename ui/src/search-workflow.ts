import {Command, UiSchema} from '@effect/ui';
import {Html} from '@effect/ui/html';
import {Effect, Schema} from 'effect';
import {api} from './api';
import {Query, Response, type SearchResponse} from './search-contract';

const Head = Schema.Struct({revision: Schema.Number, hash: Schema.String});
export const SearchMessage = UiSchema.TaggedEnum({
  Submitted: {query: Query}, Edited: {}, HeadChanged: {head: Head}, Notice: {text: Schema.String},
  Received: {generation: Schema.Number, response: Response}, Failed: {generation: Schema.Number, reason: Schema.String},
});
const Event = UiSchema.TaggedEnum({Display: {response: Response}, Availability: {enabled: Schema.Boolean}});
export const runSearch = Command.make('SearchCorpus', {args: {query: Query, generation: Schema.Number}, mode: 'switch'}, ({query, generation}) =>
  Effect.promise(async signal => {
    try {
      const response = await api<SearchResponse>('/api/search', query, signal);
      return SearchMessage.Received({generation, response});
    } catch (error) { return SearchMessage.Failed({generation, reason: String(error)}); }
  }));
const Model = Schema.Struct({head: Head, generation: Schema.Number, changed: Schema.Boolean,
  response: Schema.NullOr(Response), status: Schema.String});
export function outOfDate(head: typeof Head.Type, response: SearchResponse|null) {
  return !!response && response.result.query.mode === 'current' &&
    (response.result.binding.revision !== head.revision || response.result.binding.snapshot_hash !== head.hash);
}

export const CorpusSearch = Html.component({name: 'CorpusSearch', props: Head, model: Model, message: SearchMessage, events: Event}).make({
  init: ({props}) => ({head: props, generation: 0, changed: false, response: null, status: ''}),
  update: {
    Submitted: ($, {query}) => {
      const generation = $.model.generation + 1;
      return $.evolve({generation, changed: true, status: 'Searching exact R' + query.revision + '…'})
        .emit(Event.Availability({enabled: false})).run(runSearch.make({generation, query}));
    },
    Received: ($, {generation, response}) => {
      if (generation !== $.model.generation) return $.model;
      const r = response.result, q = r.query;
      const stale = outOfDate($.model.head, response);
      const status = r.total + ' hits · ' + (q.mode === 'historical' ? 'Historical' : 'Saved') + ' R' + r.binding.revision +
        ' · ' + q.reading + ' reading' + (q.span ? ' · span ' + q.span.field + ' = ' + JSON.stringify(q.span.value) : '') +
        (stale ? ' · stale against saved head; search again' : '');
      return $.evolve({response, changed: false, status}).emit(Event.Display({response}), Event.Availability({enabled: !stale}));
    },
    Failed: ($, {generation, reason}) => generation === $.model.generation ? $.evolve({status: reason}) : $.model,
    Edited: $ => $.evolve({generation: $.model.generation + 1, changed: true, status: 'Query changed. Search again to update results.'})
      .emit(Event.Availability({enabled: false})),
    HeadChanged: ($, {head}) => {
      if (head.revision === $.model.head.revision && head.hash === $.model.head.hash) return $.model;
      const {response} = $.model;
      const status = response && outOfDate(head, response)
        ? 'Results R' + response.result.binding.revision + ' are stale against saved R' + head.revision + '. Search again.'
        : $.model.status;
      return $.evolve({head, status, generation: $.model.generation + 1})
        .emit(Event.Availability({enabled: !$.model.changed && !outOfDate(head, response)}));
    },
    Notice: ($, {text}) => $.evolve({status: text}),
  },
  view: (h, model) => h.p.id('corpus-search-status').attr('role', 'status').children(model.status),
});