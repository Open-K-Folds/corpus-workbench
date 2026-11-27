import {displayText, h, renderInto} from './effect-view';
import {api} from './api';
import type {Document,View} from './contracts';
import {icon} from './icons';
import {suppliedCue,type RecordingCue} from './listening';
import type {Passage} from './training-candidates';
import './training-source.css';

const contextSeconds = 2;
const intervalText = (start:number, end:number) => `${Number(start.toFixed(3))}–${Number(end.toFixed(3))} s`;

// Source inspection can follow a saved example back to an earlier revision.
export function sourceCard(p:Passage, caption:string, current:View) {
  const card = document.createElement('article');
  card.className = 'training-source';
  renderInto(card,
    h.div.class('training-byline').children(h.strong(caption), h.small('R', displayText(p.revision))),
    h.blockquote(p.quote),
    h.p(
      p.title,
      ' · ',
      p.utterance ?? 'Unsegmented passage',
      ' · ',
      p.speaker ? 'Speaker ' + p.speaker : 'Speaker unknown',
    ),
    h.details(h.summary('Source context'), h.div),
  );
  const details = card.querySelector('details')!;
  const body = details.querySelector('div')!;
  let stopPlayback:(()=>void)|undefined;
  let generation = 0;
  card.addEventListener('training-stop', () => stopPlayback?.());
  details.ontoggle = async () => {
    const ticket = ++generation;
    stopPlayback?.();
    stopPlayback = undefined;
    if (!details.open) return;
    body.textContent = 'Opening saved context…';
    try {
      const basis = current.revision.snapshot_hash === p.snapshotHash ? current : await api<View>('/api/view?revision='+p.revision);
      const doc = basis.documents.find(item => item.path === p.document);
      if (!doc || basis.snapshot.project !== p.project || basis.revision.id !== p.revision || basis.revision.snapshot_hash !== p.snapshotHash ||
          basis.snapshot.files[p.document]?.sha256 !== p.documentHash) throw new Error('The recorded source revision is unavailable in this project.');
      const first = doc.tokens.findIndex(token => token.id === p.tokenIds[0]);
      if (first < 0 || !p.tokenIds.every((id, i) => doc.tokens[first+i]?.id === id)) throw new Error('The saved source anchor is unavailable.');
      if (generation !== ticket || !details.open) return;
      const from = Math.max(0,first-14), end = first+p.tokenIds.length;
      const words = doc.tokens.slice(from,end+14).map((token,i) => {
        const text = token.corrected ?? token.original;
        return from+i >= first && from+i < end ? h.mark(text) : text;
      });
      renderInto(body,
        h.p.class('training-context').children(
          from ? '… ' : '',
          words.flatMap((word, index) => (index ? [' ', word] : [word])),
          end + 14 < doc.tokens.length ? ' …' : '',
        ),
        h.small(
          p.document,
          ' · ',
          p.tokenIds[0],
          p.tokenIds.length > 1 ? ' – ' + displayText(p.tokenIds.at(-1)) : '',
          p.language ? ' · ' + p.language : '',
        ),
      );
      const cue = suppliedCue(doc,p.tokenIds,Infinity);
      const media = [...new Set(doc.media.flatMap(name=>[name,'Audio/'+name,'Video/'+name]).filter(name=>basis.snapshot.files[name]?.role==='source-media'))];
      if ('reason' in cue || media.length !== 1) return;
      const projection = await api<{snapshot_hash:string;media_base_unsupported:boolean}>(`/api/reading?path=${encodeURIComponent(doc.path)}&revision=${p.revision}`);
      if (generation !== ticket || !details.open || projection.snapshot_hash !== p.snapshotHash || projection.media_base_unsupported) return;
      const mediaUrl = `/api/media?path=${encodeURIComponent(media[0])}&revision=${p.revision}`;
      stopPlayback = addListeningControls(details,body,doc,p.tokenIds,cue,mediaUrl);
    } catch(error) {
      if (generation === ticket) body.textContent=String(error);
    }
  };
  return card;
}

function addListeningControls(details:HTMLDetailsElement, body:HTMLElement, doc:Document, ids:string[], cue:RecordingCue, mediaUrl:string) {
  const player = new Audio();
  const controls = document.createElement('div');
  controls.className = 'training-source-audio';
  controls.setAttribute('role','group');
  controls.setAttribute('aria-label','Passage audio');
  renderInto(controls,
    h.small(cue.basis === 'word' ? 'Word' : 'Utterance', ' timing · ', intervalText(cue.start, cue.end)),
    h.div
    .class('training-source-buttons')
    .children(
      h.button.class('secondary').attrs({type: 'button', 'data-mode': 'excerpt'}),
      h.button.class('secondary').attrs({type: 'button', 'data-mode': 'context'}),
    ),
    h.small.attrs({role: 'status'}),
  );
  body.append(controls);
  const buttons = controls.querySelectorAll<HTMLButtonElement>('button');
  const status = controls.querySelector<HTMLElement>('[role=status]')!;
  let active: 'excerpt'|'context'|null = null;
  let request = 0;
  let timer:ReturnType<typeof setTimeout>|undefined;
  function updateButtons() {
    for (const button of buttons) {
      const playing = active === button.dataset.mode;
      const context = button.dataset.mode === 'context';
      renderInto(button,
        icon(playing ? 'stop_circle' : context ? 'graphic_eq' : 'headphones'),
        playing ? (context ? 'Stop context' : 'Stop excerpt') : context ? 'Hear in context' : 'Hear excerpt',
      );
    }
  }
  function stop() {
    request++;
    clearTimeout(timer);
    player.pause();
    active = null;
    updateButtons();
    status.textContent = `Context includes up to ${contextSeconds} s before and after the excerpt.`;
  }
  stop();

  // Read the latest requested range when the recording metadata arrives.
  async function start() {
    if (!active || !controls.isConnected || !details.open) return;
    const started = request;
    const playable = suppliedCue(doc,ids,player.duration);
    if (!Number.isFinite(player.duration) || 'reason' in playable) {
      stop();
      status.textContent = 'The supplied timing extends beyond this recording.';
      return;
    }
    const context = active === 'context';
    const from = context ? Math.max(0,playable.start-contextSeconds) : playable.start;
    const until = context ? Math.min(player.duration,playable.end+contextSeconds) : playable.end;
    try {
      player.currentTime = from;
      await player.play();
      if (request !== started) return;
      status.textContent = `Playing ${context ? 'context' : 'excerpt'} · ${intervalText(from,until)}`;
      const checkEnd = () => {
        if (started !== request) return;
        if (!controls.isConnected || player.ended || player.currentTime >= until) {stop();return;}
        timer = setTimeout(checkEnd,Math.max(15,Math.min(250,(until-player.currentTime)*1000)));
      };
      checkEnd();
    } catch {
      if (request !== started) return;
      stop();
      status.textContent = 'Playback could not start. Try again.';
    }
  }
  player.onloadedmetadata = start;
  player.onended = () => {if (player.ended) stop();};
  player.onerror = () => {
    if (!active) return;
    stop();
    status.textContent = 'Recording unavailable. Try again.';
  };
  for (const button of buttons) {
    button.onclick = () => {
      const mode = button.dataset.mode === 'context' ? 'context' : 'excerpt';
      if (active === mode) {stop();return;}
      document.querySelectorAll('.training-source').forEach(node=>node.dispatchEvent(new Event('training-stop')));
      document.querySelector<HTMLAudioElement>('#audio')?.pause();
      active = mode;
      updateButtons();
      status.textContent = 'Opening recording…';
      if (player.readyState >= HTMLMediaElement.HAVE_METADATA && !player.error) {
        void start();
      } else if (!player.src || player.error) {
        player.src = mediaUrl;
        player.load();
      }
    };
  }
  return stop;
}
