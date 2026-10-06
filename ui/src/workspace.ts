import type {Document,Token,View} from './contracts';
import {esc} from './dom';

// Trusted, compiled view registry. Corpus configuration supplies data, never code.
export const inspectorViews = [
  {id:'token',label:'Token'}, {id:'annotations',label:'Annotations'},
  {id:'definitions',label:'Definitions'}, {id:'history',label:'History'},
  {id:'review',label:'Review'}, {id:'references',label:'References'},
  {id:'structure',label:'Split / merge'}, {id:'xml',label:'XML'},
  {id:'return',label:'Return copy'},
  {id:'search',label:'Corpus search'},
] as const;
export type InspectorView = typeof inspectorViews[number]['id'];
export type ReadingLayer = 'corrected'|'original'|'normalized';
export type TokenFilter = 'all'|'corrected'|'untimed'|'attention';
export interface ReadingPreferences {query:string;layer:ReadingLayer;filter:TokenFilter}
export const isInspectorView=(id:string):id is InspectorView=>inspectorViews.some(v=>v.id===id);
export function reading(token:Token,layer:ReadingLayer):string {
  if(layer==='original')return token.original;
  if(layer==='normalized')return (token.attrs.wb_normalized_status==='unresolved'?null:token.normalized)??token.corrected??token.original;
  return token.corrected??token.original;
}
export function visibleToken(token:Token,preferences:ReadingPreferences):boolean {
  const query=preferences.query.trim().toLocaleLowerCase();
  const matches=!query||[token.id,token.original,token.corrected,token.normalized,token.language_effective].some(v=>v?.toLocaleLowerCase().includes(query));
  const filters:Record<TokenFilter,boolean>={all:true,corrected:token.corrected!==null,untimed:token.start_us===null||token.end_us===null,attention:!token.editable||token.attrs.wb_normalized_status==='unresolved'};
  return matches&&filters[preferences.filter];
}
export function documentNavigation(view:View,current:Document,query:string):string {
  const found=view.documents.filter(d=>[d.path,d.title].some(v=>v.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  return found.map(d=>`<button class="document ${d.path===current.path?'selected':''}" data-document="${esc(d.path)}" aria-current="${d.path===current.path}"><strong>${esc(d.title)}</strong><small>${esc(d.path)}</small><span class="document-count">${d.tokens.length} tokens <span aria-hidden="true">·</span> ${d.spans.length} spans</span></button>`).join('')||'<p class="empty-state">No matching documents.</p>';
}
export function sourceNavigation(view:View,query:string):string {
  const found=Object.entries(view.snapshot.files).filter(([path,a])=>`${path} ${a.role}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const groups=new Map<string,typeof found>();for(const entry of found){const role=entry[1].role;const group=groups.get(role)??[];group.push(entry);groups.set(role,group)}
  return [...groups].map(([role,files])=>`<details class="source-group" open><summary>${esc(role)} <span>${files.length}</span></summary>${files.map(([path])=>`<button class="source-file secondary" data-source="${esc(path)}">${esc(path)}</button>`).join('')}</details>`).join('')||'<p class="empty-state">No matching sources.</p>';
}
