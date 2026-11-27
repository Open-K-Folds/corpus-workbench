import {Command, Renderer, UiSchema} from '@effect/ui';
import {BrowserHost, Html} from '@effect/ui/html';
import {Effect, Schema} from 'effect';
import {mountScreen, runComponent} from './app-runtime';
import {activityRail, drawerClose, windowBar, workspaceSettings} from './studio-shell';
import {readingToolbar} from './reading-toolbar';
import {projectDrawerBody} from './project-drawer';
import {stageControls} from './reading-canvas';
import {InspectorNavigation, Tool, ActiveTool, toolLabel} from './inspector-navigation';
import {ReadingFrame, TranscriptReading} from './reading-view';
import {activate} from './workbench-button';
import {icon} from './icons';
import type {Document, View} from './contracts';

const Summary = Schema.Struct({
  project: Schema.String, path: Schema.String, title: Schema.String, annotations: Schema.String,
  documents: Schema.Number, files: Schema.Number, indexStatus: Schema.String, rights: Schema.String,
  unknown: Schema.String, tabs: Schema.Array(Schema.Struct({path: Schema.String, title: Schema.String})),
});
export type WorkspaceSummary = typeof Summary.Type;
const Actions = UiSchema.TaggedEnum({
  ReceivedSummary: {summary: Summary},
  ReportedNotice: {text: Schema.String, error: Schema.Boolean},
  ClickedDocument: {path: Schema.String},
  ClickedAnnotations: {}, PickedTool: {tool: Tool}, ChangedTool: {tool: ActiveTool},
  ShowReading: {frame: ReadingFrame, receipt: Schema.Number}, ReadingPainted: {receipt: Schema.Number},
});
const Navigation = UiSchema.TaggedEnum({OpenDocument: {path: Schema.String}, OpenAnnotations: {}, OpenTool: {tool: Tool}, ReadingPainted: {receipt: Schema.Number}});
const transcriptPane = Html.ref('Workbench.transcriptPane', 'main');
// Refs resolve after the DOM commit. Native Range, annotation and playback controllers can
// then attach to the exact token nodes rendered for this revision.
const afterReading = Command.make('AfterTranscriptPaint', {args: {receipt: Schema.Number}}, ({receipt}) =>
  Effect.gen(function* () {
    yield* (yield* Renderer.Refs).lookup(transcriptPane);
    return Actions.ReadingPainted({receipt});
  }));
// Media elements retain their identity and playback position while sibling screens update.
const RecordingDock = Html.component({name: 'RecordingDock', model: Schema.Null, message: Schema.Never}).make({
  init: () => null,
  update: () => null,
  view: h => h.section
        .id('recording-pane')
        .class('audio')
        .attrs({'aria-label': 'Recording'})
        .children(
          h.audio.id('audio').attrs({preload: 'metadata'}),
          h.p
            .id('audio-availability')
            .class('muted')
            .attrs({hidden: ''})
            .children('No playable media is included for this document.'),
          h.div
            .class('actions')
            .attrs({role: 'group', 'aria-label': 'Selection playback', hidden: ''})
            .children(
              h.button
                .id('listen-selected')
                .class('secondary')
                .attrs({type: 'button', 'aria-label': 'Play from selection'})
                .children(icon('play_arrow'), h.span('Play from selection')),
              h.label
                .class('selection-loop')
                .attrs({title: 'Loop selection'})
                .children(
                  h.input
                    .id('loop-selection')
                    .attrs({type: 'checkbox', role: 'switch', 'aria-label': 'Loop selection'}),
                  icon('repeat'),
                ),
            ),
        ),
});

const Workbench = Html.component({
  name: 'CorpusWorkbench', props: Summary, message: Actions, events: Navigation,
  model: Schema.Struct({summary: Summary, notice: Schema.String, error: Schema.Boolean, tool: ActiveTool, reading: ReadingFrame}),
}).make({
  init: ({props}) => ({summary: props, notice: '', error: false, tool: 'token' as const, reading: {_tag: 'Loading' as const}}),
  update: {
    ReceivedSummary: ($, {summary}) => $.evolve({summary}),
    ReportedNotice: ($, {text, error}) => $.evolve({notice: text, error}),
    PickedTool: ($, {tool}) => $.emit(Navigation.OpenTool({tool})),
    ChangedTool: ($, {tool}) => $.model.tool === tool ? $.model : $.evolve({tool}),
    ShowReading: ($, {frame, receipt}) => receipt
      ? $.evolve({reading: frame}).run(afterReading.make({receipt})) : $.evolve({reading: frame}),
    ReadingPainted: ($, {receipt}) => $.emit(Navigation.ReadingPainted({receipt})),
    ClickedDocument: ($, {path}) => $.emit(Navigation.OpenDocument({path})),
    ClickedAnnotations: $ => $.emit(Navigation.OpenAnnotations()),
  },
  view: (h, {summary, notice, error, tool, reading}) => h.div.id('app').children(
      h.a.class('skip-link').attrs({href: '#tokens'}).children('Skip to transcript'),
      windowBar(true, summary.project),
      activityRail(),
      h.div.id('message').class(error ? 'notice error' : 'notice').attrs({role: 'alert'}).children(notice),
      h.div.id('conflict'),
      h.div.id('save-recovery').attrs({'aria-live': 'polite'}),
      h.div.class('workspace navigation-folded properties-folded').children(
        h.aside
          .id('projects-pane').class('documents')
          .attrs({'aria-label': 'Corpus navigation'})
          .children(
            h.div
              .class('drawer-bar')
              .children(
                h.div
                  .class('drawer-trail')
                  .children(
                    h.span('Workspace'),
                    h.span.attrs({'aria-hidden': 'true'}).children('/'),
                    h.strong('Projects'),
                  ),
                drawerClose('navigation'),
              ),
            projectDrawerBody(summary),
            h.div.id('navigation-resizer').class('side-resizer').attrs({'aria-label': 'Resize projects pane'}),
          ),
        h.main.ref(transcriptPane)
          .class('transcript')
          .children(
            h.div.id('document-tabs').attrs({role: 'tablist', 'aria-label': 'Open documents'}).children(
              summary.tabs.map(tab => h.button.key(tab.path)
                .attrs({role: 'tab', 'aria-selected': String(tab.path === summary.path), 'data-open-document': tab.path})
                .onMount(activate(Actions.ClickedDocument({path: tab.path}))).children(tab.title)),
            ),
            readingToolbar(),
            h.div.class('transcript-title').children(h.h2.id('document-title').children(summary.title)),
            h.p
              .class('canvas-help')
              .children(
                'Drag across words to select a passage. Drag the margin to move through the transcript.',
              ),
            TranscriptReading(h, {props: reading}),
          ),
        h.section.id('training-comparison').attrs({'aria-label': 'Compare with selected transcript'}),
        stageControls(),
        h.aside
          .id('properties-pane').class('inspector')
          .attrs({'aria-label': 'Inspector'})
          .children(
            h.div.id('properties-resizer').class('side-resizer').attrs({'aria-label': 'Resize properties pane'}),
            h.div.class('drawer-bar').children(
                InspectorNavigation(h, {props: tool, onEmit: tool => Actions.PickedTool({tool})}),
              drawerClose('properties'),
            ),
            h.div.id('inspector-content').attrs({role: 'region', tabindex: '-1', 'aria-label': toolLabel(tool)}),
          ),
      ),
      RecordingDock(h, {}),
      h.footer
        .class('studio-status')
        .children(
          h.span.id('stage-file').children(summary.path),
          h.button.id('stage-metadata').attrs({type: 'button', title: 'Open annotations'})
            .onMount(activate(Actions.ClickedAnnotations())).children(summary.annotations),
          h.span.id('token-count').attrs({role: 'status'}),
        ),
      h.div.id('passage-tools-layer').attrs({role: 'region', 'aria-label': 'Passage actions'}),
      workspaceSettings(),

  ),
});

export function summarizeWorkspace(view: View, doc: Document, paths: readonly string[]): WorkspaceSummary {
  return {
    project: view.snapshot.project, path: doc.path, title: doc.title,
    annotations: doc.spans.length + (doc.spans.length === 1 ? ' annotation' : ' annotations'),
    documents: view.documents.length, files: Object.keys(view.snapshot.files).length,
    indexStatus: view.snapshot.index_status, rights: view.snapshot.config.rights,
    unknown: doc.opaque_elements.join(', ') || 'none',
    tabs: paths.map(path => ({path, title: view.documents.find(d => d.path === path)?.title ?? path})),
  };
}

export function mountWorkbench(host: HTMLElement, summary: WorkspaceSummary, navigate: (event: Exclude<typeof Navigation.Type, {_tag: 'ReadingPainted'}>) => void) {
  return mountScreen(host, (stage, signal) => {
    const waiting = new Map<number, () => void>();
    let receipt = 0;
    const root = runComponent(BrowserHost.mountEffect(Workbench, summary, stage, {head: false, onEmit: event => {
      if (event._tag !== 'ReadingPainted') { navigate(event); return; }
      waiting.get(event.receipt)?.();
      waiting.delete(event.receipt);
    }}), signal);
    signal.addEventListener('abort', () => { for (const resolve of waiting.values()) resolve(); waiting.clear(); }, {once: true});
    return {
      inspector: (tool: typeof ActiveTool.Type) => root.send(Actions.ChangedTool({tool})),
      present: (frame: ReadingFrame): Promise<void> => {
        if (signal.aborted) return Promise.resolve();
        if (frame._tag !== 'Ready') {
          root.send(Actions.ShowReading({frame, receipt: 0}));
          return Promise.resolve();
        }
        const next = ++receipt;
        return new Promise(resolve => { waiting.set(next, resolve); root.send(Actions.ShowReading({frame, receipt: next})); });
      },
      refresh: (summary: WorkspaceSummary) => root.send(Actions.ReceivedSummary({summary})),
      message: (text: string, error: boolean) => root.send(Actions.ReportedNotice({text, error})),
      signal,
    };
  });
}
