import {h} from './effect-view';
export const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
export const seconds=(us:number|null)=>us===null?'untimed':(us/1e6).toFixed(3)+' s';
export function field(name:string,label:string,value='',placeholder=''){return h.label(
  label,
  h.input.attrs({name: name, value: value, placeholder: placeholder, autocomplete: 'off'}),
)}
export function formValues(form:HTMLFormElement){return Object.fromEntries(new FormData(form).entries()) as Record<string,string>}
