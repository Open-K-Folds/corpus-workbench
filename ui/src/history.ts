import {Command, UiSchema} from '@effect/ui';
import {BrowserHost, Html} from '@effect/ui/html';
import {Effect, Schema} from 'effect';
import {api} from './api';
import {runComponent} from './app-runtime';
import type {Diff, Revision, View} from './contracts';

const Row = Schema.Struct({id: Schema.Number, label: Schema.String, actor: Schema.String, created_at: Schema.String, snapshot_hash: Schema.String});
const Props = Schema.Struct({head: Schema.Number, parent: Schema.NullOr(Schema.Number), hash: Schema.String, approved: Schema.Boolean, rows: Schema.Array(Row)});
const Change = Schema.Struct({document: Schema.String, sidecar: Schema.optional(Schema.String), target: Schema.String,
  field: Schema.String, before: Schema.NullOr(Schema.String), after: Schema.NullOr(Schema.String)});
const Changes = Schema.Struct({from: Schema.Number, changes: Schema.Array(Change), files: Schema.Array(Schema.String), config: Schema.Boolean});
const Message = UiSchema.TaggedEnum({
  FindRevisions: {text: Schema.String}, SelectRevision: {revision: Schema.Number}, Compare: {}, FindChanges: {text: Schema.String},
  Compared: {diff: Changes}, Failed: {reason: Schema.String}, Undo: {}, Restore: {},
});
const Action = Schema.Struct({revision: Schema.Number, label: Schema.String});
const compare = Command.make('CompareRevisions', {args: {from: Schema.Number, to: Schema.Number}, mode: 'switch'}, ({from, to}) =>
  Effect.promise(async signal => {
    try {
      const diff = await api<Diff>('/api/diff?from=' + from + '&to=' + to, undefined, signal);
      return Message.Compared({diff: {from, changes: diff.changes, files: diff.files.map(file => file.path),
        config: JSON.stringify(diff.config_before) !== JSON.stringify(diff.config_after)}});
    } catch (error) { return Message.Failed({reason: String(error)}); }
  }));
const Model = Schema.Struct({selected: Schema.Number, query: Schema.String, diff: Schema.NullOr(Changes),
  queryChanges: Schema.String, pending: Schema.Boolean, failure: Schema.String});

function comparison(h: Html.H<typeof Message.Type>, diff: typeof Changes.Type, head: number, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  const found = diff.changes.filter(change => [change.document, change.sidecar, change.target, change.field, change.before, change.after]
    .join(' ').toLocaleLowerCase().includes(needle));
  const reading = (value: string|null) => value === null ? h.span.class('muted').children('Missing') : h.pre(value);
  return h.div.id('diff').attr('aria-live', 'polite').children(
    h.div.class('diff-heading').children(h.h3('R' + diff.from + ' → R' + head), h.span(diff.changes.length + ' field changes · ' + diff.files.length + ' files')),
    h.label('Filter changes', h.input.id('diff-query').attrs({type: 'search', placeholder: 'Document, target or field', autocomplete: 'off'}).value(query)
      .on('input', ({value}) => Message.FindChanges({text: value}))),
    h.p.id('diff-count').class('muted').attr('role', 'status').children(found.length + ' of ' + diff.changes.length + ' changes'),
    h.div.id('diff-rows').children(found.length ? h.div.class('table-scroll').children(h.table.class('diff-table').children(
      h.thead(h.tr(h.th.attr('scope','col').children('Evidence / field'), h.th.attr('scope','col').children('Before R' + diff.from), h.th.attr('scope','col').children('After R' + head))),
      h.tbody(found.map(c => h.tr(h.th.attr('scope', 'row').children(h.span(c.target + ' / ' + c.field), h.small(c.document), c.sidecar && h.small(c.sidecar)),
        h.td.class('diff-before').children(reading(c.before)), h.td.class('diff-after').children(reading(c.after)))))))
      : h.p.class('empty-state').children('No matching field changes.')),
    h.details(h.summary('Changed package files (' + diff.files.length + ')'), h.ul(diff.files.length ?
      diff.files.map(path => h.li.class('source-path').children(path)) : h.li('No changed files.'))),
    diff.config && h.p.class('notice').children('Annotation definitions / defaults changed.'),
  );
}

const History = Html.component({name: 'RevisionHistory', props: Props, model: Model, message: Message, events: Action}).make({
  init: ({props}) => ({selected: props.parent ?? props.rows[0]?.id ?? props.head, query: '', diff: null, queryChanges: '', pending: false, failure: ''}),
  update: {
    FindRevisions: ($, {text}) => $.evolve({query: text}),
    SelectRevision: ($, {revision}) => $.evolve({selected: revision}),
    FindChanges: ($, {text}) => $.evolve({queryChanges: text}),
    Compare: $ => $.evolve({pending: true, failure: '', queryChanges: '', diff: null}).run(compare.make({from: $.model.selected, to: $.props.head})),
    Compared: ($, {diff}) => $.evolve({pending: false, diff}),
    Failed: ($, {reason}) => $.evolve({pending: false, failure: reason}),
    Restore: $ => $.emit({revision: $.model.selected, label: 'Restore R' + $.model.selected}),
    Undo: $ => $.props.parent === null ? $.model : $.emit({revision: $.props.parent, label: 'Undo R' + $.props.head}),
  },
  view: (h, model) => {
    const {rows, head, parent, hash, approved} = h.props;
    const needle = model.query.trim().toLocaleLowerCase();
    const found = rows.filter(row => ('R' + row.id + ' ' + row.label + ' ' + row.actor + ' ' + row.created_at).toLocaleLowerCase().includes(needle));
    return h.section(
      h.h2('Per-edit history'), h.p.class('muted').children('Undo, redo and restore create a new revision. Every intervening revision remains available.'),
      h.div.class('revision-basis').children(h.strong('Current R' + head), h.span(approved ? 'Approved exact revision' : 'Unreviewed'), h.code(hash.slice(0, 16))),
      h.div.class('actions').children(h.button.id('undo-committed').attr('disabled', parent === null ? '' : undefined).on('click', Message.Undo()).children('Undo last committed edit')),
      h.label('Compare / restore revision', h.select.id('compare-from').value(String(model.selected))
        .on('change', ({value}) => Message.SelectRevision({revision: Number(value)}))
        .children(rows.map(r => h.option.key(String(r.id)).attr('value', String(r.id)).children('R' + r.id + ' · ' + r.label)))),
      h.div.class('actions').children(h.button.id('compare-revisions').class('secondary').on('click', Message.Compare()).children('Compare with current'),
        h.button.id('restore-revision').class('secondary').on('click', Message.Restore()).children('Restore selected state')),
      model.diff ? comparison(h, model.diff, head, model.queryChanges) : h.div.id('diff').attr('aria-live','polite').children(model.pending ? 'Loading exact revision comparison.' : model.failure),
      h.h3('Revision timeline'), h.label('Find revisions', h.input.id('history-query').attrs({type: 'search', placeholder: 'Name, revision or actor', autocomplete: 'off'})
        .value(model.query).on('input', ({value}) => Message.FindRevisions({text: value}))),
      h.p.id('history-count').class('muted').attr('role','status').children(found.length + ' of ' + rows.length + ' revisions'),
      h.ol.class('history').id('history-list').children(found.length ? found.map(r => h.li.key(String(r.id)).children(
        h.span.class('revision-number').children('R' + r.id), h.div(h.strong(r.label), h.p(r.created_at + ' · ' + r.actor), h.code(r.snapshot_hash.slice(0,16)),
          r.id === head && h.span.class('current-label').children('Current state')))) : h.li.class('empty-state').children('No matching revisions.')),
    );
  },
});

export async function mountHistory(host: HTMLElement, view: View, signal: AbortSignal, restore: (action: typeof Action.Type) => void) {
  const rows = await api<Revision[]>('/api/history', undefined, signal);
  if (signal.aborted) return;
  const stage = document.createElement('div');
  stage.className = 'inspector-mount';
  host.append(stage);
  runComponent(BrowserHost.mountEffect(History, {head: view.revision.id, parent: view.revision.parent, hash: view.revision.snapshot_hash,
    approved: view.approved, rows}, stage, {head: false, onEmit: restore}), signal);
}
