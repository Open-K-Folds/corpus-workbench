import {preparePassage, type PassageRequest} from '../../desktop/coanalysis-prompt.mjs';
import type {Document, Operation, View} from './contracts';
import {desktop} from './desktop';
import {esc} from './dom';
import {icon} from './icons';
import {quoteCheck} from './quote-check';
import type {Listening} from './listening';
import './coanalysis.css';

const lenses = [
  ['Competing readings', 'What are two plausible readings of this passage, and which words support each?', 'view_agenda'],
  ['Language in context', 'Where might register or language use shift, and what would a speaker or listener need to clarify?', 'notes'],
  ['Follow-up questions', 'What question would help a researcher distinguish what is said here from what is being inferred?', 'search'],
] as const;

interface Memo {
  format: 'corpus-workbench/coanalysis-1';
  revision: number;
  snapshot_hash: string;
  document: string;
  project: string;
  prompt: string;
  question: string;
  first_reading?: string;
  model: string;
  method: 'llama.cpp' | 'manual';
  proposal: string;
  decision: string;
  interpretation: string;
}

type PassageGroups = ReturnType<typeof preparePassage>['groups'];

// Existing exported annotations carry their original source words in the saved prompt.
function savedExcerpt(memo: Memo): PassageGroups | null {
  const marker = '\n\nTranscript excerpt: ';
  const start = typeof memo.prompt === 'string' ? memo.prompt.lastIndexOf(marker) : -1;
  if (start < 0) return null;
  try {
    const groups = JSON.parse(memo.prompt.slice(start + marker.length)) as PassageGroups;
    if (!Array.isArray(groups) || !groups.length || !groups.every(group =>
      group && (group.utterance === null || typeof group.utterance === 'string') &&
      typeof group.gap_before === 'boolean' && Array.isArray(group.tokens) && group.tokens.length &&
      group.tokens.every(token => token && typeof token.id === 'string' && typeof token.text === 'string'))) return null;
    return groups;
  } catch { return null; }
}

function savedMemos(view: View, doc: Document, expand: boolean, actions: Actions) {
  const library = document.createElement('details');
  library.className = 'ca-history';
  library.open = expand;
  const heading = document.createElement('summary');
  library.append(heading);
  let count = 0;
  for (const span of doc.spans) {
    if (!span.id.startsWith('coanalysis-')) continue;
    let memo: Memo;
    try { memo = JSON.parse(span.fields.note); } catch { continue; }
    if (memo?.format !== 'corpus-workbench/coanalysis-1') continue;
    const groups = savedExcerpt(memo);
    const quote = groups?.map(group =>
      (group.gap_before ? '[…] ' : '') + group.tokens.map(token => token.text).join(' ')).join('\n');
    const row = document.createElement('details');
    row.className = 'ca-saved';
    row.innerHTML = `<summary><span class="ca-saved-quote">${esc(quote || memo.question || 'Saved interpretation')}</span>
      <small>${esc(memo.decision)} · R${esc(memo.revision)}</small>${icon('chevron_right')}</summary>
      <div class="ca-saved-body">
        <strong>Researcher interpretation</strong><p>${esc(memo.interpretation)}</p>
        <strong>Research question</strong><p>${esc(memo.question)}</p>
        ${memo.first_reading ? `<strong>Your first reading</strong><p>${esc(memo.first_reading)}</p>` : ''}
        <strong>Model proposal · ${esc(memo.model)}</strong><p>${esc(memo.proposal)}</p>
        <details><summary>Original prompt and source</summary><p>${esc(memo.project)} · ${esc(memo.document)} · R${esc(memo.revision)}</p>
          <p>${esc(span.token_ids.join(', '))}</p><code>${esc(memo.snapshot_hash)}</code><p>${esc(memo.prompt)}</p>
          <small>${memo.method === 'llama.cpp' ? 'Local llama.cpp' : 'Manually supplied reply'}</small></details>
      </div>`;
    if (groups) {
      const action = document.createElement('button');
      action.className = 'secondary';
      action.type = 'button';
      action.hidden = true;
      action.innerHTML = icon('menu_book') + 'Show in transcript';
      const status = document.createElement('small');
      status.setAttribute('role', 'status');
      row.querySelector('.ca-saved-body')!.prepend(action, status);
      action.onclick = async () => { status.textContent = await actions.reveal(span.token_ids); };
      row.ontoggle = () => {
        if (!row.open) return;
        let matches = false;
        if (memo.project === view.snapshot.project && memo.document === doc.path) {
          try {
            const current = preparePassage(view, {project: memo.project, document: doc.path, revision: view.revision.id,
              snapshot_hash: view.revision.snapshot_hash, token_ids: span.token_ids, question: memo.question});
            matches = JSON.stringify(current.groups) === JSON.stringify(groups);
          } catch { /* The saved passage can outlive its anchors. */ }
        }
        action.hidden = !matches;
        status.textContent = matches ? '' : `Showing the passage saved at R${memo.revision}. Its wording or source differs from the open transcript.`;
      };
    }
    library.append(row);
    count++;
  }
  heading.textContent = `Saved interpretations (${count})`;
  return count ? library : null;
}

interface Actions {
  read: () => void;
  reveal: (ids: string[]) => Promise<string>;
  listening: Listening;
  dirty: () => void;
  discard: (stale: boolean) => Promise<void>;
  save: (ops: Operation[], label: string, source: HTMLFormElement, basis: View) => Promise<void>;
}

export function coanalysisInspector(view: View, doc: Document, ids: string[], actions: Actions) {
  const panel = document.createElement('section');
  panel.className = 'coanalysis';
  const spanId = 'coanalysis-' + crypto.randomUUID();
  panel.dataset.spanId = spanId;
  const request: PassageRequest = {
    project: view.snapshot.project, revision: view.revision.id, snapshot_hash: view.revision.snapshot_hash,
    document: doc.path, token_ids: [...ids], question: lenses[0][1],
  };
  panel.innerHTML = `<h2 id="ca-heading">${icon('tune')}Transcript co-analysis</h2>`;
  const footer = `<p class="ca-credit">Inspired by Chuanqi Sun’s Spaceship IDE.</p>`;
  const history = savedMemos(view, doc, !ids.length, actions);
  let passage: ReturnType<typeof preparePassage>;
  try { passage = preparePassage(view, request); }
  catch (error) {
    const reason = !ids.length ? 'Select words in the transcript and choose Co-analyse. Drag a passage or tap its first word and choose Select through…' : (error as Error).message;
    panel.insertAdjacentHTML('beforeend', `<div class="ca-empty">${icon('notes')}<div><p>${esc(reason)}</p>
      <button type="button" class="secondary" data-read>Choose a passage</button></div></div>${footer}`);
    panel.querySelector<HTMLButtonElement>('[data-read]')!.onclick = actions.read;
    if (history) panel.querySelector('.ca-empty')!.before(history);
    return panel;
  }
  const groups = passage.groups;
  request.token_ids = groups.flatMap(group => group.tokens.map(token => token.id));
  panel.insertAdjacentHTML('beforeend', `
    <section class="ca-source" aria-label="Passage for co-analysis">
      <div class="ca-basis"><strong>${icon('link')}Saved passage</strong><span>R${view.revision.id} · ${ids.length} ${ids.length === 1 ? 'token' : 'tokens'}</span></div>
      ${groups.map(group => `<div class="ca-excerpt">${group.gap_before ? '<span aria-label="omitted tokens">[…]</span>' : ''}
        ${group.utterance ? `<small>${esc(group.utterance)}</small>` : ''}
        <blockquote>${group.tokens.map(token => esc(token.text)).join(' ')}</blockquote></div>`).join('')}
      <div class="ca-document">${esc(doc.title)}</div>
      <details><summary>Source anchors</summary><p>${esc(doc.path)}</p><p>${esc(request.token_ids.join(', '))}</p><small>Human-corrected reading with original text where a correction is absent.</small></details>
      <button type="button" class="secondary" data-listen-pinned aria-describedby="pinned-cue-basis">${icon('headphones')}Listen to pinned passage</button>
      <small id="pinned-cue-basis"></small>
    </section>
    <form id="coanalysis-form" data-dirty="false" aria-labelledby="ca-heading">
      <fieldset data-setup><legend>Ask about the passage</legend>
        <div class="ca-private">
          <label for="ca-first">Your first reading (optional)</label>
          <textarea id="ca-first" data-first-reading rows="2" maxlength="4000" aria-describedby="first-reading-help"></textarea>
          <small id="first-reading-help">Record your observations before opening the proposal. Only your annotation includes this reading.</small>
        </div>
        <fieldset class="ca-lenses" data-lens><legend>Analytical lens</legend>
          <div class="ca-lens-options">${lenses.map(([label, , symbol], i) => `<div class="ca-lens-option">
            <input type="radio" id="ca-lens-${i}" name="ca-lens" value="${i}" ${i === 0 ? 'checked' : ''}>
            <label for="ca-lens-${i}">${icon(symbol)}<span>${esc(label)}</span></label>
          </div>`).join('')}</div>
        </fieldset>
        <label>Research question<textarea data-question rows="3" maxlength="600" required></textarea></label>
        <details data-prompt-details><summary>Prompt for a local model</summary>
          <textarea data-prompt readonly rows="5" aria-label="Exact model prompt"></textarea>
          <button type="button" class="secondary" data-copy>Copy prompt</button>
        </details>
        ${desktop?.askLocalModel ? `<div class="ca-local"><button type="button" data-run>${icon('play_arrow')}Ask local model</button><small>Uses the model loaded at 127.0.0.1:8080.</small></div>` : ''}
        <details class="ca-manual" ${desktop?.askLocalModel ? '' : 'open'}><summary>Use a reply from your local model</summary>
          <label>Model name or version<input data-model maxlength="256" autocomplete="off"></label>
          <label>Model reply<textarea data-reply rows="4" maxlength="8000"></textarea></label>
          <button type="button" class="secondary" data-use>Review this reply</button>
        </details>
      </fieldset>
      <section data-review hidden>
        <h3 data-review-heading tabindex="-1">Compare readings</h3>
        <p class="ca-review-question" data-used-question></p>
        <div class="ca-reading" data-initial-comparison hidden><h4>${icon('notes')}Your first reading</h4><small>Recorded before opening the proposal here.</small><blockquote data-initial-text></blockquote></div>
        <div class="ca-reading ca-model"><h4>${icon('view_agenda')}Model proposal</h4><small data-by></small><blockquote data-proposal></blockquote></div>
        <div class="ca-judgment">
          <label>Your assessment<select data-decision required><option value="">Choose an assessment</option><option>Supported by the passage</option><option>Partly supported</option><option>Disagree</option><option>Needs more context</option></select></label>
          <label>Your interpretation<textarea data-interpretation maxlength="4000" rows="4" placeholder="Which words support or challenge the proposal?" required></textarea></label>
          <button type="submit" data-save disabled>${icon('fact_check')}Save reviewed annotation</button>
        </div>
      </section>
      <p data-status role="status"></p>
      <button type="button" class="secondary" data-discard hidden>Discard co-analysis draft</button>
    </form>${footer}`);

  const form = panel.querySelector('form')!;
  if (history) form.before(history);
  const listenButton = panel.querySelector<HTMLButtonElement>('[data-listen-pinned]')!;
  const cueBasis = panel.querySelector<HTMLElement>('#pinned-cue-basis')!;
  function refreshCue(){
    const cue = form.dataset.stale === 'true'
      ? {reason:'This pinned revision is out of date.'} : actions.listening.check(request);
    listenButton.disabled = 'reason' in cue;
    cueBasis.textContent = 'reason' in cue ? cue.reason : `Supplied ${cue.basis} timing · ${cue.start}–${cue.end} s`;
  }
  listenButton.onclick = () => { if(form.dataset.stale!=='true')void actions.listening.play(request,true); };
  panel.addEventListener('wb-cue-change',refreshCue);
  refreshCue();
  const find = <T extends HTMLElement>(name: string) => form.querySelector<T>(`[data-${name}]`)!;
  find('proposal').after(quoteCheck(groups));
  const question = find<HTMLTextAreaElement>('question'), preview = find<HTMLTextAreaElement>('prompt');
  const firstReading = find<HTMLTextAreaElement>('first-reading');
  const model = find<HTMLInputElement>('model'), reply = find<HTMLTextAreaElement>('reply');
  const decision = find<HTMLSelectElement>('decision'), interpretation = find<HTMLTextAreaElement>('interpretation');
  const discard = find<HTMLButtonElement>('discard'), save = find<HTMLButtonElement>('save');
  const setup = find<HTMLFieldSetElement>('setup'), status = find('status');
  let result: Pick<Memo, 'model' | 'proposal' | 'method' | 'first_reading'> | null = null;
  let waiting = false;
  question.value = request.question;
  preview.value = passage.prompt;
  const markDirty = () => {
    form.dataset.dirty = 'true';
    discard.hidden = false;
    actions.dirty();
  };
  const pinPrompt = () => {
    markDirty();
    question.readOnly = true;
    find<HTMLFieldSetElement>('lens').disabled = true;
  };
  function updatePrompt() {
    request.question = question.value.trim();
    try { preview.value = preparePassage(view, request).prompt; }
    catch { preview.value = ''; }
  }
  function refreshControls() {
    find<HTMLButtonElement>('copy').disabled = !preview.value;
    const run = form.querySelector<HTMLButtonElement>('[data-run]');
    if (run) run.disabled = !preview.value;
    find<HTMLButtonElement>('use').disabled = !preview.value || !model.value.trim() || !reply.value.trim();
    save.disabled = form.dataset.stale === 'true' || !result || !decision.value || !interpretation.value.trim();
  }
  form.addEventListener('wb-stale', () => {
    form.dataset.stale = 'true';
    refreshCue();
    status.textContent = 'This passage was analysed against an older revision. Discard this draft and reload the saved passage before analysing again.';
    refreshControls();
  });
  function review(name: string, proposal: string, method: Memo['method']) {
    result = {model: name, proposal, method, ...(firstReading.value && {first_reading: firstReading.value})};
    markDirty();
    setup.hidden = true;
    setup.disabled = true;
    find('review').hidden = false;
    find('initial-comparison').hidden = !result.first_reading;
    find('initial-text').textContent = result.first_reading ?? '';
    find('used-question').textContent = request.question;
    find('by').textContent = name + (method === 'llama.cpp' ? ' · Local llama.cpp' : ' · Manually supplied');
    find('proposal').textContent = proposal;
    status.textContent = '';
    refreshControls();
    find('review-heading').focus();
  }
  form.addEventListener('input', () => { markDirty(); updatePrompt(); refreshControls(); });
  find('lens').onchange = event => {
    const radio = event.target;
    if (!(radio instanceof HTMLInputElement)) return;
    question.value = lenses[Number(radio.value)][1];
    markDirty(); updatePrompt(); refreshControls();
  };
  find<HTMLButtonElement>('copy').onclick = async () => {
    pinPrompt();
    try { await navigator.clipboard.writeText(preview.value); status.textContent = 'Prompt copied for your local model.'; }
    catch { preview.focus(); preview.select(); status.textContent = 'Use Copy on the selected prompt.'; }
  };
  preview.addEventListener('copy', pinPrompt);
  find<HTMLButtonElement>('use').onclick = () => review(model.value.trim(), reply.value, 'manual');
  const run = form.querySelector<HTMLButtonElement>('[data-run]');
  if (run) run.onclick = async () => {
    if (waiting || !preview.value) return;
    markDirty();
    waiting = true; setup.disabled = true; discard.disabled = true;
    status.textContent = 'Waiting for the local model…';
    try {
      const answer = await desktop!.askLocalModel(request);
      review(answer.model, answer.reply, 'llama.cpp');
    } catch (error) { status.textContent = String(error); setup.disabled = false; }
    finally { waiting = false; discard.disabled = false; }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (!result || save.disabled || waiting) return;
    const memo: Memo = {format: 'corpus-workbench/coanalysis-1', revision: request.revision, snapshot_hash: request.snapshot_hash,
      project: request.project, document: request.document, prompt: preview.value,
      question: request.question, ...result, decision: decision.value, interpretation: interpretation.value.trim()};
    const note = JSON.stringify(memo);
    if (new TextEncoder().encode(note).length > 65536) {
      status.textContent = 'The reviewed record exceeds the 64 KiB annotation limit. Shorten your interpretation or begin with a shorter passage or model reply.';
      return;
    }
    await actions.save([{kind: 'add_span', document: doc.path, id: spanId, token_ids: request.token_ids,
      fields: {label: 'Co-analysis · ' + memo.decision, note}, character: null}],
      'Co-analysis · ' + memo.decision, form, view);
  };
  discard.onclick = async () => {
    try { await actions.discard(form.dataset.stale === 'true'); }
    catch (error) { status.textContent = String(error); }
  };
  refreshControls();
  return panel;
}
