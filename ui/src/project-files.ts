import {Component, UiSchema} from '@effect/ui';
import {BrowserHost, Html, HtmlCommand} from '@effect/ui/html';
import {Effect, Exit, Schema, Scope} from 'effect';
import type {View} from './contracts';
import type {SymbolName} from './icons';

const Files = Schema.Struct({
  documents: Schema.Array(Schema.Struct({
    path: Schema.String, title: Schema.String, tokens: Schema.Number, spans: Schema.Number,
  })),
  sources: Schema.Array(Schema.Struct({path: Schema.String, role: Schema.String})),
  currentDocument: Schema.String,
  currentSource: Schema.String,
});
const Section = Schema.Literals(['documents', 'sources']);
const Message = UiSchema.TaggedEnum({
  FilesChanged: {files: Files},
  ChangedSection: {section: Section},
  EditedFilter: {query: Schema.String},
  ClearedFilter: {},
  ClickedDocument: {path: Schema.String},
  ClickedSource: {path: Schema.String},
});
const Navigation = UiSchema.TaggedEnum({
  OpenDocument: {path: Schema.String},
  OpenSource: {path: Schema.String},
});
export type FileNavigation = typeof Navigation.Type;
export interface ProjectFileSnapshot {
  view: View;
  currentDocument: string;
  currentSource: string;
}
const filterInput = Html.ref('ProjectFiles.filter', 'input');

const roles = new Map<string, {label: string; symbol: SymbolName}>([
  ['source-media', {label: 'Recordings and media', symbol: 'headphones'}],
  ['project-settings', {label: 'Project settings', symbol: 'settings'}],
  ['transcript', {label: 'Transcripts', symbol: 'description'}],
  ['immutable-machine-draft', {label: 'Machine drafts', symbol: 'auto_awesome'}],
  ['annotation-sidecar-or-definition', {label: 'Annotations and definitions', symbol: 'edit_note'}],
  ['derived-index', {label: 'Search indexes', symbol: 'search'}],
  ['inert-compatibility-dependency', {label: 'Compatibility files', symbol: 'attach_file'}],
  ['opaque-project-artifact', {label: 'Other project files', symbol: 'attach_file'}],
]);

type Builder = Html.H<typeof Message.Type>;
function symbol(h: Builder, name: SymbolName) {
  return h.span.class('material-symbol').attr('aria-hidden', 'true').children(name);
}

function emptyList(h: Builder, text: string) {
  return h.p.class('project-empty').attr('role', 'status').children(symbol(h, 'search'), text);
}

function documents(h: Builder, files: typeof Files.Type, needle: string) {
  const found = files.documents.filter(doc =>
    [doc.path, doc.title].some(value => value.toLocaleLowerCase().includes(needle)));
  if (!found.length) return emptyList(h, 'No matching documents.');
  return found.map(doc => {
    const selected = doc.path === files.currentDocument;
    return h.button.key(doc.path).class(selected ? 'document selected' : 'document')
      .attrs({type: 'button', 'data-document': doc.path, 'aria-current': String(selected), title: doc.path})
      .on('click', Message.ClickedDocument({path: doc.path}))
      .children(symbol(h, 'description'), h.span.class('project-file-copy').children(
        h.strong(doc.title), h.small(doc.path),
        h.span.class('document-count').children(`${doc.tokens} tokens · ${doc.spans} spans`),
      ));
  });
}

function sources(h: Builder, files: typeof Files.Type, needle: string) {
  const groups = new Map<string, {label: string; symbol: SymbolName; paths: string[]}>();
  for (const {role, path} of files.sources) {
    const display = roles.get(role) ?? {label: role.replaceAll('-', ' '), symbol: 'attach_file'};
    if (!`${path} ${role} ${display.label}`.toLocaleLowerCase().includes(needle)) continue;
    const group = groups.get(role) ?? {...display, paths: []};
    group.paths.push(path);
    groups.set(role, group);
  }
  if (!groups.size) return emptyList(h, 'No matching sources.');
  return [...groups].map(([role, group]) => h.details.key(role).class('source-group').attr('open', '').children(
    h.summary(symbol(h, 'chevron_right'), h.span.class('source-group-title').children(group.label),
      h.span.class('source-group-count').children(String(group.paths.length))),
    group.paths.map(path => {
      const start = path.lastIndexOf('/') + 1;
      return h.button.key(path).class('source-file')
        .attrs({type: 'button', 'data-source': path, title: path, 'aria-current': String(path === files.currentSource)})
        .on('click', Message.ClickedSource({path}))
        .children(symbol(h, group.symbol), h.span.class('project-file-copy').children(
          h.strong(path.slice(start)), start > 0 && h.small(path.slice(0, start)),
        ));
    }),
  ));
}

const ProjectFiles = Html.component({
  name: 'ProjectFiles',
  props: Files,
  model: Schema.Struct({section: Section, query: Schema.String, files: Files}),
  message: Message,
  events: Navigation,
}).make({
  init: ({props}) => ({section: 'documents', query: '', files: props}),
  update: {
    FilesChanged: ($, {files}) => $.evolve({files}),
    ChangedSection: ($, {section}) => $.evolve({section}),
    EditedFilter: ($, {query}) => $.evolve({query}),
    ClearedFilter: $ => $.evolve({query: ''}).run(HtmlCommand.focus(filterInput, () => Component.noop)),
    ClickedDocument: ($, {path}) => $.emit(Navigation.OpenDocument({path})),
    ClickedSource: ($, {path}) => $.emit(Navigation.OpenSource({path})),
  },
  view: (h, {section, query, files}) => {
    const needle = query.trim().toLocaleLowerCase();
    const sectionButton = (id: typeof Section.Type, list: string, label: string, glyph: SymbolName) =>
      h.button.id('navigate-' + id)
        .attrs({type: 'button', 'aria-controls': list, 'aria-pressed': String(section === id)})
        .on('click', Message.ChangedSection({section: id})).children(symbol(h, glyph), label);
    return h.div(
      h.nav.class('navigation-modes project-tabs').attr('aria-label', 'Corpus sections').children(
        sectionButton('documents', 'document-list', 'Documents', 'book_2'),
        sectionButton('sources', 'source-list', 'Sources', 'folder_open'),
      ),
      h.div.class('project-filter').children(
        h.label.class('sr-only').attr('for', 'navigation-query').children('Find documents or sources'),
        symbol(h, 'search'),
        h.input.id('navigation-query').ref(filterInput).value(query)
          .attrs({type: 'search', autocomplete: 'off', placeholder: 'Filter files'})
          .on('input', ({value}) => Message.EditedFilter({query: value})),
        h.button.id('clear-navigation')
          .attrs({type: 'button', 'aria-label': 'Clear filter', title: 'Clear filter', hidden: query ? undefined : ''})
          .on('click', Message.ClearedFilter()).children(symbol(h, 'close')),
      ),
      h.div.id('document-list').attr('hidden', section === 'documents' ? undefined : '')
        .children(section === 'documents' && documents(h, files, needle)),
      h.div.id('source-list').key(needle).attr('hidden', section === 'sources' ? undefined : '')
        .children(section === 'sources' && sources(h, files, needle)),
    );
  },
});

function fileList({view, currentDocument, currentSource}: ProjectFileSnapshot): typeof Files.Type {
  return {
    documents: view.documents.map(doc => ({path: doc.path, title: doc.title, tokens: doc.tokens.length, spans: doc.spans.length})),
    sources: Object.entries(view.snapshot.files).map(([path, file]) => ({path, role: file.role})),
    currentDocument, currentSource,
  };
}

export function mountProjectFiles(container: HTMLElement, signal: AbortSignal, initial: ProjectFileSnapshot,
  onNavigate: (event: FileNavigation) => void) {
  const scope = Effect.runSync(Scope.make());
  const root = Effect.runSync(BrowserHost.mountEffect(ProjectFiles, fileList(initial), container, {head: false, onEmit: onNavigate})
    .pipe(Scope.provide(scope)));
  signal.addEventListener('abort', () => Effect.runFork(Scope.close(scope, Exit.void)), {once: true});
  return (snapshot: ProjectFileSnapshot) => root.send(Message.FilesChanged({files: fileList(snapshot)}));
}
