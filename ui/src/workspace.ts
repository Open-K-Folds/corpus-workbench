import type {Token} from './contracts';

// Trusted, compiled view registry. Corpus configuration supplies data, never code.
export const inspectorViews = [
  {id:'token',label:'Token',group:'Transcript'}, {id:'annotations',label:'Annotations',group:'Transcript'},
  {id:'definitions',label:'Spoken languages',group:'Transcript'}, {id:'history',label:'History',group:'Package'},
  {id:'review',label:'Review',group:'Package'}, {id:'references',label:'References',group:'Package'},
  {id:'structure',label:'Split / merge',group:'Transcript'}, {id:'xml',label:'XML',group:'Package'},
  {id:'return',label:'Return copy',group:'Package'},
  {id:'search',label:'Corpus search',group:'Research'},
  {id:'research',label:'Research handoff',group:'Research'},
  {id:'coanalysis',label:'Co-analysis',group:'Research'},
  {id:'training',label:'Training collections',group:'Research'},
  {id:'meanings',label:'Meaning labels',group:'Transcript'},
] as const;
export type InspectorView = typeof inspectorViews[number]['id'];
// The registry order also defines Alt+1 through Alt+9. Group the visible
// chooser by task without changing those established shortcuts.
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
