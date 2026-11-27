import {anchoredReading, annotationDetail, isMeaningSpan} from './annotation-detail';
import type {Document, Operation, Span, View} from './contracts';
import {dictionaryCredit, dictionaryNotice, lookupEnglish, termKey} from './english-dictionary';
import {h, renderInto} from './effect-view';
import {icon} from './icons';
import './meanings.css';

type AddSpan = Extract<Operation, {kind:'add_span'}>;
export type MeaningRange = AddSpan['character'] | {reason: string};
type Passage = {doc: Document; span: Span};
const libraries = new WeakMap<View, {passages:Passage[]; labels:string[]}>();

function projectMeanings(view: View) {
  let library = libraries.get(view);
  if (!library) {
    const passages = view.documents.flatMap(doc => doc.spans
      .filter(span => isMeaningSpan(span) && span.fields.label?.trim())
      .map(span => ({doc, span})));
    const terms = new Map<string,string>();
    for (const {span} of passages) {
      const label = span.fields.label, key = termKey(label);
      if (!terms.has(key)) terms.set(key, label);
    }
    library = {passages, labels:[...terms.values()].sort((a,b) => a.localeCompare(b))};
    libraries.set(view, library);
  }
  return library;
}

function dictionaryPicker(input: HTMLInputElement, container: HTMLElement) {
  let lookup = 0;
  let senses: Awaited<ReturnType<typeof lookupEnglish>> = [];
  renderInto(container,
    h.p.class('dictionary-status').attrs({role:'status'}),
    h.div.class('dictionary-match').attrs({hidden:''}).children(
      h.p.class('dictionary-gloss'),
      h.details(
        h.summary(),
        h.label('Sense for this passage (optional)', h.select.attrs({name:'sense'})),
        h.a.attrs({href:dictionaryNotice, target:'_blank', rel:'noopener'}).children(dictionaryCredit),
      ),
    ),
  );
  const status = container.querySelector<HTMLElement>('.dictionary-status')!;
  const match = container.querySelector<HTMLElement>('.dictionary-match')!;
  const select = match.querySelector('select')!;
  function showSense() {
    const chosen = senses.find(sense => sense.id === select.value);
    renderInto(match.querySelector('.dictionary-gloss')!,
      h.strong(chosen ? 'Selected sense' : 'Dictionary example'), ' · ', (chosen ?? senses[0]).definition);
  }
  select.onchange = showSense;
  async function update() {
    const ticket = ++lookup;
    senses = [];
    status.textContent = '';
    match.hidden = true;
    match.querySelector('details')!.open = false;
    select.replaceChildren();
    container.hidden = !input.value.trim();
    if (!input.value.trim()) return;
    try {
      const found = await lookupEnglish(input.value);
      if (lookup !== ticket) return;
      senses = found;
      if (!senses.length) {
        status.textContent = 'You can save this as a project term.';
        return;
      }
      renderInto(select,
        h.option.attrs({value:''}).children('Save just the label'),
        senses.map(sense => h.option.attrs({value:sense.id}).children(sense.part + ' · ' + sense.definition)),
      );
      match.querySelector('summary')!.textContent = senses.length === 1 ? '1 dictionary sense' : senses.length + ' dictionary senses';
      showSense();
      match.hidden = false;
    } catch {
      if (lookup === ticket) status.textContent = 'Dictionary unavailable. You can still save your label.';
    }
  }
  input.addEventListener('input', () => void update());
  return () => {
    const sense = senses.find(item => item.id === select.value);
    return sense ? sense.definition + '\n' + dictionaryCredit + ' · ' + sense.id : '';
  };
}

export function meaningInspector(view: View, doc: Document, selected: string[], range: MeaningRange,
  save: (ops: Operation[], label: string, form: HTMLFormElement) => Promise<void>,
  dirty: () => void, open: (passage: Passage) => void, chooseWords: () => void) {
  const panel = document.createElement('section');
  panel.className = 'meanings-panel';
  const {passages, labels} = projectMeanings(view);
  const reading = anchoredReading(doc, selected);
  const issue = range && 'reason' in range ? range.reason : '';
  const character = range && 'token' in range ? range : null;
  const quote = character?.quote ?? reading.currentQuote;
  const ids = new Set(reading.ids);
  const savedHere = reading.known && !issue ? doc.spans.flatMap(span => {
    if (!isMeaningSpan(span) || !span.fields.label?.trim() || span.token_ids.length !== ids.size ||
        !span.token_ids.every(id => ids.has(id))) return [];
    const detail = annotationDetail(doc, span, view.snapshot.project);
    if (!detail.tokenIds.length || (character &&
        (detail.character?.start !== character.start || detail.character.end !== character.end))) return [];
    return [{span, detail}];
  }) : [];
  const savedSpans = new Set(savedHere.map(({span}) => span));
  const compose = reading.known && !issue ? h.form.id('meaning-form').children(
      h.blockquote.attrs({dir:'auto', 'aria-label':'Selected words'}).children(quote),
      h.label('English meaning', h.input.attrs({name:'meaning', placeholder:'e.g. school', required:'',
        list:'project-meaning-labels', autocomplete:'off', maxlength:'512'})),
      h.datalist.id('project-meaning-labels').children(labels.map(label => h.option.attrs({value:label}))),
      h.button.class('secondary use-quoted-label').attrs({type:'button', hidden:''}).children(quote.length <= 64 ? 'Use “' + quote + '”' : ''),
      h.div.class('meaning-dictionary').attrs({hidden:''}),
      h.div.class('meaning-actions').children(h.button.attrs({type:'submit', disabled:''}).children('Save meaning')),
    ) : h.div.class('choose-meaning-passage').children(
      h.p(issue || 'Select the words you want to label in the transcript.'),
      h.button.class('secondary').attrs({type:'button'}).children('Choose words in transcript'),
    );
  renderInto(panel,
    h.h2('Meaning labels'),
    savedHere.length ? h.section.class('saved-meanings').attrs({'aria-labelledby':'saved-meanings-title'}).children(
      h.h3.id('saved-meanings-title').children(icon('check'), savedHere.length === 1 ? 'Saved meaning' : 'Saved meanings'),
      savedHere.map(({span, detail}) => h.div.class('saved-meaning').children(
        h.strong.attrs({'data-saved-meaning':span.id, tabindex:'-1', dir:'auto'}).children(detail.title),
        h.blockquote.attrs({dir:'auto', 'aria-label':'Labelled words'}).children(detail.quote),
        detail.note ? h.p.class('saved-meaning-note').attrs({dir:'auto'}).children(detail.note) : h.div.class('saved-dictionary'),
        h.button.class('secondary').attrs({type:'button'}).children('Show in transcript'),
      )),
    ) : '',
    savedHere.length ? h.details.class('another-meaning').children(
      h.summary(!character && savedHere.every(({detail}) => detail.character) ? 'Label the whole word' : 'Add another meaning'),
      compose,
    ) : compose,
    passages.length > savedHere.length ? h.h3('Labelled passages') : '',
    passages.length ? h.div.class('meaning-library').children(
      h.label('Find a meaning', h.input.attrs({type:'search', placeholder:'Search across transcripts', autocomplete:'off'})),
      h.ul(), h.p.class('meaning-match-count').attrs({'aria-live':'polite'}),
      h.button.class('secondary').attrs({type:'button', hidden:''}).children('Show more passages'),
    ) : '',
  );
  panel.querySelector<HTMLButtonElement>('.choose-meaning-passage button')?.addEventListener('click', chooseWords);
  panel.querySelectorAll<HTMLElement>('.saved-meaning').forEach((item, index) => {
    const {span} = savedHere[index];
    item.querySelector('button')!.onclick = () => open({doc, span});
    const dictionary = item.querySelector('.saved-dictionary');
    if (dictionary) void lookupEnglish(span.fields.label).then(senses => {
      if (!senses.length) return;
      renderInto(dictionary, h.details(
        h.summary('English dictionary'),
        h.ol(senses.map(sense => h.li(h.small(sense.part + ' · '), sense.definition))),
        h.a.attrs({href:dictionaryNotice, target:'_blank', rel:'noopener'}).children(dictionaryCredit),
      ));
    }).catch(() => {});
  });
  const form = panel.querySelector('form');
  if (form) {
    const input = form.elements.namedItem('meaning') as HTMLInputElement;
    const another = form.closest('details');
    if (another) another.ontoggle = () => {
      if (another.open && another.querySelector('summary') === document.activeElement) input.focus();
    };
    const note = dictionaryPicker(input, form.querySelector<HTMLElement>('.meaning-dictionary')!);
    const useQuote = form.querySelector<HTMLButtonElement>('.use-quoted-label')!;
    let knownQuote = false;
    if (quote.length <= 64 && quote.trim()) {
      void lookupEnglish(quote).then(senses => {
        knownQuote = senses.length > 0;
        useQuote.hidden = !knownQuote || !!input.value;
      }).catch(() => {});
    }
    useQuote.onclick = () => {
      input.value = quote;
      input.dispatchEvent(new Event('input', {bubbles:true}));
      input.focus();
    };
    const update = () => {
      const entered = !!input.value.trim();
      useQuote.hidden = !knownQuote || !!input.value;
      form.dataset.dirty = String(entered);
      form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = !entered;
      dirty();
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.onsubmit = async event => {
      event.preventDefault();
      const label = input.value.trim();
      if (!label) return;
      const fields: Record<string,string> = {label};
      const sense = note();
      if (sense) fields.note = sense;
      const characters = Array.from(label);
      const summary = characters.length > 100 ? characters.slice(0,100).join('') + '…' : label;
      const id = 'meaning-' + crypto.randomUUID();
      form.dataset.submittedMeaning = id;
      await save([{kind:'add_span', document:doc.path, id,
        token_ids:selected, fields, character}], 'Label meaning · ' + summary, form);
    };
  }
  const library = panel.querySelector<HTMLElement>('.meaning-library');
  if (library) {
    const filter = library.querySelector('input')!, more = library.querySelector('button')!;
    const list = library.querySelector('ul')!, count = library.querySelector('p')!;
    let limit = 20;
    function showMatches() {
      const query = termKey(filter.value);
      const matches = passages.filter(({span}) => query ? termKey(span.fields.label).includes(query) : !savedSpans.has(span));
      const shown = matches.slice(0, limit);
      renderInto(list, shown.map(({doc, span}, i) => {
        const detail = annotationDetail(doc, span, view.snapshot.project);
        return h.li(h.button.class('meaning-passage').attrs({type:'button', 'data-match':String(i)}).children(
          h.strong(span.fields.label), h.span.attrs({dir:'auto'}).children(detail.quote), h.small(doc.title || doc.path),
        ));
      }));
      const total = matches.length + (!query && savedSpans.size ? ' other' : '') + (matches.length === 1 ? ' passage' : ' passages');
      count.textContent = !matches.length ? (query ? 'No matching passages.' : '') : shown.length === matches.length ? total : 'Showing ' + shown.length + ' of ' + total;
      more.hidden = shown.length === matches.length;
      list.onclick = event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-match]');
        if (button) open(shown[Number(button.dataset.match)]);
      };
    }
    filter.oninput = () => { limit = 20; showMatches(); };
    more.onclick = () => { limit += 20; showMatches(); };
    showMatches();
  }
  return panel;
}
