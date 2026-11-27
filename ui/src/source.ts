import {Command, UiSchema} from '@effect/ui';
import {BrowserHost, Html} from '@effect/ui/html';
import {Effect, Schema} from 'effect';
import {api} from './api';
import {runComponent} from './app-runtime';
import type {View} from './contracts';

const File = Schema.Struct({path: Schema.String, revision: Schema.Number, hash: Schema.String});
const Props = Schema.Struct({...File.fields, bytes: Schema.Number, role: Schema.String, xmlOnly: Schema.Boolean});
const Result = UiSchema.TaggedEnum({Loaded: {xml: Schema.String}, Failed: {reason: Schema.String}});
const loadXml = Command.make('ReadPreservedXml', {args: File.fields}, ({path, revision, hash}) =>
  Effect.promise(async signal => {
    try {
      const record = await api<{xml: string; revision: number; artifact_hash: string}>(
        '/api/xml?path=' + encodeURIComponent(path) + '&revision=' + revision, undefined, signal);
      if (record.revision !== revision || record.artifact_hash !== hash) throw new Error('Source revision binding mismatch');
      return Result.Loaded({xml: record.xml});
    } catch (error) { return Result.Failed({reason: String(error)}); }
  }));

const Source = Html.component({
  name: 'RevisionSource', props: Props, message: Result, events: Schema.String,
  model: Schema.Struct({xml: Schema.NullOr(Schema.String), failure: Schema.NullOr(Schema.String)}),
}).make({
  init: $ => {
    const initial = $.set({xml: null, failure: null});
    const {path, revision, hash, xmlOnly} = $.props;
    return xmlOnly || path.endsWith('.xml') ? initial.run(loadXml.make({path, revision, hash})) : initial;
  },
  update: {
    Loaded: ($, {xml}) => $.evolve({xml}),
    Failed: ($, {reason}) => $.evolve({failure: reason}).emit(reason),
  },
  view: (h, {xml, failure}) => {
    const {path, revision, hash, bytes, role, xmlOnly} = h.props;
    if (xmlOnly) return h.section(h.h2('Preserved XML · read-only'), h.pre.id('xml-preview').children(failure ?? xml ?? 'Loading…'));
    return h.section.class('source-inspector').children(
      h.h2('Source artifact'), h.p.class('source-path').children(path),
      h.dl.class('metadata-list').children(h.dt('Role'), h.dd(role), h.dt('Size'), h.dd(bytes.toLocaleString(), ' bytes'),
        h.dt('Revision'), h.dd('R', String(revision)), h.dt('SHA-256'), h.dd.class('hash').children(hash)),
      h.p.class('muted').children('Preserved immutable bytes. Imported scripts and unknown formats are inspected as data.'),
      path.endsWith('.xml') ? h.pre.id('source-preview').children(failure ?? xml ?? 'Loading…')
        : h.p.class('empty-state').children('No inline decoder for this artifact. Its complete original bytes remain in the package export.'),
    );
  },
});

export function mountSource(host: HTMLElement, view: View, path: string, xmlOnly: boolean, signal: AbortSignal, report: (reason: string) => void) {
  const artifact = view.snapshot.files[path];
  if (!artifact) { report('Source is absent from this exact snapshot'); return; }
  const stage = document.createElement('div');
  stage.className = 'inspector-mount';
  host.append(stage);
  runComponent(BrowserHost.mountEffect(Source, {path, revision: view.revision.id, hash: artifact.sha256, bytes: artifact.bytes, role: artifact.role, xmlOnly},
    stage, {head: false, onEmit: report}), signal);
}
