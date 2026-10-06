import {checkView,type Command,type Operation,type Revision,type View} from './contracts';
let csrf=sessionStorage.getItem('wb-csrf')??'';
export class ApiError extends Error { constructor(message:string,public status:number){super(message)} }
export async function api<T>(path:string,body?:unknown):Promise<T> {
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-WB-CSRF':csrf},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json(); if(!response.ok) throw new ApiError(result.error??'Request failed',response.status); return result as T;
}
export async function uploadFile(upload:string,path:string,file:File):Promise<void>{
  const response=await fetch(`/api/return/file?upload=${encodeURIComponent(upload)}&path=${encodeURIComponent(path)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-WB-CSRF':csrf},body:file});
  const result=await response.json();if(!response.ok)throw new ApiError(result.error??'Upload failed',response.status);
}
export async function login(code:string){const r=await api<{csrf:string}>('/api/session',{code});csrf=r.csrf;sessionStorage.setItem('wb-csrf',csrf)}
export async function resumeSession(){const r=await api<{csrf:string}>('/api/session');csrf=r.csrf;sessionStorage.setItem('wb-csrf',csrf)}
export async function loadView(){return checkView(await api<View>('/api/view'))}
export function makeCommand(view:View,operations:Operation[],label:string):Command {return {schema:1,project:view.snapshot.project,command_id:`cmd-${crypto.randomUUID()}`,base_revision:view.revision.id,preimage_hash:view.revision.snapshot_hash,config_version:view.snapshot.config.version,label,operations}}
export const commit=(command:Command)=>api<Revision>('/api/command',command);
