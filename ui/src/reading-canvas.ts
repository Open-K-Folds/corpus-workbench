import {h} from './effect-view';
import {el} from './dom';
import {icon} from './icons';
import './reading-canvas.css';
import './reading-dock.css';

export function stageControls() {
  return h.nav
    .id('canvas-tools')
    .class('canvas-tools')
    .attrs({'aria-label': 'Reading canvas controls'})
    .children(
      h.div
        .id('canvas-passage-context')
        .class('canvas-passage-context')
        .attrs({role: 'group', 'aria-label': 'Selected passage', hidden: ''})
        .children(
          icon('notes'),
          h.span.class('canvas-passage-excerpt').attrs({dir: 'auto'}),
          h.button
            .id('dock-listen-passage')
            .attrs({type: 'button', 'aria-label': 'Listen to selected passage'})
            .children(icon('headphones'), h.span('Listen')),
          h.button
            .id('dock-analyze-passage')
            .attrs({type: 'button', 'aria-label': 'Analyze selected passage'})
            .children(icon('auto_awesome'), h.span('Analyze')),
        ),
      h.div.class('canvas-console').children(
        h.div
          .class('canvas-transport')
          .attrs({role: 'group', 'aria-label': 'Source turns'})
          .children(
            h.div
              .class('canvas-position')
              .children(
                h.label
                  .id('canvas-position')
                  .attrs({for: 'canvas-scrub', 'aria-live': 'polite', 'aria-atomic': 'true'})
                  .children('No visible source turns'),
                h.span.id('canvas-location').class('sr-only'),
                h.input
                  .id('canvas-scrub')
                  .attrs({
                    type: 'range',
                    min: '1',
                    max: '1',
                    step: '1',
                    value: '1',
                    'aria-label': 'Scrub source turns',
                  }),
              ),
            h.button
              .id('canvas-prev')
              .attrs({type: 'button', 'aria-label': 'Previous source turn', title: 'Previous source turn'})
              .children(icon('chevron_right')),
            h.button
              .id('canvas-next')
              .attrs({type: 'button', 'aria-label': 'Next source turn', title: 'Next source turn'})
              .children(icon('chevron_right')),
          ),
        h.div
          .class('canvas-listening')
          .id('canvas-listening')
          .attrs({hidden: ''})
          .children(
            h.button
              .id('canvas-play')
              .attrs({type: 'button', 'aria-label': 'Play audio on canvas', title: 'Play audio on canvas'})
              .children(icon('play_arrow')),
            h.button
              .id('follow-audio')
              .attrs({
                type: 'button',
                'aria-label': 'Follow audio',
                'aria-pressed': 'false',
                'aria-controls': 'tokens',
              })
              .children(
                icon('link'),
                h.span(
                  h.span.class('follow-label').children('Follow'),
                  h.span.class('follow-context').children(' audio'),
                ),
              ),
          ),
        h.div
          .class('canvas-zoom')
          .attrs({role: 'group', 'aria-label': 'Text size'})
          .children(
            h.button
              .id('canvas-zoom-out')
              .attrs({
                type: 'button',
                'aria-label': 'Decrease text size',
                title: 'Decrease text size (Alt + minus)',
              })
              .children(icon('remove')),
            h.output.id('canvas-scale').attrs({'aria-label': 'Text size'}).children('100%'),
            h.button
              .id('canvas-zoom-in')
              .attrs({
                type: 'button',
                'aria-label': 'Increase text size',
                title: 'Increase text size (Alt + plus)',
              })
              .children(icon('add')),
          ),
        h.button
          .id('canvas-exit')
          .attrs({
            type: 'button',
            'aria-label': 'Exit reading canvas',
            title: 'Exit focus mode (Escape)',
            hidden: '',
          })
          .children(icon('close')),
      ),
    );
}

export class ReadingCanvas {
  private turns: HTMLElement[] = [];
  private current = -1;
  private destination: {index:number;top:number;scrolling:boolean} | null = null;
  private playbackTurn: HTMLElement | null = null;
  private zoom = 100;
  private frame = 0;
  private drag: {id:number; y:number; scroll:number; turn:number | null} | null = null;
  private handle = document.createElement('button');
  private observer: MutationObserver;
  private sizeObserver: ResizeObserver;
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
    this.scrub.oninput = () => this.go(this.scrub.valueAsNumber - 1, 'scrub');
    el('canvas-zoom-in').onclick = () => this.setZoom(10);
    el('canvas-zoom-out').onclick = () => this.setZoom(-10);
    this.handle.type = 'button';
    this.handle.className = 'canvas-turn-handle';
    this.handle.title = 'Drag vertically to scrub source turns. Click to align this turn. Use Up and Down arrows, Home or End.';
    this.handle.setAttribute('aria-keyshortcuts','ArrowUp ArrowDown Home End');
    this.handle.onclick = () => this.go(this.current, 'align');
    this.handle.onkeydown = event => {
      const movements:Record<string,number> = {ArrowUp:this.current-1, ArrowDown:this.current+1, Home:0, End:this.turns.length-1};
      if (!(event.key in movements)) return;
      event.preventDefault();event.stopPropagation();this.go(movements[event.key]);
    };
    const releaseDestination = () => {
      if (this.destination?.scrolling)
        this.pane.scrollTo({top:this.pane.scrollTop,behavior:'instant'});
      this.destination = null;
    };
    this.pane.addEventListener('scroll', () => {
      const target = this.destination;
      if (target && !target.scrolling && Math.abs(this.pane.scrollTop-target.top)>1) releaseDestination();
      this.followScroll();
    }, {...options, passive:true});
    this.pane.addEventListener('wheel', releaseDestination, {...options, passive:true});
    this.pane.addEventListener('keydown', releaseDestination, {...options, capture:true});
    this.pane.addEventListener('pointerdown', event => {releaseDestination(); this.panStart(event)}, options);
    this.pane.addEventListener('scrollend', () => {
      const target = this.destination;
      if (!target?.scrolling) return;
      if (Math.abs(this.pane.scrollTop-target.top)<=1) target.scrolling = false;
      else {
        // A search jump or other scroll command interrupted the original trip.
        this.destination = null;
        this.followScroll();
      }
    }, options);
    this.pane.addEventListener('pointermove', event => {
      const drag = this.drag;
      if (!drag || drag.id !== event.pointerId) return;
      if (drag.turn === null) this.pane.scrollTop = drag.scroll + drag.y - event.clientY;
      else {
        const target = Math.max(0,Math.min(this.turns.length-1,drag.turn + Math.round((event.clientY-drag.y)/24)));
        if (target !== this.current) this.go(target, 'scrub');
      }
    }, options);
    this.pane.addEventListener('pointerup', event => {
      if (this.drag?.id !== event.pointerId) return;
      if (this.drag.turn !== null && Math.abs(event.clientY-this.drag.y)<4) this.go(this.drag.turn, 'align');
      this.endPan();
    }, options);
    const cancelPan = (event:PointerEvent) => {if (event.pointerId === this.drag?.id) this.endPan()};
    this.pane.addEventListener('pointercancel', cancelPan, options);
    this.pane.addEventListener('lostpointercapture', cancelPan, options);
    document.addEventListener('keydown', event => {
      if (event.isComposing || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      const target = event.target as HTMLElement;
      if (!this.active && !this.toolbar.contains(target) && !this.pane.contains(target)) return;
      if (!this.toolbar.contains(target) && target.closest('input,textarea,select,[contenteditable=true],.draft-actions,.selection-tools,.change-popover')) return;
      if (this.active && event.key === 'Escape') {
        if (document.querySelector('.selection-tools:not([hidden]),.change-popover:not([hidden])')) return;
        event.preventDefault();event.stopPropagation();this.close();
      } else if (event.altKey && !event.ctrlKey && !event.metaKey && ['=','+','-'].includes(event.key)) {
        event.preventDefault();this.setZoom(event.key === '-' ? -10 : 10);
      }
    }, {...options, capture:true});
    this.observer = new MutationObserver(() => this.collect());
    this.observer.observe(this.text,{childList:true});
    this.sizeObserver = new ResizeObserver(() => this.followScroll());
    this.sizeObserver.observe(this.pane);
    this.collect();
  }

  get active() {return this.toolbar.isConnected && this.app.hasAttribute('data-reading-canvas')}

  setPlaybackTurn(turn: HTMLElement | null) {
    if (turn === this.playbackTurn) return;
    this.playbackTurn = turn;
    // Manual wheel/keyboard events finish relative to the turn they started on.
    // Read the new scroll position after their default action.
    if (!turn) {this.followScroll(); return}
    this.destination = null;
    const index = this.readingIndex();
    if (this.current !== index) this.mark(index);
  }

  private open() {
    if (this.active) return;
    this.collect();
    const selected = this.text.querySelector('.lexeme.selected');
    const anchor = this.playbackTurn ?? selected?.closest<HTMLElement>('.reading-block') ?? (this.pane.scrollTop > 0 ? this.turns[this.nearest()] : null);
    this.app.dataset.readingCanvas = '';
    el('canvas-exit').hidden = false;
    this.enter.setAttribute('aria-expanded','true');
    this.pane.scrollTop = 0;
    if (anchor) this.pane.scrollTop = this.alignmentOffset(anchor);
    this.mark(this.readingIndex());
    el('canvas-exit').focus({preventScroll:true});
  }

  close(focusEntry=true) {
    if (!this.active) return;
    const anchor = this.turns[this.current];
    this.endPan();
    cancelAnimationFrame(this.frame);this.frame = 0;
    delete this.app.dataset.readingCanvas;
    el('canvas-exit').hidden = true;
    this.enter.setAttribute('aria-expanded','false');
    if (anchor?.isConnected) anchor.scrollIntoView({block:'nearest'});
    this.mark(this.readingIndex());
    if (focusEntry) this.enter.focus({preventScroll:true});
  }

  dispose() {
    this.close(false);
    delete this.app.dataset.readingCanvas;
    cancelAnimationFrame(this.frame);this.observer.disconnect();this.sizeObserver.disconnect();this.events.abort();
  }

  private collect() {
    this.destination = null;
    // Filtered-out evidence and inter-block whitespace are not navigation stops.
    this.turns = [...this.text.querySelectorAll<HTMLElement>(':scope > .reading-block:not(.literal-block):has([data-token])')];
    this.endPan();
    this.mark(this.readingIndex());
  }

  private guide() {
    const rect = this.pane.getBoundingClientRect();
    return rect.top + Math.min(120,rect.height * .2);
  }

  private readingIndex() {
    const timed = this.playbackTurn ? this.turns.indexOf(this.playbackTurn) : -1;
    return timed >= 0 ? timed : this.destination?.index ?? this.nearest();
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
    if (turn) {
      this.handle.dataset.turn = String(index+1);
      this.handle.setAttribute('aria-label',`Steer source turn ${index+1} of ${total}. Use Up and Down arrows to scrub.`);
      if (this.handle.parentElement !== turn) {
        const focused = document.activeElement === this.handle;
        turn.prepend(this.handle);
        if (focused) this.handle.focus({preventScroll:true});
      }
    } else this.handle.remove();
    const source = el('canvas-location');
    source.textContent = turn?.dataset.location ?? '';
    el('canvas-position').title = source.textContent ? `Source identifier: ${source.textContent}` : '';
    this.scrub.max = String(Math.max(1,total));
    this.scrub.value = String(Math.max(1,index+1));
    this.scrub.setAttribute('aria-valuetext',turn?.dataset.location ? `${position} · ${turn.dataset.location}` : position);
    this.scrub.style.setProperty('--turn-progress', (total > 1 ? index / (total - 1) * 100 : 0) + '%');
    this.scrub.disabled = total < 2;
    el<HTMLButtonElement>('canvas-prev').disabled = index <= 0;
    el<HTMLButtonElement>('canvas-next').disabled = index < 0 || index >= total - 1;
  }

  private alignmentOffset(turn:HTMLElement) {
    const top = turn === this.turns[0] ? 0 : this.pane.scrollTop + turn.getBoundingClientRect().top - this.guide();
    return Math.max(0,Math.min(top,this.pane.scrollHeight-this.pane.clientHeight));
  }

  private go(index:number, mode:'reveal'|'align'|'scrub'='reveal') {
    const turn = this.turns[index];
    if (!turn) return;
    const pane = this.pane.getBoundingClientRect(), box = turn.getBoundingClientRect();
    const inset = Math.min(24,pane.height * .08);
    // A long turn only needs its opening lines in view for the reader to start.
    const visible = box.top >= pane.top+inset && box.top+Math.min(box.height,48) <= pane.bottom-inset;
    const keepPlace = mode === 'reveal' && visible;
    const top = keepPlace ? this.pane.scrollTop : this.alignmentOffset(turn);
    const scrolling = Math.abs(this.pane.scrollTop-top)>1 && mode !== 'scrub' && matchMedia('(prefers-reduced-motion: no-preference)').matches;
    this.destination = {index,top,scrolling};
    this.pane.scrollTo({top,behavior:scrolling?'smooth':'instant'});
    this.mark(index);
  }

  private followScroll() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const index = this.readingIndex();
      if (index !== this.current) this.mark(index);
    });
  }

  private setZoom(delta:number) {
    const turn = this.turns[this.current];
    this.zoom = Math.max(70,Math.min(300,this.zoom + delta));
    this.pane.style.setProperty('--canvas-scale',String(this.zoom / 100));
    el('canvas-scale').textContent = this.zoom + '%';
    el<HTMLButtonElement>('canvas-zoom-in').disabled = this.zoom >= 300;
    el<HTMLButtonElement>('canvas-zoom-out').disabled = this.zoom <= 70;
    if (turn) this.go(this.current);
  }

  private panStart(event:PointerEvent) {
    if (this.drag || !event.isPrimary || event.button !== 0) return;
    const target = event.target;
    const steering = target === this.handle;
    const margin = target === this.pane || target === this.text || (target instanceof Element && target.matches('.source-number,.reading-block'));
    if (!steering && (event.pointerType === 'touch' || !margin)) return;
    event.preventDefault();
    if (steering) {
      this.destination = {index:this.current,top:this.pane.scrollTop,scrolling:false};
      this.handle.focus({preventScroll:true});
    }
    this.pane.setPointerCapture(event.pointerId);
    this.drag = {id:event.pointerId,y:event.clientY,scroll:this.pane.scrollTop,turn:steering ? this.current : null};
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
