import {Command, Component, Renderer, UiSchema} from '@effect/ui';
import {BrowserHost, Html, HtmlCommand} from '@effect/ui/html';
import {Effect, Option, Schema} from 'effect';
import {ApiError, login} from './api';
import {mountScreen, runComponent} from './app-runtime';
import {icon} from './icons';
import {windowBar} from './studio-shell';

const Code = Html.ref('Login.sessionCode', 'input');
const Failure = Schema.Literals(['rejected', 'unavailable']);
const Message = UiSchema.TaggedEnum({
  EditedCode: {}, Submitted: {}, Authenticated: {}, Failed: {reason: Failure},
});
const exchangeCode = Command.make('ExchangeSessionCode', {}, () => Effect.gen(function* () {
  const input = yield* (yield* Renderer.Refs).lookup(Code);
  if (Option.isNone(input)) return Message.Failed({reason: 'unavailable'});
  // The session code lives in the password field and never enters a replayable message or model.
  const code = input.value.value.trim();
  return yield* Effect.promise(async () => {
    try {
      await login(code);
      return Message.Authenticated();
    } catch (failure) {
      return Message.Failed({reason: failure instanceof ApiError && failure.status === 403 ? 'rejected' : 'unavailable'});
    }
  });
}));

const Props = Schema.Struct({remote: Schema.Boolean, expired: Schema.Boolean});
const Login = Html.component({
  name: 'WorkbenchLogin', props: Props, message: Message, events: Schema.Literal('OpenWorkspace'),
  model: Schema.Struct({opening: Schema.Boolean, failure: Schema.NullOr(Failure)}),
}).make({
  init: () => ({opening: false, failure: null}),
  update: {
    EditedCode: $ => $.evolve({failure: null}),
    Submitted: $ => $.model.opening ? $.model : $.evolve({opening: true, failure: null}).run(exchangeCode.make({})),
    Authenticated: $ => $.emit('OpenWorkspace'),
    Failed: ($, {reason}) => {
      const update = $.evolve({opening: false, failure: reason});
      return reason === 'rejected' ? update.run(HtmlCommand.focus(Code, () => Component.noop),
        HtmlCommand.select(Code, () => Component.noop)) : update;
    },
  },
  view: (h, {opening, failure}) => {
    const {remote, expired} = h.props;
    const rejected = failure === 'rejected';
    const form = h.form.id('login-form').on('submit', Message.Submitted()).children(
      h.label.attr('for', 'login-code').children('Session code'),
      h.input.id('login-code').ref(Code)
        .attrs({name: 'code', type: 'password', required: '', autocomplete: 'off', spellcheck: 'false',
          'aria-invalid': rejected ? 'true' : undefined, 'aria-describedby': rejected ? 'login-error' : undefined})
        .on('input', Message.EditedCode()),
      h.p.id('login-error').attr('role', 'alert').children(rejected
        ? 'This session code was not accepted. Use the code from the current launcher.'
        : failure ? 'Could not open the workbench. Check your connection and try again.' : ''),
      h.button.attr('type', 'submit').disabled(opening).children(opening ? 'Opening…' : 'Open workbench'),
    );
    return h.div.id('app').children(windowBar(false), h.main.class('login').children(
      h.h1('Open your workbench'),
      h.p.class('login-help').children(remote ? 'Sign in with the account authorized for this workspace.'
        : 'Open the protected launcher on this machine or enter its session code.'),
      expired && h.p.class('login-expired').attr('role', 'alert').children(remote
        ? 'This link has expired. Sign in again to continue.' : 'This link has expired. Open the current launcher or enter its new code.'),
      remote && h.a.class('cloudflare-sign-in').attr('href', '/open').children('Sign in with Cloudflare', icon('arrow_forward')),
      remote ? h.details.class('login-fallback').children(h.summary('Use a session code'), form) : form,
    ));
  },
});

export function mountLogin(host: HTMLElement, props: typeof Props.Type, open: () => Promise<void>) {
  return mountScreen(host, (stage, signal) => {
    const root = runComponent(BrowserHost.mountEffect(Login, props, stage, {
      head: false, onEmit: () => { void open().catch(() => root.send(Message.Failed({reason: 'unavailable'}))); },
    }), signal);
  });
}
