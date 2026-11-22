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

function savedMemos(doc: Document) {
  const items: string[] = [];
  for (const span of doc.spans) {
    if (!span.id.startsWith('coanalysis-')) continue;
    try {
      const memo = JSON.parse(span.fields.note) as Memo;
      if (memo?.format !== 'corpus-workbench/coanalysis-1') continue;
      items.push(`<details class="ca-saved"><summary>${esc(memo.decision)} · ${esc(span.token_ids.join(', '))}</summary>
        <p>${esc(memo.question)}</p>
        ${memo.first_reading ? `<strong>Your first reading</strong><p>${esc(memo.first_reading)}</p><small>Recorded before opening the proposal here.</small>` : ''}
        <strong>Model proposal · ${esc(memo.model)}</strong><p>${esc(memo.proposal)}</p>
        <strong>Researcher interpretation</strong><p>${esc(memo.interpretation)}</p>
        <small>Based on saved R${esc(memo.revision)} · ${memo.method === 'llama.cpp' ? 'Local llama.cpp' : 'Manually supplied reply'}</small>
        <details><summary>Original prompt and source</summary><p>${esc(memo.project)} · ${esc(memo.document)} · R${esc(memo.revision)}</p><code>${esc(memo.snapshot_hash)}</code><p>${esc(memo.prompt)}</p></details></details>`);
    } catch { /* Other imported span notes can contain plain text. */ }
  }
  return items.length ? `<section class="ca-history"><h3>Saved interpretations (${items.length})</h3>${items.join('')}</section>` : '';
}

interface Actions {
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
  let passage: ReturnType<typeof preparePassage>;
  try { passage = preparePassage(view, request); }
  catch (error) {
    const reason = !ids.length ? 'Select a word in the transcript. Shift-click another word to analyse a passage.' : (error as Error).message;
    panel.insertAdjacentHTML('beforeend', `<p class="ca-empty">${icon('notes')}<span>${esc(reason)}</span></p>${savedMemos(doc)}${footer}`);
    return panel;
  }
  const groups = passage.groups;
  request.token_ids = groups.flatMap(group => group.tokens.map(token => token.id));
  panel.insertAdjacentHTML('beforeend', `
    <section class="ca-source" aria-label="Passage for co-analysis">
      <div class="ca-basis"><strong>${icon('link')}Saved passage</strong><span>R${view.revision.id} · ${ids.length} ${ids.length === 1 ? 'token' : 'tokens'}</span></div>
      <div class="ca-document">${esc(doc.title)}<small>${esc(doc.path)}</small></div>
      ${groups.map(group => `<div class="ca-excerpt">${group.gap_before ? '<span aria-label="omitted tokens">[…]</span>' : ''}
        ${group.utterance ? `<small>${esc(group.utterance)}</small>` : ''}
        <blockquote>${group.tokens.map(token => esc(token.text)).join(' ')}</blockquote></div>`).join('')}
      <details><summary>Source anchors</summary><p>${esc(request.token_ids.join(', '))}</p><small>Human-corrected reading with original text where a correction is absent.</small></details>
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
    </form>${savedMemos(doc)}${footer}`);

  const form = panel.querySelector('form')!;
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
