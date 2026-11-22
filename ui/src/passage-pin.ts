import './passage-pin.css';

/** A temporary reading aid. Its positions refer to the current text projection. */
export class PassagePin {
  private handle = document.createElement('button');
  private status = document.createElement('span');
  private words: HTMLElement[] = [];
  private indices = new Map<HTMLElement, number>();
  private painted: HTMLElement[] = [];
  private start = 0;
  private length = 0;
  private cancelMove?: () => void;

  constructor(private surface: HTMLElement,
    private select: (words: HTMLElement[], showTools: boolean) => void,
    private available: () => boolean) {
    this.status.className = 'sr-only';
    this.status.setAttribute('role','status');
    this.surface.before(this.status);
    this.handle.type = 'button';
    this.handle.className = 'passage-pin-handle';
    this.handle.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Enter Delete');
    this.handle.title = 'Drag this word to move the pin. Use Left or Right to move, Enter for passage tools, or Delete to unpin.';
    this.handle.onpointerdown = event => this.drag(event);
    // Keyboard and assistive technology activation produces a non-pointer click.
    this.handle.onclick = event => {
      event.stopPropagation();
      if (event.detail === 0 && this.available()) this.select(this.painted, true);
    };
    this.handle.onkeydown = event => {
      if (!this.available()) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        this.clear(true);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        const next = this.start + (event.key === 'ArrowLeft' ? -1 : 1);
        if (this.fits(next)) {
          this.place(next, true);
          this.handle.scrollIntoView({block:'nearest',inline:'nearest'});
        }
      }
    };
  }

  matches(ids: string[]) {
    return this.length > 0 && ids.length === this.length && this.painted.every((word, i) => word.dataset.token === ids[i]);
  }

  set(ids: string[]) {
    // Include filtered tokens in the index. A pin cannot bridge a hidden word.
    const words = [...this.surface.querySelectorAll<HTMLElement>('.lexeme')];
    const start = words.findIndex(word => word.dataset.token === ids[0]);
    if (start < 0 || !ids.every((id, i) => words[start + i]?.dataset.token === id)) return false;
    this.clear();
    this.words = words;
    this.indices = new Map(words.map((word, i) => [word, i]));
    this.length = ids.length;
    this.place(start, true);
    return true;
  }

  clear(restoreFocus = false) {
    const keyword = this.handle.parentElement;
    this.cancelMove?.();
    this.handle.remove();
    this.paint([]);
    this.length = 0;
    this.words = [];
    this.indices.clear();
    if (restoreFocus) {
      keyword?.focus({preventScroll: true});
      this.status.textContent = 'Passage unpinned.';
    }
  }

  private get middle() {return Math.floor((this.length - 1) / 2)}

  private fits(start: number) {
    return start >= 0 && start + this.length <= this.words.length &&
      this.words.slice(start, start + this.length).every(word => word.hasAttribute('data-token'));
  }

  private paint(words: HTMLElement[]) {
    for (const word of this.painted) word.classList.remove('passage-pinned', 'pin-keyword');
    for (const word of words) word.classList.add('passage-pinned');
    words[this.middle]?.classList.add('pin-keyword');
    this.painted = words;
  }

  private place(start: number, focus: boolean) {
    this.start = start;
    this.paint(this.words.slice(start, start + this.length));
    const word = this.painted[this.middle];
    const text = word.querySelector('.reading-text')?.textContent ?? '';
    this.handle.setAttribute('aria-label', `Pinned word “${text}”. Use arrow keys to move the passage.`);
    word.append(this.handle);
    this.select(this.painted, false);
    if (focus) this.handle.focus({preventScroll: true});
    this.status.textContent = `Pinned ${this.length} ${this.length === 1 ? 'word' : 'words'} around “${text}”.`;
  }

  private drag(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || !this.available()) return;
    event.preventDefault();
    event.stopPropagation();
    const pointer = event.pointerId;
    const original = this.start;
    let moved = false;
    let preview = original;
    const tether = document.createElement('span');
    tether.setAttribute('aria-hidden','true');
    tether.className = 'passage-pin-tether';
    const scope = new AbortController();
    const options = {signal: scope.signal};
    const finish = () => {
      scope.abort();
      this.cancelMove = undefined;
      this.surface.classList.remove('moving-passage-pin');
      tether.remove();
      if (this.handle.hasPointerCapture(pointer)) this.handle.releasePointerCapture(pointer);
      this.paint(this.words.slice(original, original + this.length));
    };
    this.cancelMove = finish;
    this.handle.setPointerCapture(pointer);
    const targetStart = (e: PointerEvent) => {
      const word = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.lexeme');
      const index = word ? this.indices.get(word) : undefined;
      if (index === undefined) return null;
      const start = index - this.middle;
      return this.fits(start) ? start : null;
    };
    this.handle.addEventListener('pointermove', e => {
      if (e.pointerId !== pointer) return;
      if (!moved && Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < 4) return;
      moved = true;
      this.surface.classList.add('moving-passage-pin');
      const start = targetStart(e) ?? original;
      if (preview !== start) this.paint(this.words.slice(start, start + this.length));
      preview = start;
      if (start === original) {tether.remove(); return}
      const from = this.handle.getBoundingClientRect();
      const to = this.words[start + this.middle].querySelector('.reading-text')!.getBoundingClientRect();
      const right = from.left < to.left;
      const x = right ? from.right : from.left;
      const dx = (right ? to.left : to.right) - x;
      const dy = to.bottom - from.bottom;
      tether.style.left = x + 'px';
      tether.style.top = from.bottom + 'px';
      tether.style.width = Math.hypot(dx, dy) + 'px';
      tether.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      if (!tether.isConnected) document.body.append(tether);
    }, options);
    this.handle.addEventListener('pointerup', e => {
      if (e.pointerId !== pointer) return;
      const start = targetStart(e);
      finish();
      if (!this.available()) return;
      if (moved && start !== null) this.place(start, true);
      else if (!moved) this.select(this.painted, true);
    }, options);
    const cancelPointer = (e: PointerEvent) => {if (e.pointerId === pointer) finish()};
    this.handle.addEventListener('pointercancel', cancelPointer, options);
    this.handle.addEventListener('lostpointercapture', cancelPointer, options);
    window.addEventListener('blur', finish, options);
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {e.preventDefault(); e.stopImmediatePropagation(); finish()}
    }, {...options, capture: true});
  }
}
