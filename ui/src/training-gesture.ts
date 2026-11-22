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
const holdMs = 360;
type Point = {x:number; y:number};

export class TrainingGesture {
  private first: {token:string; point:Point; when:number; passage:TrainingPassage} | null = null;
  private stopPress?: () => void;
  private chooser?: HTMLDialogElement;
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
    if (again) timer = window.setTimeout(()=>{
      if (!this.surface.isConnected || !passage.valid()) {finish();return}
      passage.activate();
      if (events.signal.aborted || !passage.valid()) {finish();return}
      fan = showFan(point, word);
      this.held = true;
      this.surface.dataset.trainingGesture = '';
      this.surface.setPointerCapture(pointer);
      window.getSelection()?.removeAllRanges();
    },holdMs);
    window.addEventListener('pointermove',move=>{
      if (move.pointerId !== pointer) return;
      const delta = Math.hypot(move.clientX-point.x,move.clientY-point.y);
      if (!fan) {if (delta>8) finish();return}
      move.preventDefault();
      selected=fan.update({x:move.clientX,y:move.clientY});
    },opts);
    window.addEventListener('pointerup',up=>{
      if (up.pointerId !== pointer) return;
      if (!again && Math.hypot(up.clientX-point.x,up.clientY-point.y)<=8) this.first={token,point,when:performance.now(),passage};
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
    dialog.innerHTML=`<form method="dialog"><h2>Training lenses</h2>
      <label>Lens<select name="lens">${lenses.map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label>
      <label data-reach>Search reach<select name="limit">${reachLevels.map(limit=>`<option value="${limit}">Up to ${limit} candidates</option>`).join('')}</select></label>
      <p data-label hidden>Classify the selected passage.</p>
      <p>On a selected word, click twice and hold the second press. Drag toward a lens. Drag farther for more candidates, or return to the start to cancel.</p>
      <div><button value="cancel" type="submit" class="secondary">Cancel</button><button value="apply" type="submit">Use lens</button></div>
    </form>`;
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

function fanPoints(origin:Point, selectionTop:number, selectionBottom:number):Point[] {
  const roomX=Math.min(origin.x,innerWidth-origin.x);
  const inwardX=origin.x<innerWidth/2 ? 1 : -1;
  const inwardY=origin.y<innerHeight/2 ? 1 : -1;
  let offsets:number[][];
  if(roomX>=80) {
    offsets=[[-110,65],[-40,113],[40,113],[110,65]];
  } else {
    // At a corner the whole fan turns inward. Each label has its own angle.
    offsets=[[146,29],[133,75],[86,119],[32,151]].map(([x,y])=>[x*inwardX,y]);
  }
  const clearance=inwardY>0 ? selectionBottom-origin.y : origin.y-selectionTop;
  return offsets.map(([x,y])=>({x:clamp(origin.x+x,42,innerWidth-42),y:clamp(origin.y+inwardY*(y+clearance),17,innerHeight-17)}));
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
  const points=fanPoints(origin,top,bottom);
  const nodes=lenses.map(([lens,name],index)=>{
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
    const tag=document.createElement('span');
    tag.className='training-fan-lens';tag.dataset.lens=lens;tag.textContent=name;
    tag.style.left=x+'px';tag.style.top=y+'px';
    layer.append(ray,tag);
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
  document.body.append(layer);

  const labels=nodes.map(node=>node.tag.getBoundingClientRect());
  const above=Math.min(top,...labels.map(r=>r.top));
  const below=Math.max(bottom,...labels.map(r=>r.bottom));
  const box=feedback.getBoundingClientRect(),gutter=8;
  const aboveY=above-10-box.height,belowY=below+10;
  const placeAbove=aboveY>=gutter && (upward || belowY+box.height>innerHeight-gutter);
  feedback.style.left=clamp(origin.x-box.width/2,gutter,innerWidth-box.width-gutter)+'px';
  feedback.style.top=clamp(placeAbove?aboveY:belowY,gutter,innerHeight-box.height-gutter)+'px';

  return {
    remove:()=>layer.remove(),
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
