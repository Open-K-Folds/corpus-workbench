import {el} from './dom';
import './reading-canvas.css';

export class ReadingCanvas {
  private turns: HTMLElement[] = [];
  private current = -1;
  private zoom = 100;
  private frame = 0;
  private drag: {id:number; y:number; scroll:number} | null = null;
  private observer: MutationObserver;
  private events = new AbortController();
  private pane = document.querySelector<HTMLElement>('.transcript')!;
  private text = el('tokens');
  private toolbar = el('canvas-tools');
  private scrub = el<HTMLInputElement>('canvas-scrub');
  private enter = el<HTMLButtonElement>('open-reading-canvas');

  constructor(private app:HTMLElement) {
    const options = {signal:this.events.signal};
    this.enter.onclick = () => this.open();
    el('canvas-exit').onclick = () => this.close();
    el('canvas-prev').onclick = () => this.go(this.current - 1);
    el('canvas-next').onclick = () => this.go(this.current + 1);
    this.scrub.oninput = () => this.go(this.scrub.valueAsNumber - 1);
    el('canvas-zoom-in').onclick = () => this.setZoom(10);
    el('canvas-zoom-out').onclick = () => this.setZoom(-10);
    this.pane.addEventListener('scroll', () => this.followScroll(), {...options, passive:true});
    window.addEventListener('resize', () => this.followScroll(), options);
    this.pane.addEventListener('pointerdown', event => this.panStart(event), options);
    this.pane.addEventListener('pointermove', event => {
      if (this.drag?.id === event.pointerId) this.pane.scrollTop = this.drag.scroll + this.drag.y - event.clientY;
    }, options);
    this.pane.addEventListener('pointerup', () => this.endPan(), options);
    this.pane.addEventListener('pointercancel', () => this.endPan(), options);
    this.pane.addEventListener('lostpointercapture', () => this.endPan(), options);
    document.addEventListener('keydown', event => {
      if (!this.active || event.isComposing || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      const target = event.target as HTMLElement;
      if (!this.toolbar.contains(target) && target.closest('input,textarea,select,[contenteditable=true],.draft-actions,.selection-tools,.change-popover')) return;
      if (event.key === 'Escape') {
        if (document.querySelector('.selection-tools:not([hidden]),.change-popover:not([hidden])')) return;
        event.preventDefault();event.stopPropagation();this.close();
      } else if (event.altKey && !event.ctrlKey && !event.metaKey && ['=','+','-'].includes(event.key)) {
        event.preventDefault();this.setZoom(event.key === '-' ? -10 : 10);
      }
    }, {...options, capture:true});
    this.observer = new MutationObserver(() => this.collect());
  }

  get active() {return this.toolbar.isConnected && this.app.hasAttribute('data-reading-canvas')}

  private open() {
    if (this.active) return;
    this.collect();
    const selected = this.text.querySelector('.lexeme.selected');
    const anchor = selected?.closest<HTMLElement>('.reading-block') ?? (this.pane.scrollTop > 0 ? this.turns[this.nearest()] : null);
    this.app.dataset.readingCanvas = '';
    this.toolbar.hidden = false;
    this.enter.setAttribute('aria-expanded','true');
    this.pane.scrollTop = 0;
    this.observer.observe(this.text,{childList:true});
    if (anchor) this.align(anchor);
    this.mark(this.nearest());
    el('canvas-exit').focus({preventScroll:true});
  }

  close(focusEntry=true) {
    if (!this.active) return;
    const anchor = this.turns[this.current];
    this.observer.disconnect();
    this.endPan();
    cancelAnimationFrame(this.frame);this.frame = 0;
    delete this.app.dataset.readingCanvas;
    this.toolbar.hidden = true;
    this.enter.setAttribute('aria-expanded','false');
    this.mark(-1);
    if (anchor?.isConnected) anchor.scrollIntoView({block:'nearest'});
    if (focusEntry) this.enter.focus({preventScroll:true});
  }

  dispose() {
    this.close(false);
    delete this.app.dataset.readingCanvas;
    cancelAnimationFrame(this.frame);this.observer.disconnect();this.events.abort();
  }

  private collect() {
    // Filtered-out evidence and inter-block whitespace are not navigation stops.
    this.turns = [...this.text.querySelectorAll<HTMLElement>(':scope > .reading-block:not(.literal-block):has([data-token])')];
    this.current = -1;
    if (this.active) this.mark(this.nearest());
  }

  private guide() {
    const rect = this.pane.getBoundingClientRect();
    return rect.top + Math.min(120,rect.height * .2);
  }

  private nearest() {
    const guide = this.guide() + 1;
    let low = 0, high = this.turns.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.turns[middle].getBoundingClientRect().top <= guide) low = middle + 1;
      else high = middle;
    }
    return this.turns.length ? Math.max(0,low - 1) : -1;
  }

  private mark(index:number) {
    this.turns[this.current]?.removeAttribute('data-canvas-current');
    this.current = index;
    const turn = this.turns[index], total = this.turns.length;
    const position = turn ? `Turn ${index+1} of ${total}` : 'No visible source turns';
    turn?.setAttribute('data-canvas-current','');
    el('canvas-position').textContent = position;
    this.scrub.max = String(Math.max(1,total));
    this.scrub.value = String(Math.max(1,index+1));
    this.scrub.setAttribute('aria-valuetext',turn?.dataset.location ? `${position} · ${turn.dataset.location}` : position);
    this.scrub.disabled = total < 2;
    el<HTMLButtonElement>('canvas-prev').disabled = index <= 0;
    el<HTMLButtonElement>('canvas-next').disabled = index < 0 || index >= total - 1;
  }

  private align(turn:HTMLElement) {
    if (turn === this.turns[0]) this.pane.scrollTop = 0;
    else this.pane.scrollTop += turn.getBoundingClientRect().top - this.guide();
  }

  private go(index:number) {
    const turn = this.turns[index];
    if (!this.active || !turn) return;
    this.align(turn);this.mark(index);
  }

  private followScroll() {
    if (!this.active || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const index = this.nearest();
      if (index !== this.current) this.mark(index);
    });
  }

  private setZoom(delta:number) {
    if (!this.active) return;
    const turn = this.turns[this.current];
    this.zoom = Math.max(70,Math.min(170,this.zoom + delta));
    this.pane.style.setProperty('--canvas-scale',String(this.zoom / 100));
    el('canvas-scale').textContent = this.zoom + '%';
    el<HTMLButtonElement>('canvas-zoom-in').disabled = this.zoom >= 170;
    el<HTMLButtonElement>('canvas-zoom-out').disabled = this.zoom <= 70;
    if (turn) this.align(turn);
  }

  private panStart(event:PointerEvent) {
    if (!this.active || this.drag || event.button !== 0 || event.pointerType === 'touch') return;
    if (event.target !== this.pane && event.target !== this.text && !(event.target instanceof Element && event.target.matches('.source-number'))) return;
    event.preventDefault();
    this.pane.setPointerCapture(event.pointerId);
    this.drag = {id:event.pointerId,y:event.clientY,scroll:this.pane.scrollTop};
    this.pane.dataset.panning = '';
  }

  private endPan() {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (this.pane.hasPointerCapture(drag.id)) this.pane.releasePointerCapture(drag.id);
    delete this.pane.dataset.panning;
  }
}
