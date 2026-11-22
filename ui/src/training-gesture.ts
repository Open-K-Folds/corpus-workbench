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
    const token = target instanceof Element && target.closest('.reading-text')?.closest<HTMLElement>('[data-token]')?.dataset.token;
    const point = {x:event.clientX,y:event.clientY};
    const first = this.first;
    this.cancel();
    if (!token) return;
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
      fan = showFan(point);
      this.held = true;
      this.surface.dataset.trainingGesture = '';
      this.surface.setPointerCapture(pointer);
      window.getSelection()?.removeAllRanges();
      passage.activate();
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

// Place the four labeled rays into the roomier half of the viewport. Their actual
// on-screen directions also drive hit testing, including when near a corner.
function showFan(origin:Point) {
  const layer=document.createElement('div');
  layer.className='training-fan';layer.setAttribute('aria-hidden','true');
  const side=origin.x < innerWidth/2 ? 1 : -1;
  const rows=[-67,-23,23,67];
  const centerY=Math.max(83,Math.min(origin.y,innerHeight-83));
  const nodes=lenses.map(([lens,name],i)=>{
    const x=Math.max(43,Math.min(innerWidth-43,origin.x+side*(i===0||i===3?79:132)));
    const y=centerY+rows[i];
    const dx=x-origin.x,dy=y-origin.y;
    const ray=document.createElement('i');
    ray.style.cssText=`left:${origin.x}px;top:${origin.y}px;width:${Math.hypot(dx,dy)}px;transform:rotate(${Math.atan2(dy,dx)}rad)`;
    const tag=document.createElement('span');
    tag.className='training-fan-lens';tag.dataset.lens=lens;tag.textContent=name;
    tag.style.left=x+'px';tag.style.top=y+'px';
    layer.append(ray,tag);
    return {lens,name,tag,angle:Math.atan2(dy,dx)};
  });
  const hub=document.createElement('i');hub.className='training-fan-hub';hub.style.left=origin.x+'px';hub.style.top=origin.y+'px';
  const status=document.createElement('output');status.textContent='Drag toward a lens';
  status.style.left=Math.max(81,Math.min(innerWidth-81,origin.x))+'px';
  status.style.top=(origin.y<innerHeight/2?Math.min(innerHeight-16,centerY+100):Math.max(16,centerY-100))+'px';
  layer.append(hub,status);document.body.append(layer);
  return {
    remove:()=>layer.remove(),
    update(point:Point) {
      const dx=point.x-origin.x,dy=point.y-origin.y;
      const distance=Math.hypot(dx,dy),angle=Math.atan2(dy,dx);
      let choice:typeof nodes[number] | null=null;
      let best=Math.cos(Math.PI/6);
      if(distance>=22) for(const item of nodes){
        const score=Math.cos(angle-item.angle);if(score>best){best=score;choice=item}
      }
      for(const item of nodes)item.tag.toggleAttribute('data-active',item===choice);
      const limit=choice?.lens==='label'?1:reachLevels[distance<62?0:distance<112?1:2];
      status.textContent=choice ? (choice.lens==='label'?'Label this passage':`${choice.name} · up to ${limit} candidates`) : 'Release to cancel';
      return choice?{lens:choice.lens,limit}:null;
    },
  };
}
