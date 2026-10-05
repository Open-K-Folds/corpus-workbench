// API v1. Field names mirror Rust model.rs. Browser integration tests validate
// these contracts against actual native service responses, not a mock ledger.
export interface Artifact { sha256: string; bytes: number; role: string }
export interface Config { version: number; language_values: Record<string,string>; language_default: string|null; layers: {id:string;parent:string|null;alignment:string;overlap:boolean;containment:boolean;coverage:boolean}[]; rights: string; machine_draft_provenance: string }
export interface Token { id: string; internal_id: string; original: string; corrected: string|null; normalized: string|null; attrs: Record<string,string>; utterance: string|null; start_us: number|null; end_us: number|null; language_effective: string|null; language_source: string; editable: boolean }
export interface Segment { id:string;start_us:number|null;end_us:number|null;attrs:Record<string,string> }
export interface Span { id:string;token_ids:string[];fields:Record<string,string>;sidecar:string }
export interface Document { path:string;title:string;tokens:Token[];segments:Segment[];spans:Span[];media:string[];metadata:Record<string,string>;opaque_elements:string[] }
export interface Snapshot {schema:number;project:string;files:Record<string,Artifact>;config:Config;index_status:string}
export interface Revision {id:number;parent:number|null;snapshot_hash:string;actor:string;label:string;created_at:string;command_id:string}
export interface View {api_version:number;revision:Revision;snapshot:Snapshot;documents:Document[];issues:{code:string;target:string;message:string;blocking:boolean}[];approved:boolean}
export interface Diff {from:number;to:number;changes:{document:string;sidecar?:string;target:string;field:string;before:string|null;after:string|null}[];files:{path:string}[];config_before:Config;config_after:Config}
export interface ReaderPreview {profile:string;profile_hash:string;revision:number;snapshot_hash:string;enabled:boolean;installed:boolean;blockers:string[];candidate_xml:Record<string,string>;before_hashes:Record<string,string|null>}
export type Operation =
 | {kind:'reconcile_package';request:ReturnRequest;preview_hash:string}
 | {kind:'install_teitok_reader';profile_hash:string}
 | {kind:'retokenize';request:RetokenizeRequest;preview_hash:string}
 | {kind:'set_token';document:string;token:string;fields:Record<string,string>}
 | {kind:'define_language';value:string;description:string}
 | {kind:'set_language_default';value:string|null}
 | {kind:'add_span';document:string;id:string;token_ids:string[];fields:Record<string,string>;character:{token:string;start:number;end:number;quote:string;coordinate:'unicode-codepoint';layer:'corrected'}|null}
 | {kind:'add_relation';document:string;from:string;to:string;relation_type:string;note:string}
 | {kind:'set_span';document:string;sidecar:string;id:string;fields:Record<string,string>;anchor:{kind:'tokens';token_ids:string[]}|{kind:'character';anchor:{token:string;start:number;end:number;quote:string;coordinate:'unicode-codepoint';layer:'corrected'}}|null}
 | {kind:'set_relation';document:string;from:string;to:string;relation_type:string;note:string|null}
 | {kind:'clear_relation';document:string;from:string}
 | {kind:'restore';revision:number};
export interface Command {schema:1;project:string;command_id:string;base_revision:number;preimage_hash:string;config_version:number;label:string;operations:Operation[]}
export interface ReturnRequest {schema:1;project:string;revision:number;snapshot_hash:string;stage:string;resolutions:Record<string,'current'|'external'>}
export interface ReturnChange {key:string;document:string;token:string;field:string;base:string|null;current:string|null;external:string|null;state:'external_change'|'already_current'|'conflict';choice:'current'|'external'|null}
export interface ReturnPreview {preview_hash:string;preview:{schema:1;grammar:string;request:ReturnRequest;exported_base:Revision;package_files:number;changed_xml:string[];retained_backups:string[];changes:ReturnChange[];blockers:string[];issues:View['issues'];candidate_snapshot_hash:string|null;lineage_path:string|null;ready:boolean}}
export interface QualifiedTarget {artifact:string;element_start:number;id:string}
export interface Reading {id:string;original:string;corrected:string|null;normalized:string|null}
export interface RetokenizeRequest {schema:1;project:string;revision:number;snapshot_hash:string;config_hash:string;inventory_hash:string;document:string;targets:QualifiedTarget[];replacement:Reading[];relation_endpoint:string|null}
export interface StructuralPreview {preview_hash:string;preview:{schema:number;grammar:string;request:RetokenizeRequest;execution_enabled:boolean;blockers:string[];mapping:Record<string,string[]>;candidate_snapshot_hash:string|null;candidate_xml:Record<string,string>;artifact_rules:Record<string,string>;lineage_path:string|null;proof:string}}
export interface Carrier {artifact:string;artifact_hash:string;element_start:number;element:string;namespace:string|null;kind:string;qname:string;byte_start:number;byte_end:number;value:string;syntax:string;resolution:string;targets:QualifiedTarget[];note:string}
export interface InventoryEnvelope {inventory_hash:string;inventory:{schema:number;project:string;revision:number;snapshot_hash:string;config_hash:string;artifacts:{path:string;artifact:Artifact;coverage:string;reason:string;carriers:number}[];carriers:Carrier[];ids:QualifiedTarget[];structural_execution_enabled:false;limitations:string[]}}
export function checkView(value:View):View {
  if(value.api_version!==1 || value.snapshot.schema!==1 || !Number.isInteger(value.revision.id) || !Array.isArray(value.documents) || !value.revision.snapshot_hash.match(/^[a-f0-9]{64}$/)) throw new Error('Unsupported server contract');
  for(const doc of value.documents) for(const token of doc.tokens) if(typeof token.id!=='string' || typeof token.original!=='string' || typeof token.internal_id!=='string') throw new Error('Invalid token contract');
  return value;
}
