import {UiSchema} from '@effect/ui';
import {Html} from '@effect/ui/html';
import {Schema} from 'effect';
import {icon} from './icons';
import {inspectorViews} from './workspace';
import {activate} from './workbench-button';

export const Tool = Schema.Literals(inspectorViews.map(tool => tool.id));
export const ActiveTool = Schema.Union([Tool, Schema.Literal('source')]);
export function toolLabel(active: typeof ActiveTool.Type) {
  return inspectorViews.find(tool => tool.id === active)?.label ?? 'Source file';
}
const Pick = UiSchema.TaggedEnum({PickedTool: {tool: Tool}});
export const InspectorNavigation = Html.component({
  name: 'InspectorNavigation', props: ActiveTool, model: Schema.Null, message: Pick, events: Tool,
}).make({
  init: () => null, update: {PickedTool: ($, {tool}) => $.emit(tool)},
  view: h => h.details.class('inspector-tools').attr('open', '').children(
    h.summary.class('drawer-trail').attr('title', 'Choose inspector tool').children(
      h.span('Tools'), h.span.attr('aria-hidden', 'true').children('/'), h.strong.id('current-inspector').children(toolLabel(h.props)), icon('expand_more')),
    h.nav.attr('aria-label', 'Inspector').children(['Transcript', 'Research', 'Package'].map(group =>
      h.div.key(group).class('inspector-tool-group').attrs({role: 'group', 'aria-label': group}).children(
        h.span.attr('aria-hidden', 'true').children(group),
        h.div(inspectorViews.filter(tool => tool.group === group).map(tool =>
          h.button.key(tool.id).class(tool.id === h.props && 'active')
            .attrs({type: 'button', 'data-tab': tool.id, 'aria-pressed': String(tool.id === h.props)})
            .onMount(activate(Pick.PickedTool({tool: tool.id})))
            .children(h.span(tool.label), tool.id === h.props && icon('check')))),
      ))),
  ),
});
