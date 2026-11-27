import {UiSchema} from '@effect/ui';
import {BrowserHost, Html} from '@effect/ui/html';
import {Schema} from 'effect';
import {mountScreen, runComponent} from './app-runtime';
import {icon} from './icons';
import {windowBar} from './studio-shell';

export const projectActions = {
  prepare: {label:'Recording + transcript', glyph:'graphic_eq'},
  import: {label:'Import TEITOK package', glyph:'folder_open'},
  open: {label:'Open existing workbench', glyph:'history'},
  demo: {label:'Start a new practice copy', glyph:'notes'},
} as const;

const State = Schema.Struct({
  status: Schema.Literals(['idle', 'loading', 'ready', 'error']), version: Schema.String,
  error: Schema.NullOr(Schema.String), recovery: Schema.Boolean,
  recent: Schema.Array(Schema.Struct({id: Schema.String, project: Schema.String, title: Schema.String})),
});
const Action = UiSchema.TaggedEnum({Prepare: {}, Import: {}, Open: {}, Demo: {}, Retry: {}, OpenRecent: {id: Schema.String}});
export type LauncherAction = typeof Action.Type;
const Message = UiSchema.TaggedEnum({ReceivedState: {state: State}, ClickedAction: {action: Action}, Failed: {reason: Schema.String}});
const Launcher = Html.component({
  name: 'DesktopProjectLauncher', props: State, model: State, message: Message, events: Action,
}).make({
  init: ({props}) => props,
  update: {
    ReceivedState: (_, {state}) => state,
    ClickedAction: ($, {action}) => $.model.status === 'loading' ? $.model : $.emit(action),
    Failed: ($, {reason}) => $.evolve({error: reason}),
  },
  view: (h, state) => {
    const busy = state.status === 'loading';
    const recent = (entries: typeof state.recent) => entries.map(p =>
      h.button.key(p.id).class('desktop-recent secondary').disabled(busy).attr('data-desktop-project', p.id)
        .on('click', Message.ClickedAction({action: Action.OpenRecent({id: p.id})}))
        .children(h.strong(p.title), h.span(p.project), icon('chevron_right')));
    const button = (id: keyof typeof projectActions, detail: string, action: LauncherAction) =>
      h.button.id('desktop-' + id).class(id !== 'prepare' && 'secondary').disabled(busy)
        .on('click', Message.ClickedAction({action})).children(icon(projectActions[id].glyph), h.span(projectActions[id].label), h.small(detail));
    return h.div.id('app').children(windowBar(false), h.main.class('desktop-welcome').children(
      h.h1.class('welcome-heading').children('Open a project'),
      h.p.class('welcome-intro').children('Choose your source materials or return to a saved workbench.'),
      !!state.recent.length && h.section.class('welcome-recent').children(h.h2('Recent projects'), recent(state.recent.slice(0, 3)),
        state.recent.length > 3 && h.details(h.summary('Show ', String(state.recent.length - 3), ' more'), recent(state.recent.slice(3)))),
      h.div.class('welcome-actions').children(
        button('prepare', 'Pair audio with UTF-8 text or Omnilingual JSON.', Action.Prepare()),
        button('import', 'Create a working copy of a complete corpus folder.', Action.Import()),
        button('open', 'Choose the folder containing your saved workbench.', Action.Open()),
        button('demo', 'Try the workflow with generated text and a tone.', Action.Demo()),
      ),
      h.div.id('desktop-status').class(state.error ? 'notice error' : 'desktop-status').attr('role', 'status')
        .children(busy ? 'Opening your corpus…' : state.error ?? ''),
      state.status === 'error' && h.button.id('desktop-retry').class('secondary')
        .on('click', Message.ClickedAction({action: Action.Retry()})).children(state.recovery ? 'Retry draft recovery' : 'Try again'),
      h.footer(h.span('Version ', state.version)),
    ));
  },
});

export function mountLauncher(host: HTMLElement, initial: typeof State.Type, act: (action: LauncherAction) => Promise<unknown>) {
  return mountScreen(host, (stage, signal) => {
    const root = runComponent(BrowserHost.mountEffect(Launcher, initial, stage, {head: false,
      onEmit: action => { void act(action).catch(error => root.send(Message.Failed({reason: String(error)}))); },
    }), signal);
    return {signal, update: (state: typeof State.Type) => root.send(Message.ReceivedState({state}))};
  });
}
