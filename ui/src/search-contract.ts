import {Schema} from 'effect';

const Text = Schema.NullOr(Schema.String);
const strings = Schema.mutable(Schema.Array(Schema.String));
export const Query = Schema.Struct({
  schema: Schema.Literal(1), project: Schema.String, revision: Schema.Number, snapshot_hash: Schema.String,
  mode: Schema.Literals(['current','historical']), reading: Schema.Literals(['original','corrected','normalized']),
  terms: Schema.mutable(Schema.Array(Schema.Struct({text:Schema.String,language:Text}))),
  span: Schema.optional(Schema.Struct({field:Schema.Literals(['label','variety']),value:Schema.String})),
  documents: strings, context: Schema.Number, offset: Schema.Number, limit: Schema.Number,
});
export type SearchQuery = typeof Query.Type;
const Word = Schema.Struct({id:Schema.String, internal_id:Schema.String, original:Schema.String, corrected:Text, normalized:Text,
  normalized_status:Text, language:Text, language_source:Schema.String});
const words = Schema.mutable(Schema.Array(Word));
const Span = Schema.Struct({id:Schema.String,sidecar:Schema.String,artifact_hash:Schema.String,token_ids:strings,
  fields:Schema.Record(Schema.String,Schema.String)});
const Hit = Schema.Struct({
  id:Schema.String, document:Schema.String, title:Schema.String, utterance:Text, speaker:Text, token_ids:strings,
  corpus_start:Schema.Number, corpus_end:Schema.Number, left:words, matched:words, right:words, readings:strings,
  audio:Schema.NullOr(Schema.Struct({path:Schema.String,artifact_hash:Schema.String,start_us:Schema.Number,end_us:Schema.Number,basis:Schema.String})),
  spans:Schema.optional(Schema.mutable(Schema.Array(Span))),
});
export type SearchHit = typeof Hit.Type;
const Binding = Schema.Struct({engine:Schema.String,project:Schema.String,revision:Schema.Number,snapshot_hash:Schema.String,projection_hash:Schema.String});
export const Response = Schema.Struct({result_hash:Schema.String,result:Schema.Struct({
  schema:Schema.Number,binding:Binding,query:Query,total:Schema.Number,hits:Schema.mutable(Schema.Array(Hit)),next_offset:Schema.NullOr(Schema.Number),rights:Schema.String,
})});
export type SearchResponse = typeof Response.Type;
