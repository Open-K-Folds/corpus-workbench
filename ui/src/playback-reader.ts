import './playback-reader.css';
import type {PlaybackCue} from './playback-cues';

/** Places the recording clock in the reading column without moving its editing caret. */
export class PlaybackReader {
  private pane: HTMLElement;
  private caret = document.createElement('span');
  private cue: PlaybackCue | null = null;
  private following = false;
  private words = new Map<string, HTMLElement>();
  private turns = new Map<string, HTMLElement[]>();
  private indexed = false;
  private marked: HTMLElement[] = [];
  private primary: HTMLElement | null = null;
  private events = new AbortController();
  private resize: ResizeObserver;
  private projection: MutationObserver;
  private previousLine: number | null = null;

  constructor(private surface: HTMLElement, onSuspendFollowing: () => void) {
    this.pane = surface.closest<HTMLElement>('.transcript')!;
    this.caret.className = 'playback-caret';
    this.caret.hidden = true;
    this.caret.setAttribute('aria-hidden','true');
    this.pane.append(this.caret);
    const options = {signal:this.events.signal};
    const suspend = () => {
      if (!this.following) return;
      this.following = false;
      // A smooth line advance may still be running when the reader takes over.
      this.pane.scrollTo({top:this.pane.scrollTop, behavior:'instant'});
      onSuspendFollowing();
    };
    this.pane.addEventListener('wheel', event => {if (event.deltaY) suspend()}, {...options, passive:true});
    this.pane.addEventListener('pointerdown', event => {
      if (event.target instanceof Element && (surface.contains(event.target) || event.target === this.pane ||
          event.target.closest('#next-match,#jump-source'))) suspend();
    }, options);
    this.pane.addEventListener('keydown', event => {
      if (surface.contains(event.target as Node) && ['PageUp','PageDown','Home','End','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(event.key)) suspend();
    }, options);
    this.pane.parentElement?.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('#canvas-prev,#canvas-next')) suspend();
    }, options);
    this.pane.parentElement?.addEventListener('input', event => {
      if (event.target instanceof Element && event.target.id === 'canvas-scrub') suspend();
    }, options);

    this.projection = new MutationObserver(() => this.refresh());
    this.projection.observe(surface,{childList:true});
    this.resize = new ResizeObserver(() => this.position(true));
    this.resize.observe(this.pane);
    this.resize.observe(surface);
    this.pane.addEventListener('toggle', () => this.position(true), {...options, capture:true});
    document.fonts.addEventListener('loadingdone', () => this.position(true), options);
  }

  show(cue: PlaybackCue | null, follow: boolean, options: {jump?:boolean} = {}) {
    const changed = cue !== this.cue;
    const resume = follow && !this.following;
    this.following = follow;
    this.cue = cue;
    if (changed) this.paint();
    if (changed || options.jump || resume) this.position(Boolean(options.jump || resume));
  }

  /** A projection or filter replaced the actual source nodes. Resolve identities again. */
  refresh() {
    this.indexed = false;
    this.paint();
    this.position(true);
  }

  reset() {
    this.show(null,false);
    this.words.clear();
    this.turns.clear();
    this.indexed = false;
  }

  destroy() {
    this.reset();
    this.events.abort();
    this.projection.disconnect();
    this.resize.disconnect();
    this.caret.remove();
  }

  private index() {
    this.words.clear();
    this.turns.clear();
    for (const word of this.surface.querySelectorAll<HTMLElement>('.lexeme[data-token]')) this.words.set(word.dataset.token!,word);
    for (const turn of this.surface.querySelectorAll<HTMLElement>('.reading-block:is([data-utterance],[data-playback-utterance]):not(.turn-separator)')) {
      if (turn.querySelector('.lexeme') && !turn.querySelector('[data-token]')) continue;
      const id = turn.dataset.utterance ?? turn.dataset.playbackUtterance!;
      const blocks = this.turns.get(id) ?? [];
      blocks.push(turn);
      this.turns.set(id,blocks);
    }
    this.indexed = true;
  }

  private paint() {
    for (const node of this.marked) {
      delete node.dataset.playbackWord;
      delete node.dataset.playbackTurn;
    }
    this.primary?.removeAttribute('aria-current');
    this.marked = [];
    if (this.cue) {
      if (!this.indexed) this.index();
      for (const id of this.cue.wordIds) {
        const word = this.words.get(id);
        if (word) {word.dataset.playbackWord = ''; this.marked.push(word)}
      }
      for (const id of this.cue.turnIds) {
        for (const block of this.turns.get(id) ?? []) {
          block.dataset.playbackTurn = '';
          this.marked.push(block);
        }
      }
    }
    // Prefer exact words; retain the current speaker while concurrent words overlap.
    const first = this.marked[0];
    if (!this.primary || !this.marked.includes(this.primary) ||
        (first?.hasAttribute('data-playback-word') && !this.primary.hasAttribute('data-playback-word'))) {
      this.primary = first ?? null;
    }
    this.primary?.setAttribute('aria-current','time');
    this.surface.toggleAttribute('data-playback-evidence',Boolean(this.primary));
  }

  private position(jump: boolean) {
    const target = this.primary;
    const word = target?.hasAttribute('data-playback-word') ? target.querySelector('.reading-text') : null;
    const bounds = this.pane.getBoundingClientRect();
    const line = (word ?? target)?.getClientRects()[0];
    if (!target || !line || !line.height || !bounds.height) {
      this.caret.hidden = true;
      this.previousLine = null;
      return;
    }
    if (word) {
      // Reading direction and wrapped words make the source text's first caret
      // more reliable than the left edge of the lexeme's bounding rectangle.
      const range = document.createRange();
      range.setStart(word.firstChild ?? word,0);
      range.collapse(true);
      const start = range.getBoundingClientRect();
      const x = (start.height ? start.left : line.left) - bounds.left - this.pane.clientLeft + this.pane.scrollLeft - 1;
      const y = line.top - bounds.top - this.pane.clientTop + this.pane.scrollTop;
      const glide = !jump && !this.caret.hidden && this.previousLine !== null && Math.abs(y - this.previousLine) < 1;
      this.caret.toggleAttribute('data-glide', glide);
      this.caret.style.transform = `translate(${x}px,${y}px)`;
      this.caret.style.height = `${line.height}px`;
      this.caret.hidden = false;
      this.previousLine = y;
    } else {
      this.caret.hidden = true;
      this.previousLine = null;
    }
    if (!this.following || this.surface.inert || this.surface.querySelector('#inline-replacement')) return;
    const top = bounds.top + Math.min(32,bounds.height * .12);
    const bottom = bounds.top + bounds.height * .79;
    // A turn may span many screens. Any overlap with the reading band is a
    // valid position until another timed source is reached.
    if (line.top <= bottom && line.bottom >= top) return;
    const delta = line.top - (bounds.top + bounds.height * .42);
    const smooth = !jump && Math.abs(delta) < bounds.height && matchMedia('(prefers-reduced-motion: no-preference)').matches;
    this.pane.scrollTo({top:this.pane.scrollTop + delta, behavior:smooth ? 'smooth' : 'instant'});
  }
}
