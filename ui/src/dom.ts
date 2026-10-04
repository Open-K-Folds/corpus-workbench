export const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
export const seconds=(us:number|null)=>us===null?'untimed':(us/1e6).toFixed(3)+' s';
export function field(name:string,label:string,value='',placeholder=''){return `<label>${esc(label)}<input name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"></label>`}
export function formValues(form:HTMLFormElement){return Object.fromEntries(new FormData(form).entries()) as Record<string,string>}
