import {h, renderInto} from './effect-view';
import type {Document, Span} from './contracts';
import {annotationDetail} from './annotation-detail';
import {icon} from './icons';
import './annotation-marks.css';

type Detail = ReturnType<typeof annotationDetail>;
type Mark = {number:number; span:Span; detail:Detail; ranges:Range[]; indices:number[]};
type Group = {marks:Mark[]; button:HTMLButtonElement; y:number};
type Frame = {left:number; right:number; top:number; bottom:number};
const highlighted = 'saved-annotations';

/** Source ranges stay outside native text selection and never wrap or split a token's text node. */
export class AnnotationMarks {
  private overlay = document.createElement('span');
  private lines = document.createElement('span');
  private card = document.createElement('section');
  private marks:Mark[] = [];
  private groups:Group[] = [];
  private atWord=new WeakMap<Element,{mark:Mark;range:Range}[]>();
  private open:Mark|null = null;
  private preview:Mark|null = null;
  private observer:ResizeObserver;
  private events?:AbortController;
  private frame = 0;
  private highlighted: Highlight | undefined;
  private activeHighlight: Highlight | undefined;
  private bright:HTMLElement[]=[];
  constructor(private surface:HTMLElement, private pane:HTMLElement,
    private position:(card:HTMLElement,anchor:DOMRect)=>void, private inspect:(span:Span)=>void) {
    this.overlay.className='saved-mark-overlay';
    this.lines.className='saved-mark-frames';
    this.lines.setAttribute('aria-hidden','true');
    this.card.className='saved-annotation-detail';
    this.card.hidden=true;
    this.card.id='saved-annotation-detail';
    this.card.setAttribute('role','dialog');
    this.card.setAttribute('aria-labelledby','saved-mark-title');
    renderInto(this.card,
      h.header
      .class('saved-detail-header')
      .children(
        h.span.attrs({'data-kind': ''}),
        h.button
          .attrs({type: 'button', 'aria-label': 'Close annotation detail', 'data-close': ''})
          .children(icon('close')),
      ),
      h.div
      .class('saved-detail-body')
      .attrs({role: 'region', 'aria-label': 'Annotation text'})
      .children(
        h.h3.id('saved-mark-title'),
        h.blockquote.attrs({dir: 'auto'}),
        h.p.class('saved-mark-note').attrs({dir: 'auto'}),
        h.small.class('saved-mark-source'),
      ),
      h.footer(
        h.button
          .attrs({type: 'button', 'data-inspect': ''})
          .children('Open in annotations ', icon('chevron_right')),
        h.span
          .class('saved-mark-switch')
          .children(
            h.button
              .attrs({type: 'button', 'aria-label': 'Previous annotation here', 'data-prev': ''})
              .children(icon('chevron_right')),
            h.small.class('saved-mark-index'),
            h.button
              .attrs({type: 'button', 'aria-label': 'Next annotation here', 'data-next': ''})
              .children(icon('chevron_right')),
          ),
      ),
    );
    this.card.querySelector<HTMLButtonElement>('[data-close]')!.onclick=()=>this.close(true);
    this.card.querySelector<HTMLButtonElement>('[data-inspect]')!.onclick=()=>{
      const span=this.open?.span;
      if(span){this.close(false);this.inspect(span)}
    };
    for(const [action,dir] of [['prev',-1],['next',1]] as const){
      this.card.querySelector<HTMLButtonElement>(`[data-${action}]`)!.onclick=()=>{
        const group=this.groupFor(this.open);
        if(!group || !this.open)return;
        const index=group.marks.indexOf(this.open);
        this.show(group.marks[(index+dir+group.marks.length)%group.marks.length],false);
      };
    }
    this.observer=new ResizeObserver(()=>this.schedule());
  }
  clear() {
    this.events?.abort();this.observer.disconnect();cancelAnimationFrame(this.frame);this.frame=0;
    if(this.highlighted && CSS.highlights?.get(highlighted)===this.highlighted)CSS.highlights.delete(highlighted);
    this.highlighted=undefined;this.clearEmphasis();
    this.open=null;this.preview=null;this.marks=[];this.groups=[];this.atWord=new WeakMap();
    this.overlay.remove();this.overlay.replaceChildren();this.lines.replaceChildren();
    this.surface.removeAttribute('data-mark-gutter');
    this.card.hidden=true;this.card.remove();
    this.surface.querySelectorAll('.has-saved-mark').forEach(block=>block.classList.remove('has-saved-mark'));
  }
  render(doc:Document,project:string) {
    this.clear();
    if(!doc.spans.length)return;
    const words=new Map<string,{text:Text;index:number}>();
    this.surface.querySelectorAll<HTMLElement>('.lexeme').forEach((word,index)=>{
      const text=word.querySelector('.reading-text')?.firstChild;
      if(word.dataset.token && !word.classList.contains('filtered') && text instanceof Text)words.set(word.dataset.token,{text,index});
    });
    const corrected=new Map(doc.tokens.map(token=>[token.id,token.corrected??token.original]));
    doc.spans.forEach((span,index)=>{
      const detail=annotationDetail(doc,span,project);
      if(!detail.tokenIds.length)return;
      const ranges:Range[]=[],indices:number[]=[];
      for(const id of detail.tokenIds){
        const word=words.get(id);
        if(!word || word.text.data!==corrected.get(id))return;
        const range=document.createRange();
        const part=detail.character;
        if(part){
          const chars=Array.from(word.text.data);
          if(id!==part.token || chars.slice(part.start,part.end).join('')!==part.quote)return;
          range.setStart(word.text,chars.slice(0,part.start).join('').length);
          range.setEnd(word.text,chars.slice(0,part.end).join('').length);
        }else range.selectNodeContents(word.text);
        ranges.push(range);indices.push(word.index);
      }
      ranges[0].startContainer.parentElement!.closest('.reading-block')!.classList.add('has-saved-mark');
      const mark={number:index+1,span,detail,ranges,indices};
      this.marks.push(mark);
      for(const range of ranges){
        const text=range.startContainer.parentElement!;
        const entries=this.atWord.get(text)??[];
        entries.push({mark,range});this.atWord.set(text,entries);
      }
    });
    if(!this.marks.length)return;
    if(typeof Highlight!=='undefined' && CSS.highlights){
      this.highlighted=new Highlight();
      for(const mark of this.marks)for(const range of mark.ranges)this.highlighted.add(range);
      CSS.highlights.set(highlighted,this.highlighted);
    }
    this.surface.append(this.overlay);this.overlay.append(this.lines);
    document.getElementById('passage-tools-layer')!.append(this.card);
    const events=this.events=new AbortController();
    this.pane.addEventListener('scroll',()=>this.positionCard(),{passive:true,signal:events.signal});
    document.addEventListener('pointerdown',e=>{
      if(e.target instanceof Node && !this.card.contains(e.target) && !this.overlay.contains(e.target))this.close(false);
    },{capture:true,signal:events.signal});
    document.addEventListener('focusin',e=>{
      if(e.target instanceof Node && !this.card.contains(e.target) && !this.overlay.contains(e.target))this.close(false);
    },{signal:events.signal});
    this.surface.addEventListener('pointermove',e=>{
      if(this.open || e.pointerType!=='mouse' || this.overlay.contains(e.target as Node))return;
      const text=e.target instanceof Element?e.target.closest('.reading-text'):null;
      const hit=!e.buttons && text && this.atWord.get(text)?.find(({range})=>
        [...range.getClientRects()].some(r=>e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom));
      const next=hit?hit.mark:null;
      if(next!==this.preview){this.preview=next;this.paint()}
    },{passive:true,signal:events.signal});
    this.surface.addEventListener('pointerleave',()=>{if(!this.open && this.preview){this.preview=null;this.paint()}},{signal:events.signal});
    this.observer.observe(this.surface);this.observer.observe(this.pane);
    this.layout();
  }
  private schedule() {
    if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.layout()});
  }
  private groupFor(mark:Mark|null){return mark ? this.groups.find(group=>group.marks.includes(mark)) : undefined}
  private makeButton(){
    const button=document.createElement('button');
    button.type='button';button.className='saved-annotation-pin';
    button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls',this.card.id);
    const group:Group={button,marks:[],y:0};
    button.onpointerenter=()=>{if(!this.open){this.preview=group.marks[0];this.paint()}};
    button.onpointerleave=()=>{if(!this.open && document.activeElement!==button){this.preview=null;this.paint()}};
    button.onfocus=()=>{if(!this.open){this.preview=group.marks[0];this.paint()}};
    button.onblur=()=>{if(!this.open){this.preview=null;this.paint()}};
    button.onmousedown=e=>{if(e.button===0)e.preventDefault()};
    button.onclick=()=>{if(this.open && group.marks.includes(this.open))this.close(true);else this.show(group.marks[0],true)};
    this.overlay.append(button);return group;
  }
  private layout(){
    if(!this.overlay.isConnected)return;
    const origin=this.overlay.getBoundingClientRect(),pane=this.pane.getBoundingClientRect();
    const style=getComputedStyle(this.overlay),size=parseFloat(style.getPropertyValue('--mark-target'))||28;
    const paneLeft=pane.left+this.pane.clientLeft;
    const margin=style.direction==='rtl'?origin.left-paneLeft:paneLeft+this.pane.clientWidth-origin.right;
    this.surface.toggleAttribute('data-mark-gutter',margin<size+8);
    // Cluster targets by rendered line, so adjacent notes never cover each other's controls after a reflow.
    const positions=this.marks.map(mark=>({mark,rect:mark.ranges[0].getClientRects()[0]}))
      .filter(({rect})=>rect && rect.height).sort((a,b)=>a.rect.top-b.rect.top || a.mark.number-b.mark.number);
    let n=0;
    for(const {mark,rect} of positions){
      const y=rect.top+rect.height/2-origin.top;
      let group=this.groups[n-1];
      if(!group || y-group.y>=size){
        group=this.groups[n]??this.makeButton();group.marks=[];group.y=y;this.groups[n++]=group;
      }
      group.marks.push(mark);
    }
    for(const group of this.groups.splice(n))group.button.remove();
    for(const {button,marks,y} of this.groups){
      const first=marks[0];
      button.style.top=(y-size/2)+'px';
      button.dataset.mark=String(first.number);
      button.dataset.group=String(marks.length);
      const label=marks.length===1?`Annotation ${first.number}, ${first.detail.title}`:`${marks.length} annotations here, starting with ${first.detail.title}`;
      button.setAttribute('aria-label',label);button.title=label;
      button.setAttribute('aria-expanded',String(!!this.open && marks.includes(this.open)));
    }
    this.paint();this.positionCard();
  }
  private clearEmphasis(){
    if(this.activeHighlight && CSS.highlights?.get('active-saved-annotation')===this.activeHighlight)CSS.highlights.delete('active-saved-annotation');
    this.activeHighlight=undefined;
    for(const text of this.bright)text.classList.remove('saved-mark-ink','saved-mark-partial');
    this.bright=[];
  }
  private paint(){
    this.clearEmphasis();this.lines.replaceChildren();
    const mark=this.open??this.preview,group=this.groupFor(mark);
    for(const item of this.groups){
      const active=item===group;
      item.button.toggleAttribute('data-active',active);
      item.button.dataset.mark=String(active && mark?mark.number:item.marks[0].number);
    }
    if(!mark||!group)return;
    if(mark.detail.character && this.highlighted){
      this.activeHighlight=new Highlight(mark.ranges[0]);this.activeHighlight.priority=1;
      CSS.highlights.set('active-saved-annotation',this.activeHighlight);
    }
    const frames:Frame[]=[];
    let previous=-2;
    for(const [index,range] of mark.ranges.entries()){
      const text=range.startContainer.parentElement!;
      text.classList.add('saved-mark-ink');
      text.classList.toggle('saved-mark-partial',!!this.activeHighlight);
      this.bright.push(text);
      for(const r of range.getClientRects()){
        if(!r.width||!r.height)continue;
        const last=frames.at(-1);
        // A skipped source word must leave a break even when two ranges share a line.
        if(last && Math.abs(r.top-last.top)<1 && mark.indices[index]===previous+1 && r.left>=last.right-1 && r.left-last.right<=r.height){
          last.right=r.right;last.bottom=Math.max(last.bottom,r.bottom);
        }else frames.push({left:r.left,right:r.right,top:r.top,bottom:r.bottom});
      }
      previous=mark.indices[index];
    }
    const origin=this.overlay.getBoundingClientRect();
    for(const f of frames){
      const box=document.createElement('i');box.className='saved-span-frame';
      Object.assign(box.style,{left:(f.left-origin.left-1)+'px',top:(f.top-origin.top-1)+'px',width:(f.right-f.left+2)+'px',height:(f.bottom-f.top+2)+'px'});
      this.lines.append(box);
    }
    if(!frames.length)return;
    const first=frames.reduce((nearest,f)=>Math.abs(f.top-frames[0].top)<1 && f.right>nearest.right?f:nearest,frames[0]);
    const pin=group.button.getBoundingClientRect();
    const x=first.right-origin.left, y=first.bottom-origin.top+1;
    const dx=pin.left+pin.width/2-origin.left-x,dy=pin.top+pin.height/2-origin.top-y;
    const line=document.createElement('i');line.className='saved-span-tether';
    Object.assign(line.style,{left:x+'px',top:y+'px',width:Math.hypot(dx,dy)+'px',transform:`rotate(${Math.atan2(dy,dx)}rad)`});
    this.lines.prepend(line);
  }
  private show(mark:Mark,focus:boolean){
    const group=this.groupFor(mark);
    if(!group)return;
    this.open=mark;this.preview=null;
    const {detail}=mark;
    this.card.querySelector('[data-kind]')!.textContent=`${mark.number} · ${detail.kind}`;
    this.card.querySelector('h3')!.textContent=detail.title;
    this.card.querySelector('blockquote')!.textContent=detail.quote;
    const note=this.card.querySelector<HTMLElement>('.saved-mark-note')!;
    note.textContent=detail.note;note.hidden=!detail.note;
    this.card.querySelector('.saved-mark-source')!.textContent=detail.source;
    this.card.querySelector<HTMLElement>('.saved-detail-body')!.scrollTop=0;
    this.card.hidden=false;
    for(const item of this.groups)item.button.setAttribute('aria-expanded',String(item===group));
    this.paint();this.positionCard();
    if(focus && !this.card.hidden)this.card.querySelector<HTMLButtonElement>('[data-close]')!.focus({preventScroll:true});
  }
  private positionCard(){
    if(!this.open)return;
    const group=this.groupFor(this.open),rect=group?.button.getBoundingClientRect(),pane=this.pane.getBoundingClientRect();
    if(!group || !rect || rect.bottom<=pane.top || rect.top>=pane.bottom){this.close(false);return}
    this.card.querySelector<HTMLElement>('.saved-mark-switch')!.hidden=group.marks.length<2;
    this.card.querySelector('.saved-mark-index')!.textContent=`${group.marks.indexOf(this.open)+1} / ${group.marks.length}`;
    this.position(this.card,rect);
    const body=this.card.querySelector<HTMLElement>('.saved-detail-body')!;
    body.tabIndex=body.scrollHeight>body.clientHeight+1?0:-1;
  }
  close(focus:boolean){
    if(!this.open && !this.preview)return false;
    const wasOpen=!!this.open,button=this.groupFor(this.open)?.button;
    this.open=null;this.preview=null;this.card.hidden=true;
    button?.setAttribute('aria-expanded','false');
    if(focus)button?.focus({preventScroll:true});
    this.paint();return wasOpen;
  }
  reveal(span:Span){
    const mark=this.marks.find(m=>m.span===span || (m.span.id===span.id && m.span.sidecar===span.sidecar));
    if(!mark)return false;
    this.layout();
    const group=this.groupFor(mark);
    if(!group)return false;
    group.button.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    this.show(mark,true);return !this.card.hidden;
  }
}
