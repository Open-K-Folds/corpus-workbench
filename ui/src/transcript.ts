import {api,ApiError,commit,loadView,makeCommand} from './api';
import type {Command,Diff,Document,Revision,Token,View} from './contracts';
import {esc} from './dom';
import {reading,visibleToken,type ReadingPreferences} from './workspace';

interface Block {source_id:string|null;source_kind:string;anchor_token:string|null;sections:{id:string;kind:string;number:string|null}[];runs:{token:string|null;text:string}[]}
interface Projection {schema:1;project:string;revision:number;snapshot_hash:string;document:string;artifact_hash:string;media_base_unsupported:boolean;blocks:Block[]}
interface SelectionBasis {view:View;document:string;ids:string[];start:number;end:number;quote:string;layer:string;range:Range|null;backward?:boolean}
interface Draft {basis:SelectionBasis;before:string;prefix:string;suffix:string;replacement:string;command:Command|null;phase:'editing'|'saving'|'unknown'|'conflict';latest:View|null;compared:boolean;epoch?:number;unlock?:()=>void}
interface Host {view:()=>View;doc:()=>Document;preferences:ReadingPreferences;selected:()=>string[];select:(ids:string[])=>void;tool:(name:string,anchor?:{start:number;end:number;quote:string})=>void;status:(s:string)=>void;message:(s:string,error?:boolean)=>void;accepted:(view:View)=>void;busy:()=>boolean;otherDraft:()=>boolean;listen:()=>void;projection:(unsupportedBase:boolean)=>void}
export class Transcript {
  private projection:Projection|null=null;private epoch=0;private selection:SelectionBasis|null=null;
  private draft:Draft|null=null;private composing=false;private settling=false;
  private menu=document.createElement('div');private details=document.createElement('div');
  private layout:'lines'|'paragraphs'='paragraphs';private interlinear=false;
  constructor(private surface:HTMLElement,private host:Host){
    this.surface.classList.add('prose');this.surface.tabIndex=0;
    this.menu.className='selection-tools';this.menu.hidden=true;this.menu.setAttribute('role','toolbar');this.menu.setAttribute('aria-label','Selection tools');
    this.details.className='change-popover';this.details.hidden=true;document.body.append(this.menu,this.details);
    this.menu.addEventListener('mousedown',e=>{if((e.target as HTMLElement).closest('button'))e.preventDefault()});
    this.surface.addEventListener('mouseup',()=>setTimeout(()=>this.capture(),0));
    this.surface.addEventListener('keyup',e=>{if(!this.draft&&e.key.startsWith('Arrow'))this.capture()});
    this.surface.addEventListener('click',e=>this.click(e));
    this.surface.addEventListener('keydown',e=>this.key(e));
    this.surface.addEventListener('paste',e=>{if((e.target as HTMLElement).closest('input'))return;if(this.selection){e.preventDefault();this.begin(e.clipboardData?.getData('text/plain')??'')}});
    this.surface.addEventListener('cut',e=>{if((e.target as HTMLElement).closest('input'))return;if(this.selection){e.preventDefault();e.clipboardData?.setData('text/plain',this.selection.quote);this.begin('')}});
    this.surface.addEventListener('copy',e=>this.copy(e));
    document.addEventListener('selectionchange',()=>{const s=window.getSelection();if(!this.draft&&s?.anchorNode&&this.surface.contains(s.anchorNode))setTimeout(()=>this.capture(),0)});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!this.composing&&!e.isComposing){this.menu.hidden=true;this.details.hidden=true}});
  }
  dirty(){return this.draft!==null}
  busy(){return this.draft!==null&&this.draft.phase!=='editing'&&this.draft.phase!=='conflict'}
  setLayout(layout:'lines'|'paragraphs'){this.layout=layout;this.surface.dataset.layout=layout;this.storePreferences()}
  setInterlinear(value:boolean){if(this.draft){(document.getElementById('show-interlinear') as HTMLInputElement).checked=this.interlinear;this.host.message('Finish or undo the correction draft before changing reading layers.',true);return}this.interlinear=value;void this.render();this.storePreferences()}
  private storePreferences(){try{localStorage.setItem('wb-reading:'+this.host.view().snapshot.project,JSON.stringify({layout:this.layout,interlinear:this.interlinear}))}catch{/* Preferences are optional. */}}
  async render(){
    if(this.draft)return;this.selection=null;this.projection=null;this.surface.inert=true;this.surface.textContent='Loading exact saved transcript…';const view=this.host.view(),doc=this.host.doc(),epoch=++this.epoch;
    this.menu.hidden=true;this.details.hidden=true;
    try{
      const p=await api<Projection>(`/api/reading?path=${encodeURIComponent(doc.path)}&revision=${view.revision.id}`);
      if(epoch!==this.epoch||this.draft||this.host.view().revision.snapshot_hash!==view.revision.snapshot_hash||this.host.doc().path!==doc.path)return;
      if(p.schema!==1||p.project!==view.snapshot.project||p.revision!==view.revision.id||p.snapshot_hash!==view.revision.snapshot_hash||p.document!==doc.path||p.artifact_hash!==view.snapshot.files[doc.path]?.sha256)throw new Error('Reading projection does not match the exact saved artifact');
      this.projection=p;this.surface.inert=false;this.host.projection(p.media_base_unsupported);
      try{const saved=JSON.parse(localStorage.getItem('wb-reading:'+view.snapshot.project)??'{}');if(saved.layout==='lines'||saved.layout==='paragraphs')this.layout=saved.layout;this.interlinear=saved.interlinear===true}catch{/* Ignore invalid preferences. */}
      this.surface.dataset.layout=this.layout;this.surface.dataset.interlinear=String(this.interlinear);this.surface.setAttribute('aria-label',`${doc.title}, ${this.host.preferences.layer} transcript`);
      (document.getElementById('transcript-layout') as HTMLSelectElement).value=this.layout;(document.getElementById('show-interlinear') as HTMLInputElement).checked=this.interlinear;
      let ordinal=0;const tokens=new Map(doc.tokens.map(t=>[t.id,t]));
      this.surface.innerHTML=p.blocks.map(block=>{
        const hasToken=block.runs.some(r=>r.token!==null);if(hasToken)ordinal++;
        const source=block.source_id??block.anchor_token;const segment=doc.segments.find(s=>s.id===block.source_id);
        return `<section class="reading-block utterance ${hasToken?'':'literal-block'}" ${segment?`data-utterance="${esc(segment.id)}"`:''} ${source?`data-location="${esc(source)}"`:''}><span class="source-number" aria-hidden="true" title="Display number ${ordinal}; source ${esc(source??'unanchored literal text')}">${hasToken?ordinal:''}</span><span class="reading-content">${block.runs.map(r=>{
          if(r.token===null)return `<span class="reading-text separator">${esc(r.text)}</span>`;
          const t=tokens.get(r.token);if(!t)throw new Error('Unknown token in reading projection');
          const shown=visibleToken(t,this.host.preferences);return `<span class="lexeme ${shown?'':'filtered'} ${this.host.selected().includes(t.id)?'selected':''}" ${shown?'data-token':'data-filtered-token'}="${esc(t.id)}" tabindex="-1" title="${esc(t.id)} · ${esc(t.language_effective??'Unknown language')}"><span class="reading-text">${esc(reading(t,this.host.preferences.layer))}</span>${this.interlinear?`<span class="interlinear" aria-hidden="true"><span>Raw ${esc(t.original)}</span><span>Normalized ${esc(t.normalized??'—')}${t.attrs.wb_normalized_status==='unresolved'?' · unresolved':''}</span><span>${esc(t.language_effective??'Unknown language')}</span></span>`:''}</span>`;
        }).join('')}</span></section>`;
      }).join('');
      const shown=doc.tokens.filter(t=>visibleToken(t,this.host.preferences));document.getElementById('token-count')!.textContent=`${shown.length} of ${doc.tokens.length} tokens · ${this.host.selected().length} selected`;
      (document.getElementById('next-match') as HTMLButtonElement).disabled=!shown.length;
      if(!shown.length)this.surface.insertAdjacentHTML('afterbegin','<p class="empty-state">No matching tokens. Clear the filter to return to the transcript.</p>');
      try{await this.markHistory(view,doc,epoch)}catch{if(epoch===this.epoch)this.host.message('Transcript loaded. Correction history decoration is unavailable; inspect History to retry.')}
    }catch(e){if(epoch===this.epoch&&!this.draft&&this.host.doc().path===doc.path&&this.host.view().revision.id===view.revision.id){this.surface.textContent='Could not load faithful transcript. Preserved XML remains available in Tools.';this.host.message(String(e),true)}}
  }
  private async markHistory(view:View,doc:Document,epoch:number){
    if(!view.revision.parent)return;
    const revisions=await api<Revision[]>('/api/history');const remaining=new Set(doc.tokens.filter(t=>t.corrected!==null).map(t=>t.id));
    for(const revision of revisions.filter(r=>r.id<=view.revision.id&&r.parent!==null).slice(0,64)){
      if(epoch!==this.epoch||this.draft||this.host.busy()||this.host.view().revision.id!==view.revision.id)return;
      const diff=await api<Diff>(`/api/diff?from=${revision.parent}&to=${revision.id}`);
      if(epoch!==this.epoch||this.draft||this.host.busy()||this.host.view().revision.id!==view.revision.id)return;
      for(const change of diff.changes.filter(c=>c.document===doc.path&&c.field==='nform'&&(remaining.has(c.target)||revision.id===view.revision.id))){
      remaining.delete(change.target);const token=doc.tokens.find(t=>t.id===change.target);if(!token||(token.corrected??token.original)!==(change.after??token.original))continue;
      const span=this.surface.querySelector<HTMLElement>(`[data-token="${CSS.escape(change.target)}"]`);if(!span)continue;
      span.classList.add('recorded-correction');span.tabIndex=0;span.setAttribute('aria-label',`${span.textContent}, recorded correction R${revision.id}. Press H for history.`);
      const show=()=>this.showHistory(span,change,view,revision);
      span.addEventListener('pointerenter',show);span.addEventListener('focus',show);span.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='h'){e.preventDefault();show()}});
      }
      if(!remaining.size)break;
    }
  }
  private showHistory(span:HTMLElement,change:Diff['changes'][number],view:View,record:Revision){
    if(this.draft||!this.menu.hidden||this.host.busy()||this.host.view().revision.id!==view.revision.id)return;
    const token=this.host.doc().tokens.find(t=>t.id===change.target)!;
    this.details.innerHTML=`<strong>Recorded correction · R${record.id}</strong><dl><dt>Previous corrected</dt><dd>${esc(change.before??token.original)}</dd><dt>Saved corrected</dt><dd>${esc(change.after??token.original)}</dd><dt>Immutable source</dt><dd>${esc(token.original)}</dd></dl><p>${esc(record.label)} · current R${view.revision.id} ${view.approved?'Reviewed':'Unreviewed'}</p><button data-history>Open full revision history</button><button data-close>Close</button>`;
    this.details.querySelector<HTMLButtonElement>('[data-history]')!.onclick=()=>{if(this.host.busy())return;this.details.hidden=true;this.host.tool('history')};this.details.querySelector<HTMLButtonElement>('[data-close]')!.onclick=()=>this.details.hidden=true;
    this.position(this.details,span.getBoundingClientRect());this.details.hidden=false;
  }
  private click(event:MouseEvent){
    if(this.draft||!this.currentProjection()||this.host.busy()||(event.target as HTMLElement).closest('input,button'))return;
    const s=window.getSelection();if(s&&!s.isCollapsed){this.capture();return}
    const span=(event.target as HTMLElement).closest<HTMLElement>('[data-token]');if(!span||span.classList.contains('filtered'))return;
    const id=span.dataset.token!,doc=this.host.doc();let ids=[id];
    if(event.ctrlKey||event.metaKey)ids=this.host.selected().includes(id)?this.host.selected().filter(t=>t!==id):[...this.host.selected(),id];
    else if(event.shiftKey&&this.host.selected().length){const all=doc.tokens.map(t=>t.id),a=all.indexOf(this.host.selected()[0]),b=all.indexOf(id);ids=all.slice(Math.min(a,b),Math.max(a,b)+1)}
    this.host.select(ids);if(!ids.length){this.selection=null;this.menu.hidden=true;this.paintSelection();return}
    const remaining=doc.tokens.find(t=>t.id===ids.at(-1))!,text=reading(remaining,this.host.preferences.layer);
    this.selection={view:this.host.view(),document:doc.path,ids,start:0,end:Array.from(text).length,quote:ids.length===1?text:'',layer:this.host.preferences.layer,range:null};
    this.paintSelection();this.showMenu((this.surface.querySelector<HTMLElement>(`[data-token="${CSS.escape(remaining.id)}"]`)??span).getBoundingClientRect());
  }
  private capture(){
    if(this.draft||!this.currentProjection()||this.host.busy())return;const s=window.getSelection();if(!s||s.isCollapsed||!s.rangeCount)return;
    const range=s.getRangeAt(0);const start=this.endpoint(range.startContainer,range.startOffset),end=this.endpoint(range.endContainer,range.endOffset);
    if(!start||!end){this.menu.hidden=true;this.selection=null;return}
    const doc=this.host.doc(),a=doc.tokens.findIndex(t=>t.id===start.id),b=doc.tokens.findIndex(t=>t.id===end.id);
    if(a<0||b<a)return;const ids=doc.tokens.slice(a,b+1).map(t=>t.id);
    if(ids.some(id=>!this.surface.querySelector(`[data-token="${CSS.escape(id)}"]`))){this.host.message('Clear token filters before editing this range.',true);this.selection=null;return}
    this.selection={view:this.host.view(),document:doc.path,ids,start:start.cp,end:end.cp,quote:this.primaryRangeText(range),layer:this.host.preferences.layer,range:range.cloneRange(),backward:s.anchorNode===range.endContainer&&s.anchorOffset===range.endOffset};
    this.host.select(ids);this.paintSelection();const rects=[...range.getClientRects()];if(rects.length)this.showMenu(rects.at(-1)!);
  }
  private endpoint(node:Node,offset:number):{id:string;cp:number}|null{
    if(node.nodeType!==Node.TEXT_NODE||!this.surface.contains(node))return null;
    const primary=node.parentElement;if(!primary?.classList.contains('reading-text'))return null;
    const span=primary.closest<HTMLElement>('[data-token]');if(!span)return null;
    const text=node.textContent??'';if(offset<0||offset>text.length)return null;
    if(offset>0&&offset<text.length&&/[\uD800-\uDBFF]/u.test(text[offset-1])&&/[\uDC00-\uDFFF]/u.test(text[offset]))return null;
    // Grapheme boundaries protect combining sequences and ZWJ clusters; native coordinates stay code points.
    const boundaries=new Set([0,text.length]);for(const part of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text))boundaries.add(part.index);
    if(!boundaries.has(offset))return null;
    return {id:span.dataset.token!,cp:Array.from(text.slice(0,offset)).length};
  }
  private primaryRangeText(range:Range){
    const fragment=range.cloneContents();fragment.querySelectorAll('.source-number,.interlinear,.draft-ghost,.draft-actions,.filtered').forEach(n=>n.remove());fragment.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.replaceWith(document.createTextNode(input.value)));return fragment.textContent??'';
  }
  private copy(event:ClipboardEvent){if((event.target as HTMLElement).closest('input'))return;const s=window.getSelection();if(s?.rangeCount&&this.surface.contains(s.anchorNode)&&this.surface.contains(s.focusNode)){event.preventDefault();event.clipboardData?.setData('text/plain',this.primaryRangeText(s.getRangeAt(0)))}}
  private paintSelection(){for(const span of this.surface.querySelectorAll<HTMLElement>('[data-token]'))span.classList.toggle('selected',this.host.selected().includes(span.dataset.token!))}
  private position(element:HTMLElement,rect:DOMRect){element.hidden=false;const height=element.getBoundingClientRect().height;const available=window.innerHeight-Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--recording-height'))-12;const top=rect.bottom+height+12<available?rect.bottom+10:Math.max(68,rect.top-height-10);element.style.left=Math.max(12,Math.min(rect.left,window.innerWidth-350))+'px';element.style.top=top+'px'}
  private showMenu(rect:DOMRect){
    if(!this.selection)return;this.details.hidden=true;const s=this.selection;
    this.menu.innerHTML=`<div class="tool-primary"><button data-action="correct">Correct</button><button data-action="language">Language</button><button data-action="annotations">Annotate</button><button data-action="structure">Tokenize</button></div><div class="tool-secondary"><button data-action="definitions">Definitions</button><button data-action="references">References</button><button data-action="listen">Listen · ${s.ids.every(id=>{const t=this.host.doc().tokens.find(t=>t.id===id);return !!t&&t.start_us!==null&&t.end_us!==null&&t.end_us>t.start_us})?'word':'utterance'}</button></div><small>${s.ids.length} token${s.ids.length===1?'':'s'} · ${esc(s.layer)} · R${s.view.revision.id}</small>`;
    this.menu.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(b=>{if(b.dataset.action==='correct'&&s.ids.length>1&&!s.range)b.disabled=true;if(['definitions','references'].includes(b.dataset.action!))b.setAttribute('aria-label',`${b.textContent} for selection`);b.onclick=()=>{if(b.dataset.action==='correct')this.begin(this.selection?.quote??'');else if(b.dataset.action==='listen')this.host.listen();else{this.menu.hidden=true;const token=this.host.doc().tokens.find(t=>t.id===s.ids[0]);const partial=b.dataset.action==='annotations'&&s.layer==='corrected'&&s.ids.length===1&&token&&(s.start>0||s.end<Array.from(token.corrected??token.original).length);this.host.tool(b.dataset.action==='language'?'token':b.dataset.action!,partial?{start:s.start,end:s.end,quote:s.quote}:undefined);if(b.dataset.action==='language'&&s.ids.length>1)this.host.message('Language properties currently edit the first selected token; other selected identities remain unchanged.')}}});
    this.position(this.menu,rect);this.menu.hidden=false;
  }
  private key(event:KeyboardEvent){
    if((event.target as HTMLElement).closest('input,button')||this.composing||event.isComposing||this.host.busy())return;
    const focused=(event.target as HTMLElement).closest<HTMLElement>('[data-token]');
    if(focused&&!event.shiftKey&&window.getSelection()?.isCollapsed&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const spans=[...this.surface.querySelectorAll<HTMLElement>('[data-token]')],index=spans.indexOf(focused),next=spans[(index+(event.key==='ArrowRight'?1:spans.length-1))%spans.length];next.tabIndex=-1;next.focus();return}
    if(focused&&event.code==='Space'&&window.getSelection()?.isCollapsed){event.preventDefault();focused.dispatchEvent(new MouseEvent('click',{bubbles:true}));return}
    if((event.shiftKey&&event.key==='F10')||event.key==='ContextMenu'){event.preventDefault();this.capture();if(this.selection){const span=this.surface.querySelector<HTMLElement>(`[data-token="${CSS.escape(this.selection.ids[0])}"]`);if(span)this.showMenu(span.getBoundingClientRect());this.menu.querySelector('button')?.focus()}return}
    if(this.selection&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&(event.key==='Backspace'||event.key==='Delete'||Array.from(event.key).length===1)){event.preventDefault();this.begin(event.key==='Backspace'||event.key==='Delete'?'':event.key)}
  }
  private begin(replacement:string){
    if(this.draft||!this.currentProjection()||!this.selection||this.host.busy())return;
    if(this.host.otherDraft()){this.host.message('Save or discard the existing properties draft before correcting in place.',true);return}
    if(this.selection.ids.length>1&&!this.selection.range){this.host.message('Select a native text range for a correction preview; separate token selections remain available to annotation and structural tools.',true);return}
    const basis=this.selection;if(basis.layer!=='corrected'||this.host.preferences.layer!=='corrected'||basis.document!==this.host.doc().path||basis.view.revision.snapshot_hash!==this.host.view().revision.snapshot_hash||(basis.range&&!basis.range.startContainer.isConnected)){this.host.message('Select corrected text in the current saved revision.',true);return}
    const token=this.host.doc().tokens.find(t=>t.id===basis.ids[0])!;if(!token.editable){this.host.message('Nested token is preserved read-only.',true);return}
    const before=token.corrected??token.original,chars=Array.from(before);
    this.draft={basis,before,prefix:chars.slice(0,basis.start).join(''),suffix:basis.ids.length===1?chars.slice(basis.end).join(''):'',replacement,command:null,phase:'editing',latest:null,compared:false};
    this.menu.hidden=true;this.details.hidden=true;this.drawDraft();
  }
  private drawDraft(){
    const d=this.draft!;const span=this.surface.querySelector<HTMLElement>(`[data-token="${CSS.escape(d.basis.ids[0])}"]`)!;
    span.innerHTML=`<span class="draft-prefix reading-text">${esc(d.prefix)}</span><s class="draft-ghost" aria-hidden="true">${esc(d.basis.quote)}</s><input id="inline-replacement" aria-label="Proposed correction" autocomplete="off" spellcheck="false" value="${esc(d.replacement)}"><span class="draft-suffix reading-text">${esc(d.suffix)}</span><span class="draft-actions"><button id="undo-draft" type="button">Undo draft</button><button id="accept-draft" type="button">Accept ↵</button><button id="retry-draft" type="button" hidden>Resolve save outcome</button><button id="compare-draft" type="button" hidden>Compare current revision</button><button id="reapply-draft" type="button" hidden>Reapply after comparison</button><small id="draft-explanation" role="status"></small><pre id="draft-comparison" hidden></pre></span>`;
    const input=span.querySelector<HTMLInputElement>('input')!;
    input.oninput=()=>{if(d.phase!=='editing'&&d.phase!=='conflict')return;d.replacement=input.value;d.compared=false;d.epoch=(d.epoch??0)+1;this.updateDraft()};
    input.addEventListener('compositionstart',()=>{this.composing=true;this.updateDraft()});input.addEventListener('compositionend',()=>{this.composing=false;this.settling=true;this.updateDraft();setTimeout(()=>{this.settling=false;this.updateDraft()},0)});
    input.onkeydown=e=>{if(e.key==='Enter'){if(e.isComposing||this.composing||e.keyCode===229)return;e.preventDefault();e.stopPropagation();if(!this.settling&&!e.shiftKey)void this.accept()}else if(e.key==='Escape'&&!e.isComposing&&!this.composing){e.stopPropagation();this.menu.hidden=true}};
    span.querySelector<HTMLButtonElement>('#undo-draft')!.onclick=async()=>{if(this.busy())return;this.draft=null;this.selection=null;await this.render();const first=this.surface.querySelector(`[data-token="${CSS.escape(d.basis.ids[0])}"] .reading-text`)?.firstChild,last=this.surface.querySelector(`[data-token="${CSS.escape(d.basis.ids.at(-1)!)}"] .reading-text`)?.firstChild;if(first&&last){const a=Array.from(first.textContent??'').slice(0,d.basis.start).join('').length,b=Array.from(last.textContent??'').slice(0,d.basis.end).join('').length;this.surface.focus();window.getSelection()?.setBaseAndExtent(d.basis.backward?last:first,d.basis.backward?b:a,d.basis.backward?first:last,d.basis.backward?a:b)}this.host.status(`Saved R${this.host.view().revision.id} · ${this.host.view().approved?'Approved exact revision':'Unreviewed'}`)};
    span.querySelector<HTMLButtonElement>('#accept-draft')!.onclick=()=>void this.accept();span.querySelector<HTMLButtonElement>('#retry-draft')!.onclick=()=>void this.accept(true);
    span.querySelector<HTMLButtonElement>('#compare-draft')!.onclick=async()=>{const proposed=d.replacement,epoch=d.epoch;try{const latest=await loadView(),diff=await api<Diff>(`/api/diff?from=${d.basis.view.revision.id}&to=${latest.revision.id}`);if(this.draft!==d||d.replacement!==proposed||epoch!==d.epoch||this.composing)return;d.latest=latest;d.compared=true;const pre=span.querySelector<HTMLElement>('#draft-comparison')!;pre.hidden=false;pre.textContent=JSON.stringify(diff,null,2);this.updateDraft()}catch(e){this.host.message(String(e),true)}};
    span.querySelector<HTMLButtonElement>('#reapply-draft')!.onclick=()=>{if(!d.compared||!d.latest)return;const latestToken=d.latest.documents.find(doc=>doc.path===d.basis.document)?.tokens.find(t=>t.id===d.basis.ids[0]);if(!latestToken?.editable){this.host.message('Target no longer supports correction. Undo the draft and inspect the new structure.',true);return}d.basis={...d.basis,view:d.latest};d.phase='editing';d.command=null;void this.accept()};
    this.updateDraft();input.focus();input.select();
  }
  private reason(){const d=this.draft!;const proposed=d.prefix+d.replacement+d.suffix;if(d.basis.ids.length!==1)return 'Range replacement needs an explicit token mapping. Use Tokenize after undoing this draft.';if(!proposed)return 'Token deletion needs a supported mapping; this remains a draft.';if(/\s/u.test(proposed))return 'Multiple replacement tokens need a supported mapping; Accept is unavailable.';if(proposed===d.before)return 'No corrected reading change.';return ''}
  private updateDraft(){
    if(!this.draft)return;const d=this.draft,input=this.surface.querySelector<HTMLInputElement>('#inline-replacement')!;input.style.width=Math.max(2,Math.min(24,Array.from(input.value).length+1))+'ch';
    const busy=d.phase==='saving'||d.phase==='unknown';input.disabled=busy;
    const accept=this.surface.querySelector<HTMLButtonElement>('#accept-draft')!;accept.disabled=busy||d.phase==='conflict'||this.composing||this.settling||!!this.reason();
    this.surface.querySelector<HTMLButtonElement>('#undo-draft')!.disabled=busy;
    this.surface.querySelector<HTMLButtonElement>('#retry-draft')!.hidden=d.phase!=='unknown';this.surface.querySelector<HTMLButtonElement>('#compare-draft')!.hidden=d.phase!=='conflict';this.surface.querySelector<HTMLButtonElement>('#reapply-draft')!.hidden=d.phase!=='conflict'||!d.compared;
    this.surface.querySelector<HTMLElement>('#draft-explanation')!.textContent=d.phase==='unknown'?'Save outcome unknown. Resolve the original command before editing.':d.phase==='conflict'?'Saved head changed. Compare before explicitly reapplying.':this.reason()||'Not saved · one token correction';
    this.host.status(`${d.phase==='saving'?'Saving':d.phase==='unknown'?'Save outcome unknown':'Draft'} · saved R${d.basis.view.revision.id}`);
  }
  private async accept(retry=false){
    const d=this.draft;if(!d||this.composing||this.settling||this.host.busy()||d.phase==='saving')return;
    if(this.host.otherDraft()){this.host.message('Save or discard the properties draft before accepting this correction. Both drafts remain here.',true);return}
    if(!retry&&(this.reason()||d.phase==='conflict'||d.phase==='unknown'))return;
    if(!d.command)d.command=makeCommand(d.basis.view,[{kind:'set_token',document:d.basis.document,token:d.basis.ids[0],fields:{nform:d.prefix+d.replacement+d.suffix}}],`Correct ${d.basis.ids[0]} in place`);
    if(!d.unlock){const controls=[...document.querySelectorAll<HTMLInputElement>('button,input,select,textarea')].filter(e=>!this.surface.contains(e)).map(e=>[e,e.disabled] as const);controls.forEach(([e])=>e.disabled=true);d.unlock=()=>controls.forEach(([e,disabled])=>e.disabled=disabled)}
    d.phase='saving';this.updateDraft();let confirmed:Revision|null=null;
    try{confirmed=await commit(d.command);const latest=await loadView();if(latest.revision.id<confirmed.id)throw new Error('Committed revision has not been reconciled');d.unlock?.();this.draft=null;this.selection=null;this.host.accepted(latest);this.host.message(`Correction saved in R${confirmed.id}. Current head R${latest.revision.id} · ${latest.approved?'Reviewed':'Unreviewed'}.`)}
    catch(e){if(!confirmed&&e instanceof ApiError&&e.status===409){d.phase='conflict';d.command=null}else if(!confirmed&&e instanceof ApiError&&e.status>=400&&e.status<500){d.phase='editing';d.command=null}else d.phase='unknown';if(d.phase!=='unknown'){d.unlock?.();d.unlock=undefined}this.host.message(confirmed?`Committed R${confirmed.id}; view refresh pending. Resolve the same command. ${String(e)}`:String(e),true);this.updateDraft()}
  }
  location(id:string){const block=this.projection?.blocks.find(b=>b.source_id===id||b.anchor_token===id||b.sections.some(s=>s.id===id)||b.runs.some(r=>r.token===id));if(!block)return false;const target=this.surface.querySelector<HTMLElement>(`[data-location="${CSS.escape(block.source_id??block.anchor_token??'')}"]`);target?.scrollIntoView({block:'center'});if(target){target.tabIndex=-1;target.focus();document.getElementById('source-location-status')!.textContent=`${this.host.doc().title} · ${block.sections.map(s=>`${s.kind} ${s.number??s.id}`).join(' / ')} ${block.source_id??block.anchor_token??id} · R${this.host.view().revision.id} · source reference`}return !!target}
  private currentProjection(){const p=this.projection,v=this.host.view();return !!p&&!this.surface.inert&&p.document===this.host.doc().path&&p.project===v.snapshot.project&&p.revision===v.revision.id&&p.snapshot_hash===v.revision.snapshot_hash&&p.artifact_hash===v.snapshot.files[p.document]?.sha256}
  citation(){const s=this.selection,view=this.host.view();const ids=s?.ids??this.host.selected();return {project:view.snapshot.project,revision:view.revision.id,document:this.host.doc().path,anchor:ids[0]??this.projection?.blocks.find(b=>b.anchor_token)?.anchor_token,end:ids.at(-1)}}
}
