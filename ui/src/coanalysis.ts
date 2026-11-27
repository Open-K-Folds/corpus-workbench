import {displayText, group, h, renderInto, viewFragment} from './effect-view';
import {preparePassage, type PassageRequest} from '../../desktop/coanalysis-prompt.mjs';
import type {Document, Operation, View} from './contracts';
import {desktop} from './desktop';
import {icon} from './icons';
import {savedExcerpt, type Memo} from './coanalysis-memo';
import {quoteCheck} from './quote-check';
import type {Listening} from './listening';
import './coanalysis.css';

const lenses = [
  ['Competing readings', 'What are two plausible readings of this passage, and which words support each?', 'view_agenda'],
  ['Language in context', 'Where might register or language use shift, and what would a speaker or listener need to clarify?', 'notes'],
  ['Follow-up questions', 'What question would help a researcher distinguish what is said here from what is being inferred?', 'search'],
] as const;

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
    renderInto(row,
      h.summary(
        h.span
          .class('ca-saved-quote')
          .children(displayText(quote || memo.question || 'Saved interpretation')),
        h.small(memo.decision, ' · R', displayText(memo.revision)),
        icon('chevron_right'),
      ),
      h.div
      .class('ca-saved-body')
      .children(
        h.strong('Researcher interpretation'),
        h.p(memo.interpretation),
        h.strong('Research question'),
        h.p(memo.question),
        memo.first_reading ? group(h.strong('Your first reading'), h.p(memo.first_reading)) : '',
        h.strong('Model proposal · ', memo.model),
        h.p(memo.proposal),
        h.details(
          h.summary('Original prompt and source'),
          h.p(memo.project, ' · ', memo.document, ' · R', displayText(memo.revision)),
          h.p(span.token_ids.join(', ')),
          h.code(memo.snapshot_hash),
          h.p(memo.prompt),
          h.small(memo.method === 'llama.cpp' ? 'Local llama.cpp' : 'Manually supplied reply'),
        ),
      ),
    );
    if (groups) {
      const action = document.createElement('button');
      action.className = 'secondary';
      action.type = 'button';
      action.hidden = true;
      renderInto(action,
        icon('menu_book'),
        'Show in transcript',
      );
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
  renderInto(panel, h.h2.id('ca-heading').children(icon('tune'), 'Transcript co-analysis'));
  const footer = h.p.class('ca-credit').children('Inspired by Chuanqi Sun’s Spaceship IDE.');
  const history = savedMemos(view, doc, !ids.length, actions);
  let passage: ReturnType<typeof preparePassage>;
  try { passage = preparePassage(view, request); }
  catch (error) {
    const reason = !ids.length ? 'Select words in the transcript and choose Co-analyse. Drag a passage or tap its first word and choose Select through…' : (error as Error).message;
    panel.append(
      viewFragment(
        group(
          h.div
            .class('ca-empty')
            .children(
              icon('notes'),
              h.div(
                h.p(reason),
                h.button.class('secondary').attrs({type: 'button', 'data-read': ''}).children('Choose a passage'),
              ),
            ),
          footer,
        ),
      ),
    );
    panel.querySelector<HTMLButtonElement>('[data-read]')!.onclick = actions.read;
    if (history) panel.querySelector('.ca-empty')!.before(history);
    return panel;
  }
  const groups = passage.groups;
  request.token_ids = groups.flatMap(group => group.tokens.map(token => token.id));
  panel.append(
    viewFragment(
      group(
        h.section
          .class('ca-source')
          .attrs({'aria-label': 'Passage for co-analysis'})
          .children(
            h.div
              .class('ca-basis')
              .children(
                h.strong(icon('link'), 'Saved passage'),
                h.span(
                  'R',
                  String(view.revision.id),
                  ' · ',
                  String(ids.length),
                  ' ',
                  ids.length === 1 ? 'token' : 'tokens',
                ),
              ),
            groups.map((group) =>
              h.div
                .class('ca-excerpt')
                .children(
                  group.gap_before ? h.span.attrs({'aria-label': 'omitted tokens'}).children('[…]') : '',
                  group.utterance ? h.small(displayText(group.utterance)) : '',
                  h.blockquote(String(group.tokens.map((token) => displayText(token.text)).join(' '))),
                ),
            ),
            h.div.class('ca-document').children(doc.title),
            h.details(
              h.summary('Source anchors'),
              h.p(doc.path),
              h.p(displayText(request.token_ids.join(', '))),
              h.small('Human-corrected reading with original text where a correction is absent.'),
            ),
            h.button
              .class('secondary')
              .attrs({type: 'button', 'data-listen-pinned': '', 'aria-describedby': 'pinned-cue-basis'})
              .children(icon('headphones'), 'Listen to pinned passage'),
            h.small.id('pinned-cue-basis'),
          ),
        h.form
          .id('coanalysis-form')
          .attrs({'data-dirty': 'false', 'aria-labelledby': 'ca-heading'})
          .children(
            h.fieldset.attrs({'data-setup': ''}).children(
              h.legend('Ask about the passage'),
              h.div
                .class('ca-private')
                .children(
                  h.label.attrs({for: 'ca-first'}).children('Your first reading (optional)'),
                  h.textarea
                    .id('ca-first')
                    .attrs({
                      'data-first-reading': '',
                      rows: '2',
                      maxlength: '4000',
                      'aria-describedby': 'first-reading-help',
                    }),
                  h.small
                    .id('first-reading-help')
                    .children(
                      'Record your observations before opening the proposal. Only your annotation includes this reading.',
                    ),
                ),
              h.fieldset
                .class('ca-lenses')
                .attrs({'data-lens': ''})
                .children(
                  h.legend('Analytical lens'),
                  h.div
                    .class('ca-lens-options')
                    .children(
                      lenses.map(([label, , symbol], i) =>
                        h.div
                          .class('ca-lens-option')
                          .children(
                            h.input
                              .id('ca-lens-' + String(i))
                              .attrs({
                                type: 'radio',
                                name: 'ca-lens',
                                value: String(i),
                                checked: i === 0 ? '' : undefined,
                              }),
                            h.label.attrs({for: 'ca-lens-' + String(i)}).children(icon(symbol), h.span(label)),
                          ),
                      ),
                    ),
                ),
              h.label(
                'Research question',
                h.textarea.attrs({'data-question': '', rows: '3', maxlength: '600', required: ''}),
              ),
              h.details
                .attrs({'data-prompt-details': ''})
                .children(
                  h.summary('Prompt for a local model'),
                  h.textarea.attrs({
                    'data-prompt': '',
                    readonly: '',
                    rows: '5',
                    'aria-label': 'Exact model prompt',
                  }),
                  h.button.class('secondary').attrs({type: 'button', 'data-copy': ''}).children('Copy prompt'),
                ),
              desktop?.askLocalModel
                ? h.div
                    .class('ca-local')
                    .children(
                      h.button
                        .attrs({type: 'button', 'data-run': ''})
                        .children(icon('play_arrow'), 'Ask local model'),
                      h.small('Uses the model loaded at 127.0.0.1:8080.'),
                    )
                : '',
              h.details
                .class('ca-manual')
                .attrs({open: desktop?.askLocalModel ? undefined : ''})
                .children(
                  h.summary('Use a reply from your local model'),
                  h.label(
                    'Model name or version',
                    h.input.attrs({'data-model': '', maxlength: '256', autocomplete: 'off'}),
                  ),
                  h.label('Model reply', h.textarea.attrs({'data-reply': '', rows: '4', maxlength: '8000'})),
                  h.button
                    .class('secondary')
                    .attrs({type: 'button', 'data-use': ''})
                    .children('Review this reply'),
                ),
            ),
            h.section.attrs({'data-review': '', hidden: ''}).children(
              h.h3.attrs({'data-review-heading': '', tabindex: '-1'}).children('Compare readings'),
              h.p.class('ca-review-question').attrs({'data-used-question': ''}),
              h.div
                .class('ca-reading')
                .attrs({'data-initial-comparison': '', hidden: ''})
                .children(
                  h.h4(icon('notes'), 'Your first reading'),
                  h.small('Recorded before opening the proposal here.'),
                  h.blockquote.attrs({'data-initial-text': ''}),
                ),
              h.div
                .class('ca-reading ca-model')
                .children(
                  h.h4(icon('view_agenda'), 'Model proposal'),
                  h.small.attrs({'data-by': ''}),
                  h.blockquote.attrs({'data-proposal': ''}),
                ),
              h.div
                .class('ca-judgment')
                .children(
                  h.label(
                    'Your assessment',
                    h.select
                      .attrs({'data-decision': '', required: ''})
                      .children(
                        h.option.attrs({value: ''}).children('Choose an assessment'),
                        h.option('Supported by the passage'),
                        h.option('Partly supported'),
                        h.option('Disagree'),
                        h.option('Needs more context'),
                      ),
                  ),
                  h.label(
                    'Your interpretation',
                    h.textarea.attrs({
                      'data-interpretation': '',
                      maxlength: '4000',
                      rows: '4',
                      placeholder: 'Which words support or challenge the proposal?',
                      required: '',
                    }),
                  ),
                  h.button
                    .attrs({type: 'submit', 'data-save': '', disabled: ''})
                    .children(icon('fact_check'), 'Save reviewed annotation'),
                ),
            ),
            h.p.attrs({'data-status': '', role: 'status'}),
            h.button
              .class('secondary')
              .attrs({type: 'button', 'data-discard': '', hidden: ''})
              .children('Discard co-analysis draft'),
          ),
        footer,
      ),
    ),
  );

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
