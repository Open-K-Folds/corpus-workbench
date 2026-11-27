import {UiSchema} from '@effect/ui';
import {Html} from '@effect/ui/html';
import {Schema} from 'effect';

const Mode = Schema.Literals(['label', 'meaning', 'wording', 'contrast']);
const Entry = Schema.Struct({mode: Mode, limit: Schema.Number});
const Assistance = Schema.Struct({model: Schema.String, reply: Schema.String, prompt: Schema.String});
const Model = Schema.Struct({
  selection: Schema.String, mode: Mode, limit: Schema.Number, query: Schema.String, matchedWordsOnly: Schema.Boolean,
  candidateIndex: Schema.Number, library: Schema.Boolean, collection: Schema.String, libraryName: Schema.String,
  libraryLabel: Schema.String, pendingId: Schema.String, dirty: Schema.Boolean, stale: Schema.Boolean,
  assistance: Schema.NullOr(Assistance),
});
export const TrainingMessage = UiSchema.TaggedEnum({
  Passage: {key: Schema.String, entry: Schema.optional(Entry)}, Mode: {mode: Mode}, Page: {library: Schema.Boolean},
  Find: {query: Schema.String, limit: Schema.Number, matchedWordsOnly: Schema.Boolean}, Candidate: {index: Schema.Number},
  Collection: {name: Schema.String}, Label: {label: Schema.String}, Dirty: {}, Stale: {}, Reset: {},
  Attach: {reading: Assistance}, Saving: {collection: Schema.String, id: Schema.String}, Committed: {id: Schema.String},
});
const Event = UiSchema.TaggedEnum({PageChanged: {}, Pinned: {}});
const cleared = {selection: '', pendingId: '', dirty: false, stale: false, assistance: null};

export const TrainingWorkflow = Html.component({name: 'TrainingCollections', model: Model, message: TrainingMessage, events: Event}).make({
  init: () => ({...cleared, mode: 'label', limit: 3, query: '', matchedWordsOnly: false, candidateIndex: 0,
    library: false, collection: '', libraryName: '', libraryLabel: ''}),
  update: {
    Passage: ($, {key, entry}) => $.model.dirty ? $.model : $.evolve({
      selection: key, query: '', candidateIndex: 0, assistance: null,
      ...(entry && {mode: entry.mode, limit: entry.mode === 'label' ? 3 : entry.limit, library: false}),
    }),
    Mode: ($, {mode}) => $.model.dirty ? $.model : $.evolve({mode, query: '', candidateIndex: 0, assistance: null}),
    Page: ($, {library}) => $.model.dirty ? $.emit(Event.Pinned()) : $.evolve({library}).emit(Event.PageChanged()),
    Find: ($, {query, limit, matchedWordsOnly}) => $.model.dirty ? $.model : $.evolve({query, limit, matchedWordsOnly, candidateIndex: 0, assistance: null}),
    Candidate: ($, {index}) => $.model.dirty ? $.model : $.evolve({candidateIndex: index, assistance: null}),
    Collection: ($, {name}) => $.evolve({libraryName: name, libraryLabel: ''}),
    Label: ($, {label}) => $.evolve({libraryLabel: label}),
    Dirty: $ => $.evolve({dirty: true}),
    Stale: $ => $.evolve({stale: true}),
    Reset: $ => $.evolve(cleared),
    Attach: ($, {reading}) => $.evolve({assistance: reading, dirty: true}),
    Saving: ($, {collection, id}) => $.model.stale ? $.model : $.evolve({collection, libraryName: collection, libraryLabel: '', pendingId: id}),
    Committed: ($, {id}) => id && id === $.model.pendingId ? $.evolve(cleared) : $.model,
  },
  view: (h, m) => h.div.class('training-heading').children(
    h.h2(h.span.class('material-symbol').attr('aria-hidden','true').children('library_books'), 'Training collections'),
    h.nav.attr('aria-label','Training workspace').children(
      h.button.attrs({type:'button','data-page':'collect','aria-pressed':String(!m.library)}).on('click',TrainingMessage.Page({library:false})).children('Collect'),
      h.button.attrs({type:'button','data-page':'saved','aria-pressed':String(m.library)}).on('click',TrainingMessage.Page({library:true})).children('Saved collections'))),
});
