import {Command, UiSchema} from '@effect/ui';
import {BrowserHost, Html} from '@effect/ui/html';
import {Effect, Schema} from 'effect';
import {api} from './api';
import {runComponent} from './app-runtime';
import type {Revision, RevisionReviews, ReviewRecord, View} from './contracts';

const decisions = {approved:'Approved exact revision', rejected:'Rejected', 'needs-adjudication':'Needs adjudication'};
const RevisionRow = Schema.Struct({id: Schema.Number, label: Schema.String, snapshot_hash: Schema.String});
const Decision = Schema.Literals(['approved','rejected','needs-adjudication']);
const Record = Schema.Struct({id:Schema.Number, revision:Schema.Number, snapshot_hash:Schema.String, actor:Schema.String,
  decision:Decision, scope:Schema.String, note:Schema.String, created_at:Schema.String, self_review:Schema.Boolean});
const Props = Schema.Struct({head: RevisionRow, files: Schema.Number, documents: Schema.Number,
  issues: Schema.Array(Schema.Struct({target:Schema.String, message:Schema.String, blocking:Schema.Boolean}))});
const Message = UiSchema.TaggedEnum({
  Opened: {}, Select: {revision: Schema.Number}, RetryIndex: {},
  IndexReady: {rows: Schema.Array(RevisionRow)}, IndexFailed: {},
  Loaded: {revision:Schema.Number, generation:Schema.Number, rows:Schema.Array(Record)},
  Failed: {revision:Schema.Number, generation:Schema.Number, reason:Schema.String},
});
const loadIndex = Command.make('LoadReviewRevisions', {args:{head:RevisionRow}, mode:'switch'}, ({head}) =>
  Effect.promise(async signal => {
    try {
      const rows = (await api<Revision[]>('/api/history', undefined, signal)).filter(r => r.id <= head.id);
      return rows.some(r => r.id === head.id && r.snapshot_hash === head.snapshot_hash) ? Message.IndexReady({rows}) : Message.IndexFailed();
    } catch { return Message.IndexFailed(); }
  }));
const loadDecisions = Command.make('LoadReviewDecisions', {args:{expected:RevisionRow, generation:Schema.Number}}, ({expected,generation}) =>
  Effect.promise(async signal => {
    const revision = expected.id;
    try {
      const result = await api<RevisionReviews>('/api/reviews?revision=' + revision, undefined, signal);
      if (result.revision !== revision || result.snapshot_hash !== expected.snapshot_hash || !Array.isArray(result.reviews) ||
        result.reviews.some(r => r.revision !== revision || r.snapshot_hash !== expected.snapshot_hash || !Object.hasOwn(decisions,r.decision))) {
        throw new Error('Review history does not match the requested exact revision.');
      }
      return Message.Loaded({revision, generation, rows:result.reviews});
    } catch (error) { return Message.Failed({revision, generation, reason:String(error)}); }
  }));
const Model = Schema.Struct({revisions:Schema.Array(RevisionRow), index:Schema.Literals(['loading','ready','failed']),
  selected:Schema.Number, generation:Schema.Number, currentGeneration:Schema.Number, current:Schema.Literals(['loading','unavailable','unreviewed','approved','rejected','needs-adjudication']),
  rows:Schema.Array(Record), loading:Schema.Boolean, failure:Schema.String});

const Review = Html.component({name:'RevisionReview', props:Props, model:Model, message:Message}).make({
  init: ({props}) => ({revisions:[props.head], index:'loading', selected:props.head.id, generation:0, currentGeneration:0,
    current:'loading', rows:[], loading:true, failure:''}),
  update: {
    Opened: $ => $.run(loadIndex.make({head:$.props.head}), loadDecisions.make({expected:$.props.head, generation:0})),
    RetryIndex: $ => $.evolve({index:'loading'}).run(loadIndex.make({head:$.props.head})),
    IndexReady: ($,{rows}) => $.evolve({revisions:rows,index:'ready'}),
    IndexFailed: $ => $.evolve({index:'failed'}),
    Select: ($,{revision}) => {
      const expected = $.model.revisions.find(r => r.id === revision);
      if (!expected) return $.model;
      const generation = $.model.generation + 1;
      return $.evolve({selected:revision, generation, currentGeneration:revision === $.props.head.id ? generation : $.model.currentGeneration,
        rows:[], loading:true, failure:''}).run(loadDecisions.make({expected, generation}));
    },
    Loaded: ($,{revision,generation,rows}) => $.evolve({
      ...(revision === $.props.head.id && generation === $.model.currentGeneration
        ? {current:rows.find(r => r.scope === 'full')?.decision ?? 'unreviewed'} : {}),
      ...(revision === $.model.selected && generation === $.model.generation ? {rows, loading:false, failure:''} : {}),
    }),
    Failed: ($,{revision,generation,reason}) => $.evolve({
      ...(revision === $.props.head.id && generation === $.model.currentGeneration ? {current:'unavailable' as const} : {}),
      ...(revision === $.model.selected && generation === $.model.generation ? {rows:[], loading:false, failure:reason} : {}),
    }),
  },
  view: (h, m) => {
    const {head, files, documents, issues} = h.props;
    const blocking = issues.filter(i => i.blocking).length;
    const pending = m.current === 'loading' || m.current === 'unavailable';
    const currentText = m.current === 'loading' ? 'Loading current decision…' : m.current === 'unavailable' ? 'Current decision unavailable'
      : m.current === 'unreviewed' ? 'Unreviewed · no decision recorded' : decisions[m.current];
    const row = (r:ReviewRecord, first = false) => h.li.key(String(r.id)).attr('data-review-id',String(r.id)).children(
      h.div.class('review-record-heading').children(h.strong(decisions[r.decision]), first && h.span.class('review-latest').children('Latest')),
      h.p.class('review-record-meta').children(r.actor,' · ',r.self_review ? 'solo self-review' : 'reviewer',' · ',
        r.scope === 'full' ? 'full package' : r.scope,h.br,h.time.attr('datetime',r.created_at).children(r.created_at)),
      h.p.class('review-rationale',!r.note && 'muted').children(r.note || 'No rationale recorded.'));
    return h.section.class('review-panel').children(
      h.h2('Review exact R', String(head.id)),
      h.p.id('review-current-status').attr('role','status').attr('data-decision',pending ? undefined : m.current).children(currentText),
      h.p.class('muted').children('Full package scope · solo self-review. A later edit requires new review.'),
      h.div.class('revision-basis').children(h.strong('R',String(head.id),' · ',head.label),h.details(
        h.summary(String(files),' files · ',String(documents),' documents · snapshot'),h.code(head.snapshot_hash))),
      h.details.class('review-validation').attr('open',blocking ? '' : undefined).children(
        h.summary('Validation · ',String(blocking),' blocking · ',String(issues.length - blocking),' advisory'),
        h.p.class('muted').children('Approval covers this transcript, sidecars, definitions, settings and media hashes.'),
        h.ul(issues.length ? issues.map(i=>h.li.class(i.blocking && 'error').children(i.target,': ',i.message,' ',i.blocking?'(blocks approval)':'')) : h.li('No validation issues.'))),
      h.form.id('review-form').children(h.label('Decision',h.select.attr('name','decision').children(
        h.option.attr('value','approved').children('Approve exact revision'),h.option.attr('value','rejected').children('Reject'),
        h.option.attr('value','needs-adjudication').children('Needs adjudication'))),
        h.label('Review rationale',h.textarea.attrs({name:'note',rows:'3',placeholder:'What did you check or what needs attention?'})),
        h.button('Record review')),
      h.div.class('review-history-heading').children(h.h3('Decision history'),h.span.class('muted').children('Read-only')),
      h.label('Decision history for',h.select.id('review-history-revision').disabled(m.index !== 'ready').value(String(m.selected))
        .on('change',({value})=>Message.Select({revision:Number(value)})).children(m.revisions.map(r=>
          h.option.key(String(r.id)).attr('value',String(r.id)).children('R',String(r.id),' · ',r.label,r.id===head.id?' · current':'')))),
      h.p.id('review-revisions-status').class('muted').attr('role','status').children(m.index==='failed'?'Historical revision list unavailable. Current decisions remain accessible.':''),
      m.index==='failed' && h.button.id('retry-review-revisions').class('secondary').attr('type','button').on('click',Message.RetryIndex()).children('Retry revision list'),
      h.div.id('review-history').attr('aria-busy',String(m.loading)).children(m.loading ? h.p.attr('role','status').children('Loading review history…')
        : m.failure ? h.p.class('error').attr('role','alert').children('Could not load decision history for R',String(m.selected),'. ',m.failure)
        : [h.p.class('review-history-context').attr('role','status').children(m.selected===head.id?'Current R'+head.id:'Historical R'+m.selected+' · current review remains R'+head.id,
          ' · ',String(m.rows.length),m.rows.length===1?' decision':' decisions'),
          h.ol.class('review-records').children(m.rows[0]?row(m.rows[0],true):h.li.class('empty-state').children('No review decisions recorded for this exact revision.')),
          m.rows.length>1 && h.details.class('review-earlier').children(h.summary('Earlier decisions (',String(m.rows.length-1),')'),
            h.ol.class('review-records').attr('start','2').children(m.rows.slice(1).map(r=>row(r))))]),
      !!m.failure && h.button.id('retry-review-history').class('secondary').attr('type','button').on('click',Message.Select({revision:m.selected})).children('Retry review history'),
      h.div.class('review-contract').children(h.button.id('compiler-contract').class('secondary').attr('type','button').disabled(m.current!=='approved').children('Inspect approved export contract'),
        h.pre.id('contract-preview')));
  },
});
export function reviewInspector(view:View, signal:AbortSignal): HTMLElement {
  const host = document.createElement('div');
  const root = runComponent(BrowserHost.mountEffect(Review,{head:view.revision, files:Object.keys(view.snapshot.files).length,
    documents:view.documents.length, issues:view.issues},host,{head:false}),signal);
  root.send(Message.Opened());
  return host;
}
export {Review as RevisionReview, Message as ReviewMessage, loadDecisions};
