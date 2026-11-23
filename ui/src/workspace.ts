import type {Document,Token,View} from './contracts';
import {esc} from './dom';
import {icon,type SymbolName} from './icons';

// Trusted, compiled view registry. Corpus configuration supplies data, never code.
export const inspectorViews = [
  {id:'token',label:'Token',group:'Transcript'}, {id:'annotations',label:'Annotations',group:'Transcript'},
  {id:'definitions',label:'Definitions',group:'Transcript'}, {id:'history',label:'History',group:'Package'},
  {id:'review',label:'Review',group:'Package'}, {id:'references',label:'References',group:'Package'},
  {id:'structure',label:'Split / merge',group:'Transcript'}, {id:'xml',label:'XML',group:'Package'},
  {id:'return',label:'Return copy',group:'Package'},
  {id:'search',label:'Corpus search',group:'Research'},
  {id:'research',label:'Research handoff',group:'Research'},
  {id:'coanalysis',label:'Co-analysis',group:'Research'},
  {id:'training',label:'Training collections',group:'Research'},
] as const;
export type InspectorView = typeof inspectorViews[number]['id'];
// The registry order also defines Alt+1 through Alt+9. Group the visible
// chooser by task without changing those established shortcuts.
export function inspectorNavigation() {
  return ['Transcript','Research','Package'].map(group=>{
    const tools=inspectorViews.filter(view=>view.group===group);
    return `<div class="inspector-tool-group" role="group" aria-label="${group}">
      <span aria-hidden="true">${group}</span><div>${tools.map(tool=>
        `<button type="button" data-tab="${tool.id}" aria-pressed="false">${tool.label}</button>`
      ).join('')}</div></div>`;
  }).join('');
}
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
  return found.map(doc=>{
    const selected=doc.path===current.path;
    return `<button type="button" class="document ${selected?'selected':''}" data-document="${esc(doc.path)}" aria-current="${selected}" title="${esc(doc.path)}">
      ${icon('description')}<span class="project-file-copy"><strong>${esc(doc.title)}</strong><small>${esc(doc.path)}</small><span class="document-count">${doc.tokens.length} tokens · ${doc.spans.length} spans</span></span>
    </button>`;
  }).join('')||`<p class="project-empty" role="status">${icon('search')}No matching documents.</p>`;
}
export function sourceNavigation(view:View,query:string,selectedPath=''):string {
  const roles:Record<string,{label:string;symbol:SymbolName}>={
    'source-media':{label:'Recordings and media',symbol:'headphones'},
    'project-settings':{label:'Project settings',symbol:'settings'},
    'transcript':{label:'Transcripts',symbol:'description'},
    'immutable-machine-draft':{label:'Machine drafts',symbol:'auto_awesome'},
    'annotation-sidecar-or-definition':{label:'Annotations and definitions',symbol:'edit_note'},
    'derived-index':{label:'Search indexes',symbol:'search'},
    'inert-compatibility-dependency':{label:'Compatibility files',symbol:'attach_file'},
    'opaque-project-artifact':{label:'Other project files',symbol:'attach_file'},
  };
  const groupName=(role:string)=>roles[role]?.label??role.replaceAll('-',' ');
  const needle=query.trim().toLocaleLowerCase();
  const found=Object.entries(view.snapshot.files).filter(([path,a])=>`${path} ${a.role} ${groupName(a.role)}`.toLocaleLowerCase().includes(needle));
  const groups=new Map<string,typeof found>();for(const entry of found){const role=entry[1].role;const group=groups.get(role)??[];group.push(entry);groups.set(role,group)}
  return [...groups].map(([role,files])=>`<details class="source-group" open><summary>${icon('chevron_right')}<span class="source-group-title">${esc(groupName(role))}</span><span class="source-group-count">${files.length}</span></summary>${files.map(([path])=>{
    const start=path.lastIndexOf('/')+1;
    return `<button type="button" class="source-file" data-source="${esc(path)}" title="${esc(path)}" aria-current="${path===selectedPath}">
      ${icon(roles[role]?.symbol??'attach_file')}<span class="project-file-copy"><strong>${esc(path.slice(start))}</strong>${start?`<small>${esc(path.slice(0,start))}</small>`:''}</span>
    </button>`;
  }).join('')}</details>`).join('')||`<p class="project-empty" role="status">${icon('search')}No matching sources.</p>`;
}
