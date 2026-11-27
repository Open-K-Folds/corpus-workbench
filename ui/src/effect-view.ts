import {View} from '@effect/ui';
import {BrowserHost, Html} from '@effect/ui/html';
import {Effect, Schema} from 'effect';

// The same immutable HTML builders used by a component's view, for shared presentation functions.
export const h = Html.vocabulary.tags as Html.Tags<never>;
export const displayText = (value: unknown) => String(value ?? '');
export function group(...children: View.Input<never>[]) {
  return View.children<never>(children) as View.Node<never>[];
}

const Presentation = Schema.declare<View.Children<never, never>>((value) => Array.isArray(value));
const Fragment = Html.component({
  name: 'EditorFragment',
  props: Presentation,
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: () => null,
  view: (html) => html.div(html.props),
});

// Native editors keep references to selections, draft forms and media elements. Transfer their
// static child views into the owning editor, then release the temporary renderer immediately.
// Interactive Effect components mount in their own scope and keep their message handlers.
export function viewFragment(...children: View.Input<never>[]): DocumentFragment {
  const host = document.createElement('div');
  const fragment = document.createDocumentFragment();
  Effect.runSync(Effect.scoped(Effect.gen(function* () {
    yield* BrowserHost.mountEffect(Fragment, group(...children), host, {head: false});
    const wrapper = host.firstElementChild!;
    while (wrapper.firstChild) fragment.append(wrapper.firstChild);
  })));
  return fragment;
}

export function renderInto(host: Element, ...children: View.Input<never>[]) {
  host.replaceChildren(viewFragment(...children));
}
