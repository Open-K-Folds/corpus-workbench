import type {Command,View} from './contracts';
import {draftContext} from './api';

const PREFIX='wb-correction-v1:';
const JOURNAL=PREFIX+'journal';
const MAX_RECORD=64*1024,MAX_TOTAL=1024*1024,MAX_COUNT=20;
export interface LocalDraft {
  schema:1;id:string;authority:string;actor:string;project:string;document:string;
  revision:number;snapshot:string;artifact:string;config:number;layer:'corrected';
  ids:string[];internalIds:string[];readings:string[];start:number;end:number;backward:boolean;
  quote:string;before:string;prefix:string;suffix:string;replacement:string;
  command:Command|null;updated:number;
}
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.length>0&&v.length<=256&&v.every(x=>typeof x==='string');
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
export function validDraft(v:LocalDraft):boolean {
  if(!v||v.schema!==1||typeof v.id!=='string'||!/^draft-[a-f0-9-]{36}$/.test(v.id)||!hash(v.authority)||typeof v.actor!=='string'||typeof v.project!=='string'||typeof v.document!=='string'||!integer(v.revision)||!hash(v.snapshot)||!hash(v.artifact)||!integer(v.config)||v.layer!=='corrected'||!strings(v.ids)||!strings(v.internalIds)||!strings(v.readings)||v.ids.length!==v.internalIds.length||v.ids.length!==v.readings.length||new Set(v.ids).size!==v.ids.length||!integer(v.start)||!integer(v.end)||typeof v.backward!=='boolean'||!integer(v.updated))return false;
  if(![v.quote,v.before,v.prefix,v.suffix,v.replacement].every(x=>typeof x==='string'))return false;
  const first=Array.from(v.readings[0]),last=Array.from(v.readings.at(-1)!);
  if(v.before!==v.readings[0]||v.start>first.length||v.end>last.length||(v.ids.length===1&&v.start>v.end)||v.prefix!==first.slice(0,v.start).join('')||v.suffix!==(v.ids.length===1?first.slice(v.end).join(''):'')||(v.ids.length===1&&v.quote!==first.slice(v.start,v.end).join('')))return false;
  const c=v.command;
  if(c!==null){if(!c||typeof c!=='object'||!Array.isArray(c.operations))return false;const op=c.operations[0];if(c.schema!==1||c.project!==v.project||typeof c.command_id!=='string'||!/^cmd-[a-f0-9-]{36}$/.test(c.command_id)||c.base_revision!==v.revision||c.preimage_hash!==v.snapshot||c.config_version!==v.config||c.label!==`Correct ${v.ids[0]} in place`||c.operations.length!==1||v.ids.length!==1||op?.kind!=='set_token'||op.document!==v.document||op.token!==v.ids[0]||Object.keys(op.fields??{}).length!==1||op.fields.nform!==v.prefix+v.replacement+v.suffix||!op.fields.nform||/\s/u.test(op.fields.nform))return false;}
  return true;
}
export function scopedDrafts():{records:LocalDraft[];warning:string} {
  try{
    const context=draftContext();if(!context)throw new Error('The server did not provide a draft recovery identity.');
    const records:LocalDraft[]=[];let invalid=false;
    for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i)!;if(key.startsWith(PREFIX)&&key!==JOURNAL)invalid=true}
    for(const [id,v] of Object.entries(journal())){
      if(JSON.stringify(v).length*2>MAX_RECORD||!validDraft(v)||id!==v.id){invalid=true;continue}
      if(v.authority===context.authority&&v.actor===context.actor&&v.project===context.project)records.push(v);
    }
    return {records:records.sort((a,b)=>b.updated-a.updated),warning:invalid?'Unrecognized local draft records were preserved; they cannot be recovered by this version.':''};
  }catch{return {records:[],warning:'Local draft storage is unavailable. Unsaved corrections may be lost on reload or browser exit.'}}
}
function journal():Record<string,LocalDraft>{const value=JSON.parse(localStorage.getItem(JOURNAL)??'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Unrecognized draft journal');return value}
function storeDraft(record:LocalDraft,expected?:LocalDraft,replace?:LocalDraft):string {
  try{
    if(!validDraft(record))throw new Error('Invalid draft');
    const entries=journal(),source=replace??expected;
    if(source&&JSON.stringify(entries[source.id])!==JSON.stringify(source))return 'The local draft changed in another tab and was preserved.';
    if(replace)delete entries[replace.id];entries[record.id]=record;
    const raw=JSON.stringify(entries);
    if(JSON.stringify(record).length*2>MAX_RECORD||Object.keys(entries).length>MAX_COUNT||raw.length*2>MAX_TOTAL)return 'Local draft limit reached (20 drafts, 64 KiB each, 1 MiB total). Existing drafts are preserved. This correction is only in memory.';
    // One atomic browser storage write replaces the entire bounded journal.
    // Recovery can replace a source slot even at capacity, without a crash gap.
    localStorage.setItem(JOURNAL,raw);
    if(localStorage.getItem(JOURNAL)!==raw)throw new Error('Write was not retained');
    return '';
  }catch{return 'Local draft storage failed. This correction is only in memory; keep this page open until it is saved.'}
}
function deleteDraft(record:LocalDraft):string {
  try{const entries=journal(),current=entries[record.id];if(current!==undefined&&JSON.stringify(current)!==JSON.stringify(record))return 'The local draft changed in another tab and was preserved.';delete entries[record.id];localStorage.setItem(JOURNAL,JSON.stringify(entries));return ''}catch{return 'Could not remove the local draft. It may be offered again after reload.'}
}
// A shared browser lock makes both the origin-wide cap and conditional removal
// atomic across tabs. No record is evicted to make room for another correction.
export async function writeDraft(record:LocalDraft,expected?:LocalDraft,replace?:LocalDraft):Promise<string> {
  try{if(!navigator.locks)throw new Error('Browser locks unavailable');return await navigator.locks.request(PREFIX,()=>storeDraft(record,expected,replace))}catch{return 'Local draft storage is unavailable. This correction is only in memory.'}
}
export async function removeDraft(record:LocalDraft):Promise<string> {
  try{if(!navigator.locks)throw new Error('Browser locks unavailable');return await navigator.locks.request(PREFIX,()=>deleteDraft(record))}catch{return 'Could not remove the local draft. It may be offered again after reload.'}
}
export function matchesDraft(record:LocalDraft,view:View):boolean {
  const doc=view.documents.find(d=>d.path===record.document);
  return view.snapshot.project===record.project&&view.revision.id===record.revision&&view.revision.snapshot_hash===record.snapshot&&view.snapshot.files[record.document]?.sha256===record.artifact&&view.snapshot.config.version===record.config&&record.ids.every((id,i)=>{const token=doc?.tokens.find(t=>t.id===id);return token?.editable&&token.internal_id===record.internalIds[i]&&(token.corrected??token.original)===record.readings[i]});
}
