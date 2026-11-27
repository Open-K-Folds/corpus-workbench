import {UiSchema} from '@effect/ui';
import {Html} from '@effect/ui/html';
import {Schema} from 'effect';

const Proposal = Schema.Struct({model: Schema.String, proposal: Schema.String,
  method: Schema.Literals(['manual','llama.cpp']), first_reading: Schema.optionalKey(Schema.String)});
const Model = Schema.Struct({proposal: Schema.NullOr(Proposal), waiting: Schema.Boolean, stale: Schema.Boolean, status: Schema.String});
export const ReadingMessage = UiSchema.TaggedEnum({Requested: {}, Reviewed: {proposal: Proposal}, Failed: {reason: Schema.String},
  Stale: {}, Notice: {text: Schema.String}});
export const PassageReading = Html.component({name:'PassageReading', model:Model, message:ReadingMessage}).make({
  init: () => ({proposal:null, waiting:false, stale:false, status:''}),
  update: {
    Requested: $ => $.model.stale || $.model.proposal ? $.model : $.evolve({waiting:true, status:'Waiting for the local model…'}),
    Reviewed: ($, {proposal}) => $.model.stale || $.model.proposal ? $.model : $.evolve({proposal, waiting:false, status:''}),
    Failed: ($, {reason}) => $.model.stale ? $.model : $.evolve({waiting:false, status:reason}),
    Stale: $ => $.evolve({stale:true, waiting:false,
      status:'This passage was analysed against an older revision. Discard this draft and reload the saved passage before analysing again.'}),
    Notice: ($, {text}) => $.model.stale ? $.model : $.evolve({status:text}),
  },
  view: (h,m) => h.p.attrs({'data-status':'',role:'status'}).children(m.status),
});
