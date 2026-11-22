interface Caret {node:Text; offset:number}
interface Press {id:number; x:number; y:number; anchor:Caret; moved:boolean}
const graphemes = new Intl.Segmenter(undefined,{granularity:'grapheme'});

function wordAt(element:Element|null) {
  return element?.closest<HTMLElement>('.lexeme[data-token] > .reading-text') ?? null;
}

function mouseCaret(x:number,y:number,surface:HTMLElement):Caret|null {
  const word=wordAt(document.elementFromPoint(x,y));
  const caret=document.caretPositionFromPoint?.(x,y);
  if(caret?.offsetNode instanceof Text && surface.contains(caret.offsetNode)) {
    const node=caret.offsetNode;
    if(wordAt(node.parentElement) && (!word || word.contains(node)))return {node,offset:caret.offset};
    // Literal whitespace is a separate source run. Use its adjacent word edge
    // without counting the space itself as a word.
    const separator=node.parentElement;
    if(!word && separator?.matches('.reading-text.separator')){
      const previous=wordAt(separator.previousElementSibling?.querySelector('.reading-text') ?? null)?.firstChild;
      const next=wordAt(separator.nextElementSibling?.querySelector('.reading-text') ?? null)?.firstChild;
      if(previous instanceof Text && (caret.offset===0 || !(next instanceof Text)))return {node:previous,offset:previous.length};
      if(next instanceof Text)return {node:next,offset:0};
    }
  }
  // A focusable inline or a wrapped line can yield an ancestor caret outside
  // the word actually under the mouse. Measure this word's graphemes only.
  const node=word?.firstChild;
  if(!(node instanceof Text) || !surface.contains(node))return null;
  const range=document.createRange();
  let nearest:Caret={node,offset:0},best=Infinity;
  for(const {index,segment} of graphemes.segment(node.data)){
    for(const offset of [index,index+segment.length]){
      range.setStart(node,offset);range.collapse(true);
      const box=range.getBoundingClientRect();
      const gap=Math.max(box.top-y,y-box.bottom,0);
      const distance=Math.hypot(box.left-x,gap);
      if(distance<best){best=distance;nearest={node,offset}}
    }
  }
  return nearest;
}

/** Chromium treats pressing inside an existing selection as a native data
 * drag. Anchor ordinary mouse drags in the text instead, leaving double-click,
 * the held lens gesture, touch selection and keyboard ranges available. */
export class TranscriptDrag {
  private press:Press|null=null;
  private point={x:0,y:0};
  private scrollFrame=0;
  private skipClick=false;
  get active(){return this.press!==null}

  constructor(private surface:HTMLElement,private pane:HTMLElement,
    private available:()=>boolean,private hideTools:()=>void,private commit:()=>void) {
    surface.addEventListener('pointerdown',event=>{
      this.cancel();
      this.skipClick=false;
      if(event.defaultPrevented||event.pointerType!=='mouse'||!event.isPrimary||event.button!==0||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey||!this.available())return;
      if(!(event.target instanceof Element) || !wordAt(event.target))return;
      const anchor=mouseCaret(event.clientX,event.clientY,this.surface);
      if(!anchor)return;
      this.hideTools();
      this.press={id:event.pointerId,x:event.clientX,y:event.clientY,anchor,moved:false};
    });
    surface.addEventListener('mousedown',event=>{
      if(!this.press)return;
      if(event.detail>1){this.cancel();return}
      event.preventDefault();
      surface.focus({preventScroll:true});
      const {node,offset}=this.press.anchor;
      window.getSelection()?.collapse(node,offset);
    });
    window.addEventListener('pointermove',event=>{
      const press=this.press;
      if(!press || event.pointerId!==press.id)return;
      if(!event.buttons || !this.available()){this.cancel();return}
      if(!press.moved && Math.hypot(event.clientX-press.x,event.clientY-press.y)<3)return;
      press.moved=true;
      this.point={x:event.clientX,y:event.clientY};
      this.extend();
      if(!this.scrollFrame)this.scrollFrame=requestAnimationFrame(()=>this.scroll());
    });
    window.addEventListener('pointerup',event=>{
      const press=this.press;
      if(!press || event.pointerId!==press.id)return;
      const moved=press.moved && this.available();
      if(moved){this.point={x:event.clientX,y:event.clientY};this.extend()}
      this.cancel();
      if(moved){this.skipClick=true;this.commit()}
    });
    surface.addEventListener('click',event=>{
      if(this.skipClick && event.detail>0){this.skipClick=false;event.stopImmediatePropagation()}
    });
    window.addEventListener('pointercancel',event=>{if(this.press?.id===event.pointerId)this.cancel()});
    window.addEventListener('blur',()=>this.cancel());
  }

  cancel(){
    this.press=null;
    cancelAnimationFrame(this.scrollFrame);this.scrollFrame=0;
  }
  private extend(){
    if(!this.press)return;
    const rect=this.pane.getBoundingClientRect();
    const y=Math.max(rect.top+1,Math.min(this.point.y,rect.bottom-1));
    const focus=mouseCaret(this.point.x,y,this.surface);
    const {anchor}=this.press;
    if(!focus||!anchor.node.isConnected)return;
    const selection=window.getSelection();
    if(selection && (selection.anchorNode!==anchor.node||selection.anchorOffset!==anchor.offset||selection.focusNode!==focus.node||selection.focusOffset!==focus.offset))
      selection.setBaseAndExtent(anchor.node,anchor.offset,focus.node,focus.offset);
  }
  private scroll(){
    this.scrollFrame=0;
    if(!this.press?.moved)return;
    const {top,bottom}=this.pane.getBoundingClientRect(),y=this.point.y;
    const delta=y<top+22 ? y-top-22 : y>bottom-22 ? y-bottom+22 : 0;
    if(!delta)return;
    const previous=this.pane.scrollTop;
    this.pane.scrollTop+=Math.sign(delta)*Math.min(20,Math.ceil(Math.abs(delta)/3));
    if(this.pane.scrollTop!==previous){
      this.extend();
      this.scrollFrame=requestAnimationFrame(()=>this.scroll());
    }
  }
}
