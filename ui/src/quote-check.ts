import {h, renderInto} from './effect-view';
import type {preparePassage} from '../../desktop/coanalysis-prompt.mjs';

type Groups = ReturnType<typeof preparePassage>['groups'];
type Match = {utterance: string | null; ids: string[]};

/** Match the exact saved token spellings with the same single separator as the passage display. */
export function literalMatches(groups: Groups, phrase: string): Match[] {
  const matches: Match[] = [];
  if (!phrase.trim()) return matches;
  for (const {utterance, tokens} of groups) {
    for (let start = 0; start < tokens.length; start++) {
      let candidate = '';
      for (let end = start; end < tokens.length; end++) {
        candidate += (end === start ? '' : ' ') + tokens[end].text;
        if (!phrase.startsWith(candidate)) break;
        if (candidate === phrase) {
          matches.push({utterance, ids: tokens.slice(start, end + 1).map(token => token.id)});
          break;
        }
      }
    }
  }
  return matches;
}

function anchorLabel(match: Match) {
  return [match.utterance, match.ids.join(', ')].filter(Boolean).join(' · ');
}

export function quoteCheck(groups: Groups): HTMLDetailsElement {
  const details = document.createElement('details');
  renderInto(details,
    h.summary('Check a quoted phrase'),
    h.label('Quoted phrase', h.textarea.attrs({rows: '2', spellcheck: 'false'})),
    h.small('Enter complete tokens from the pinned passage. Keep their spacing, case and punctuation.'),
    h.button.class('secondary').attrs({type: 'button', disabled: ''}).children('Check quote'),
    h.label.attrs({hidden: ''}).children('Matching occurrence', h.select),
    h.p.attrs({role: 'status'}),
  );
  const input = details.querySelector('textarea')!, check = details.querySelector('button')!;
  const choices = details.querySelector('select')!, choose = choices.closest('label')!;
  const status = details.querySelector('p')!;
  let matches: Match[] = [];
  input.oninput = event => {
    event.stopPropagation();
    check.disabled = !input.value.trim();
    choose.hidden = true;
    matches = [];
    status.textContent = '';
  };
  check.onclick = () => {
    matches = literalMatches(groups, input.value);
    choose.hidden = matches.length < 2;
    if (!matches.length) {
      status.textContent = 'No literal match in the pinned passage.';
    } else if (matches.length === 1) {
      status.textContent = 'Literal match · ' + anchorLabel(matches[0]);
    } else {
      choices.replaceChildren(new Option('Choose an occurrence', ''));
      matches.forEach((match, index) => choices.add(new Option(anchorLabel(match), String(index))));
      status.textContent = `${matches.length} literal matches. Choose an occurrence.`;
    }
  };
  choices.onchange = () => {
    status.textContent = choices.value === '' ? `${matches.length} literal matches. Choose an occurrence.`
      : 'Selected literal match · ' + anchorLabel(matches[Number(choices.value)]);
  };
  return details;
}
