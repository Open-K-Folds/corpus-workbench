import {h, renderInto} from './effect-view';
import './training-gesture.css';

export type TrainingLens = 'meaning' | 'wording' | 'contrast' | 'label';
export interface TrainingPassage {
  valid(): boolean;
  activate(): void;
  restore(): void;
  choose(lens: TrainingLens, limit: number): void;
}

const lenses = [
  ['meaning', 'Meaning'], ['wording', 'Wording'], ['contrast', 'Contrast'], ['label', 'Label'],
] as const;
const reachLevels = [3, 6, 12] as const;
const holdMs = 460;
const repeatHoldMs = 360;
type Point = {x:number; y:number};

export class TrainingGesture {
  private first: {token:string; point:Point; when:number; passage:TrainingPassage} | null = null;
  private stopPress: (() => void) | undefined;
  private chooser: HTMLDialogElement | undefined;
  private suppressUntil = 0;
  private held = false;
  get blocksSelection() {return this.held || performance.now() < this.suppressUntil}

  constructor(private surface:HTMLElement, private pin:(token:string)=>TrainingPassage | null) {
    surface.addEventListener('pointerdown', event => this.down(event), {capture:true});
    surface.addEventListener('dragstart', event => {if(this.held) event.preventDefault()});
  }

  cancel() {
    this.first = null;
    this.stopPress?.();
    this.chooser?.close();
  }

  private down(event:PointerEvent) {
    if (!event.isPrimary || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      this.cancel();return;
    }
    this.suppressUntil = 0;
    const target = event.target;
    const word = target instanceof Element ? target.closest<HTMLElement>('.reading-text') : null;
    const token = word?.closest<HTMLElement>('[data-token]')?.dataset.token;
    const point = {x:event.clientX,y:event.clientY};
    const first = this.first;
    this.cancel();
    if (!token || !word) return;
    const again = first && first.token === token && performance.now()-first.when <= 500 && Math.hypot(point.x-first.point.x,point.y-first.point.y) <= 8;
    const passage = again ? first.passage : this.pin(token);
    if (!passage?.valid()) return;
    const events = new AbortController();
    const opts = {capture:true,signal:events.signal};
    const pointer = event.pointerId;
    let timer = 0;
    let fan: ReturnType<typeof showFan> | undefined;
    let selected: {lens:TrainingLens;limit:number} | null = null;
    const finish = () => {
      events.abort();
      clearTimeout(timer);
      if (fan) {
        this.suppressUntil = performance.now()+450;
        this.held = false;
        delete this.surface.dataset.trainingGesture;
        fan.remove();
        if (this.surface.hasPointerCapture(pointer)) this.surface.releasePointerCapture(pointer);
        passage.restore();
      }
      this.stopPress = undefined;
    };
    this.stopPress = finish;
    timer = window.setTimeout(()=>{
      if (!this.surface.isConnected || !passage.valid()) {finish();return}
      passage.activate();
      if (events.signal.aborted || !passage.valid()) {finish();return}
      fan = showFan(point, word);
      this.held = true;
      this.surface.dataset.trainingGesture = '';
      this.surface.setPointerCapture(pointer);
      window.getSelection()?.removeAllRanges();
    },again ? repeatHoldMs : holdMs);
    // Reserve touch scrolling only once a stationary finger has opened a lens.
    // Native scrolling stays available during ordinary movement across the page.
    if(event.pointerType==='touch')this.surface.addEventListener('touchmove',move=>{
      if(fan&&move.cancelable)move.preventDefault();
    },{passive:false,signal:events.signal});
    window.addEventListener('pointermove',move=>{
      if (move.pointerId !== pointer) return;
      const delta = Math.hypot(move.clientX-point.x,move.clientY-point.y);
      if (!fan) {if (delta>8) finish();return}
      move.preventDefault();
      selected=fan.update({x:move.clientX,y:move.clientY});
    },opts);
    window.addEventListener('pointerup',up=>{
      if (up.pointerId !== pointer) return;
      if (!again && !fan && Math.hypot(up.clientX-point.x,up.clientY-point.y)<=8) this.first={token,point,when:performance.now(),passage};
      if (fan) {up.preventDefault();selected=fan.update({x:up.clientX,y:up.clientY})}
      finish();
      if (selected && passage.valid()) passage.choose(selected.lens,selected.limit);
    },opts);
    window.addEventListener('pointercancel',ev=>{if(ev.pointerId===pointer)finish()},opts);
    this.surface.addEventListener('lostpointercapture',ev=>{if(fan && ev.pointerId===pointer)finish()},opts);
    window.addEventListener('scroll',ev=>{
      const scroller=ev.target;
      if(scroller===document || scroller instanceof Element && scroller.contains(this.surface))finish();
    },opts);
    window.addEventListener('resize',finish,opts);
    window.addEventListener('blur',finish,{signal:events.signal});
    window.addEventListener('keydown',key=>{
      if (key.key!=='Escape') return;
      if (fan) {key.preventDefault();key.stopImmediatePropagation()}
      finish();
    },opts);
  }

  openChooser(passage:TrainingPassage, opener:HTMLButtonElement) {
    this.cancel();
    if (!passage.valid()) return;
    const dialog=document.createElement('dialog');
    dialog.className='training-chooser';
    dialog.setAttribute('aria-label','Training lenses');
    renderInto(dialog,
      h.form
      .attrs({method: 'dialog'})
      .children(
        h.h2('Training lenses'),
        h.label(
          'Lens',
          h.select
            .attrs({name: 'lens'})
            .children(lenses.map(([id, name]) => h.option.attrs({value: id}).children(name))),
        ),
        h.label
          .attrs({'data-reach': ''})
          .children(
            'Search reach',
            h.select
              .attrs({name: 'limit'})
              .children(
                reachLevels.map((limit) =>
                  h.option.attrs({value: String(limit)}).children('Up to ', String(limit), ' candidates'),
                ),
              ),
          ),
        h.p.attrs({'data-label': '', hidden: ''}).children('Classify the selected passage.'),
        h.p(
          'Hold a word in your selection. Drag toward a lens. Drag farther for more candidates, or return to the start to cancel.',
        ),
        h.div(
          h.button.class('secondary').attrs({value: 'cancel', type: 'submit'}).children('Cancel'),
          h.button.attrs({value: 'apply', type: 'submit'}).children('Use lens'),
        ),
      ),
    );
    const lens=dialog.querySelector<HTMLSelectElement>('[name=lens]')!;
    const reach=dialog.querySelector<HTMLSelectElement>('[name=limit]')!;
    lens.onchange=()=>{
      dialog.querySelector<HTMLElement>('[data-reach]')!.hidden=lens.value==='label';
      dialog.querySelector<HTMLElement>('[data-label]')!.hidden=lens.value!=='label';
    };
    this.chooser=dialog;
    document.body.append(dialog);dialog.showModal();lens.focus();
    dialog.addEventListener('close',()=>{
      dialog.remove();if(this.chooser===dialog)this.chooser=undefined;
      if(dialog.returnValue==='apply' && passage.valid()) passage.choose(lens.value as TrainingLens,lens.value==='label'?1:Number(reach.value));
      else if(opener.isConnected && opener.getClientRects().length) opener.focus({preventScroll:true});
      else if(this.surface.isConnected) this.surface.focus({preventScroll:true});
    },{once:true});
  }
}


const clamp = (value:number, min:number, max:number) => Math.max(min, Math.min(value,max));

function fanPoints(origin:Point, top:number, bottom:number, viewport:HTMLElement, labels:DOMRect[]):Point[] {
  const width=viewport.clientWidth,height=viewport.clientHeight,gutter=6,gap=8;
  const down=height-bottom>=top;
  const y=(distance:number,index:number)=>clamp(down?bottom+distance:top-distance,
    gutter+labels[index].height/2,height-gutter-labels[index].height/2);
  // Keep each pair on its arc, shifting the pair as a unit at a viewport edge.
  const pair=(a:number,b:number,span:number)=>{
    const min=gutter+labels[a].width/2,max=width-gutter-labels[b].width/2;
    const separation=Math.min(max-min,Math.max(span,(labels[a].width+labels[b].width)/2+gap));
    const left=clamp(origin.x-separation/2,min,max-separation);
    return [left,left+separation];
  };
  const pairWidth=Math.max(labels[0].width+labels[3].width,labels[1].width+labels[2].width)+gap;
  if(Math.min(origin.x,width-origin.x)>=80 && pairWidth<=width-2*gutter){
    const [outerLeft,outerRight]=pair(0,3,220),[innerLeft,innerRight]=pair(1,2,80);
    const innerDistance=Math.max(113,65+Math.max(...labels.map(label=>label.height))+gap);
    return [outerLeft,innerLeft,innerRight,outerRight].map((x,i)=>({x,y:y(i===1||i===2?innerDistance:65,i)}));
  }
  // At an edge, step the lenses inward on separate rows.
  const inward=origin.x<width/2?1:-1;
  let lastBottom=0;
  return [[146,29],[133,75],[86,119],[32,151]].map(([dx,dy],i)=>{
    const {width:labelWidth,height:labelHeight}=labels[i];
    const distance=Math.max(dy,lastBottom+gap+labelHeight/2);
    lastBottom=distance+labelHeight/2;
    return {x:clamp(origin.x+inward*dx,gutter+labelWidth/2,width-gutter-labelWidth/2),y:y(distance,i)};
  });
}

function showFan(origin:Point, word:HTMLElement) {
  const layer=document.createElement('div');
  layer.className='training-fan';
  layer.setAttribute('aria-hidden','true');
  const selected=word.closest('.reading-content')?.querySelectorAll<HTMLElement>('.lexeme.selected') ?? [];
  // Include the neighbouring lines of a wrapped selection. Very long passages
  // keep a local opening around the pointer.
  const line=Array.from(word.getClientRects()).find(r=>r.top<=origin.y&&r.bottom>=origin.y) ?? word.getBoundingClientRect();
  let left=line.left,right=line.right,top=line.top,bottom=line.bottom;
  for(const token of selected)for(const rect of token.getClientRects()){
    if(rect.bottom>line.top-line.height*2 && rect.top<line.bottom+line.height*2){
      left=Math.min(left,rect.left);right=Math.max(right,rect.right);
      top=Math.min(top,rect.top);bottom=Math.max(bottom,rect.bottom);
    }
  }
  layer.style.setProperty('--opening-x',((left+right)/2)+'px');
  layer.style.setProperty('--opening-y',((top+bottom)/2)+'px');
  layer.style.setProperty('--opening-width',Math.max(90,right-left+48)+'px');
  layer.style.setProperty('--opening-height',Math.max(48,bottom-top+30)+'px');
  const tags=lenses.map(([lens,name])=>{
    const tag=document.createElement('span');
    tag.className='training-fan-lens';tag.dataset.lens=lens;tag.textContent=name;
    layer.append(tag);
    return tag;
  });
  document.body.append(layer);
  const points=fanPoints(origin,top,bottom,layer,tags.map(tag=>tag.getBoundingClientRect()));
  const nodes=tags.map((tag,index)=>{
    const [lens,name]=lenses[index];
    const {x,y}=points[index];
    const dx=x-origin.x,dy=y-origin.y,angle=Math.atan2(dy,dx);
    const ray=document.createElement('i');
    ray.className='training-fan-ray';
    ray.style.left=origin.x+'px';ray.style.top=origin.y+'px';
    ray.style.width=Math.hypot(dx,dy)+'px';
    ray.style.transform='rotate('+angle+'rad)';
    // Leave a clear gap over the word where the pointer is resting.
    const clear=Math.abs((dy<0 ? top-3 : bottom+3)-origin.y)/Math.max(.12,Math.abs(Math.sin(angle)));
    ray.style.setProperty('--word-clearance',Math.max(20,clear)+'px');
    tag.style.left=x+'px';tag.style.top=y+'px';
    layer.prepend(ray);
    return {lens,name,tag,ray,angle};
  });

  const upward=points.reduce((sum,p)=>sum+p.y-origin.y,0)<0;
  const hub=document.createElement('i');
  hub.className='training-fan-hub';
  hub.style.left=origin.x+'px';hub.style.top=(upward ? line.top-2 : line.bottom+2)+'px';
  const feedback=document.createElement('div');
  feedback.className='training-fan-feedback';
  const status=document.createElement('output'),hint=document.createElement('small');
  status.textContent='Drag toward a lens';
  hint.textContent='Release here to cancel';
  feedback.append(status,hint);layer.append(hub,feedback);

  const labels=nodes.map(node=>node.tag.getBoundingClientRect());
  const above=Math.min(top,...labels.map(r=>r.top));
  const below=Math.max(bottom,...labels.map(r=>r.bottom));
  const positionFeedback=()=>{
    const box=feedback.getBoundingClientRect(),gutter=8;
    const aboveY=above-10-box.height,belowY=below+10;
    const placeAbove=aboveY>=gutter && (upward || belowY+box.height>layer.clientHeight-gutter);
    feedback.style.left=clamp(origin.x-box.width/2,gutter,layer.clientWidth-box.width-gutter)+'px';
    feedback.style.top=clamp(placeAbove?aboveY:belowY,gutter,layer.clientHeight-box.height-gutter)+'px';
  };
  positionFeedback();
  const feedbackResize=new ResizeObserver(positionFeedback);
  feedbackResize.observe(feedback);

  return {
    remove:()=>{feedbackResize.disconnect();layer.remove()},
    update(point:Point) {
      const dx=point.x-origin.x,dy=point.y-origin.y;
      const distance=Math.hypot(dx,dy),angle=Math.atan2(dy,dx);
      let choice:typeof nodes[number]|null=null;
      let best=Math.cos(Math.PI/6);
      if(distance>=22)for(const item of nodes){
        const score=Math.cos(angle-item.angle);
        if(score>best){best=score;choice=item;}
      }
      for(const item of nodes){
        item.tag.toggleAttribute('data-active',item===choice);
        item.ray.toggleAttribute('data-active',item===choice);
      }
      const limit=choice?.lens==='label' ? 1 : reachLevels[distance<62 ? 0 : distance<112 ? 1 : 2];
      if(!choice){
        status.textContent='Release to cancel';
        hint.textContent='Drag toward a lens to continue';
      } else if(choice.lens==='label'){
        status.textContent='Label this passage';
        hint.textContent='Release to label · return to start to cancel';
      } else {
        status.textContent=choice.name+' · up to '+limit+' candidates';
        hint.textContent=limit===12 ? 'Release to compare · return to start to cancel' : 'Release to compare · drag farther for '+(limit===3 ? 6 : 12);
      }
      return choice ? {lens:choice.lens,limit} : null;
    },
  };
}
