import {checkView,type Command,type Operation,type Revision,type View} from './contracts';
let csrf='';try{csrf=sessionStorage.getItem('wb-csrf')??''}catch{/* A denied browser store must not prevent authenticated saving. */}
function retainCsrf(value:string){csrf=value;try{sessionStorage.setItem('wb-csrf',csrf)}catch{/* Keep the existing authenticated page usable in memory. */}}
let context:{authority:string;actor:string;project:string}|null=null;
export const draftContext=()=>context;
// The authority advertises its sign-in mode even when a browser needs to sign in.
// Every deployment can then serve exactly the same compiled frontend.
let preview = false;
export const isRemotePreview = () => preview;
export class ApiError extends Error { constructor(message:string,public status:number){super(message)} }
export class UnreadableUploadFile extends Error {}
export async function api<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T> {
  const response=await fetch(path,body===undefined ? {signal:signal??null} : {
    method:'POST',headers:{'Content-Type':'application/json','X-WB-CSRF':csrf},body:JSON.stringify(body),signal:signal??null,
  });
  const result=await response.json();
  if (path === '/api/session' && body === undefined) preview = result.remote_preview === true;
  if(!response.ok) throw new ApiError(result.error??'Request failed',response.status); return result as T;
}
export async function uploadFile(upload:string,path:string,file:File):Promise<void>{
  const url = `/api/return/file?upload=${encodeURIComponent(upload)}&path=${encodeURIComponent(path)}`;
  let response: Response;
  try {
    response = await fetch(url, {method:'POST', headers:{'Content-Type':'application/octet-stream','X-WB-CSRF':csrf}, body:file});
  } catch {
    try {
      // A missing or inaccessible file can appear to be empty in the folder picker.
      const sample = file.size ? file.slice(0, 1) : file;
      await sample.arrayBuffer();
    } catch {
      throw new UnreadableUploadFile(`Your browser could not read “${path}”. Check that the file exists and choose the folder again. For a long Windows path, move the exported folder closer to the top of the drive.`);
    }
    throw new Error(`The upload stopped at “${path}”. Check your connection and try again.`);
  }
  const result=await response.json();if(!response.ok)throw new ApiError(result.error??'Upload failed',response.status);
}
export async function login(code:string){const r=await api<{csrf:string}>('/api/session',{code});retainCsrf(r.csrf)}
export async function resumeSession(){const r=await api<{csrf:string;authority:string;actor:string;project:string}>('/api/session');retainCsrf(r.csrf);context=/^[a-f0-9]{64}$/.test(r.authority)&&typeof r.actor==='string'&&typeof r.project==='string'?{authority:r.authority,actor:r.actor,project:r.project}:null}
export async function loadView(){return checkView(await api<View>('/api/view'))}
export function makeCommand(view:View,operations:Operation[],label:string):Command {return {schema:1,project:view.snapshot.project,command_id:`cmd-${crypto.randomUUID()}`,base_revision:view.revision.id,preimage_hash:view.revision.snapshot_hash,config_version:view.snapshot.config.version,label,operations}}
export const commit=(command:Command)=>api<Revision>('/api/command',command);
