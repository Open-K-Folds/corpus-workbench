import type {View as UiView} from '@effect/ui';
import {displayText, group, h, renderInto} from './effect-view';
import {api} from './api';
import type {Document, InventoryEnvelope, Operation, Reading, RetokenizeRequest, StructuralPreview, View} from './contracts';
import {field, formValues} from './dom';
import {icon} from './icons';
import './retokenization.css';

type Layer = 'original' | 'corrected' | 'normalized';
const layers: [Layer, string][] = [['original', 'Original'], ['corrected', 'Corrected'], ['normalized', 'Normalized']];

function splitValue(value: string) {
  const chars = Array.from(value);
  const middle = Math.max(1, Math.floor(chars.length / 2));
  return [chars.slice(0, middle).join(''), chars.slice(middle).join('')];
}

export async function retokenizationInspector(
  view: View, doc: Document, selected: string[],
  onSave: (ops: Operation[], label: string, source?: HTMLFormElement) => Promise<void>,
  onDirty: () => void,
): Promise<HTMLElement> {
  const panel = document.createElement('section');
  panel.className = 'structure-panel';
  const tokens = doc.tokens.filter(token => selected.includes(token.id));
  if (tokens.length !== 1 && tokens.length !== 2) {
    renderInto(panel,
      h.h2('Split or merge'),
      h.p('Select one word to split it, or two adjacent words to merge them.'),
    );
    return panel;
  }

  const result = await api<InventoryEnvelope>(`/api/inventory?revision=${view.revision.id}`);
  const inv = result.inventory;
  if (inv.revision !== view.revision.id || inv.snapshot_hash !== view.revision.snapshot_hash) {
    throw new Error('Structural inventory revision mismatch');
  }

  const split = tokens.length === 1;
  const verb = split ? 'split' : 'merge';
  const title = split ? 'Split token' : 'Merge tokens';
  const ids = tokens.map(token => token.id).join(' + ');
  const targets = tokens.map(token => inv.ids.find(target => target.artifact === doc.path && target.id === token.id));
  const positions = split ? [0, 1] : [0];
  const editorRow = (key: string, label: string, accessibleLabel: string, values: string[]) =>
    h.fieldset
      .class('structure-row')
      .attrs({'data-field': key})
      .children(
        h.legend(label),
        h.div
          .class('structure-columns')
          .children(
            values.map((value, i) =>
              h.input.attrs({
                name: key + '_' + String(i),
                'aria-label': accessibleLabel + ' ' + String(i + 1),
                value: value,
                autocomplete: 'off',
                spellcheck: key === 'id' ? 'false' : undefined,
              }),
            ),
          ),
      );

  const readings = layers
    .filter(([layer]) => tokens[0][layer] !== null)
    .map(([layer, label]) => {
      const values = split
        ? splitValue(tokens[0][layer]!)
        : [tokens.map((token) => token[layer] ?? '').join('')];
      return editorRow(layer, label, label + ' layer', values);
    });
  const hasIncoming = split && inv.carriers.some(carrier => carrier.qname === 'relation_target' &&
    carrier.targets.some(target => target.artifact === doc.path && target.id === tokens[0].id));

  renderInto(panel,
    h.div.class('structure-heading').children(h.h2(title), h.span('R', String(inv.revision))),
    h.div
    .class('structure-source')
    .children(
      h.small('Selected ', split ? 'token' : 'tokens'),
      h.p(tokens.map((token) => token.original).join(' ')),
      h.code(ids),
    ),
    h.form
    .id('structural-form')
    .class(split ? 'split' : 'merge')
    .children(
      h.div
        .class('structure-columns structure-column-titles')
        .children(split ? group(h.span('First token'), h.span('Second token')) : h.span('Merged token')),
      readings,
      editorRow(
        'id',
        'Token ID',
        'New token ID',
        positions.map((i) => tokens[0].id + (split ? '-part-' + (i + 1) : '-merged')),
      ),
      h.details
        .class('structure-settings')
        .attrs({open: hasIncoming ? '' : undefined})
        .children(
          h.summary('Revision settings'),
          split
            ? h.label(
                'Assign incoming links to',
                h.select
                  .attrs({name: 'endpoint'})
                  .children(
                    h.option.attrs({value: ''}).children('Choose a token if needed'),
                    h.option.attrs({value: '0'}).children('First token'),
                    h.option.attrs({value: '1'}).children('Second token'),
                  ),
              )
            : '',
          field('revision_label', 'Revision name', (split ? 'Split ' : 'Merge ') + ids),
        ),
      h.div
        .class('structure-decision')
        .children(
          h.p.id('structural-status').attrs({role: 'status', 'aria-live': 'polite'}),
          h.div.id('structural-result'),
          h.button
            .id('preview-structure')
            .attrs({type: 'submit'})
            .children(icon('fact_check'), 'Preview ', verb),
          h.button
            .id('commit-structure')
            .attrs({type: 'button', disabled: '', hidden: ''})
            .children(icon('check'), 'Apply ', verb),
        ),
    ),
    h.details
    .class('structure-evidence')
    .attrs({hidden: ''})
    .children(
      h.summary('Inspect package changes'),
      h.div.class('structure-files'),
      h.details(h.summary('Full proof'), h.pre.id('structural-proof')),
    ),
  );

  const form = panel.querySelector<HTMLFormElement>('#structural-form')!;
  const preview = panel.querySelector<HTMLButtonElement>('#preview-structure')!;
  const commit = panel.querySelector<HTMLButtonElement>('#commit-structure')!;
  const status = panel.querySelector<HTMLElement>('#structural-status')!;
  const summary = panel.querySelector<HTMLElement>('#structural-result')!;
  const details = panel.querySelector<HTMLDetailsElement>('.structure-evidence')!;
  const files = panel.querySelector<HTMLElement>('.structure-files')!;
  const proof = panel.querySelector<HTMLElement>('#structural-proof')!;
  let pending: StructuralPreview | null = null;
  let epoch = 0;

  function resetPreview() {
    pending = null;
    commit.hidden = true;
    commit.disabled = true;
    preview.hidden = false;
    preview.removeAttribute('aria-disabled');
    delete panel.dataset.stage;
    details.hidden = true;
    details.open = false;
    form.querySelectorAll('[aria-invalid]').forEach(input => {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    });
    proof.textContent = '';
    files.replaceChildren();
    summary.replaceChildren();
  }

  const dirty = () => {
    const hadPreview = !!panel.dataset.stage;
    form.dataset.dirty = 'true';
    ++epoch;
    resetPreview();
    if (hadPreview) status.textContent = 'Draft changed. Preview it again.';
    onDirty();
  };
  form.addEventListener('input', dirty);
  form.addEventListener('change', dirty);

  form.onsubmit = async event => {
    event.preventDefault();
    if (panel.dataset.stage === 'checking' || pending?.preview.execution_enabled) return;
    const turn = ++epoch;
    resetPreview();
    const values = formValues(form);
    if (targets.some(target => !target)) {
      status.textContent = 'A selected token is missing from the package inventory.';
      return;
    }
    const replacement: Reading[] = positions.map(i => ({
      id: values['id_' + i], original: values['original_' + i],
      corrected: tokens[0].corrected === null ? null : values['corrected_' + i],
      normalized: tokens[0].normalized === null ? null : values['normalized_' + i],
    }));
    const request: RetokenizeRequest = {
      schema: 1, project: inv.project, revision: inv.revision, snapshot_hash: inv.snapshot_hash,
      config_hash: inv.config_hash, inventory_hash: result.inventory_hash, document: doc.path,
      targets: targets as RetokenizeRequest['targets'], replacement,
      relation_endpoint: split && values.endpoint !== '' ? replacement[Number(values.endpoint)].id : null,
    };
    panel.dataset.stage = 'checking';
    preview.setAttribute('aria-disabled', 'true');
    status.textContent = 'Checking readings and package references…';
    try {
      const response = await api<StructuralPreview>('/api/retokenize-preview', request);
      if (turn !== epoch) return;
      const checked = response.preview;
      pending = response;
      details.hidden = false;
      proof.textContent = JSON.stringify(response, null, 2);
      preview.removeAttribute('aria-disabled');
      if (!checked.execution_enabled) {
        panel.dataset.stage = 'blocked';
        status.textContent = 'Blocked. Resolve the following before applying.';
        const messages: Array<string | UiView.Content<never>> = [];
        for (const reason of checked.blockers) {
          if (reason !== 'replacement would lose or alter a text layer') {
            messages.push(reason);
          } else if (!split) {
            messages.push('Preserve the original text and its spacing in every merged reading.');
          } else {
            for (const [layer, label] of layers) {
              const original = tokens[0][layer];
              if (original === null || replacement.map(part => part[layer]).join('') === original) continue;
              messages.push(h.span
                .id('structure-error-' + layer)
                .children(label, ' must join to ', h.strong(original), '.'));
              form.querySelectorAll(`[data-field="${layer}"] input`).forEach(input => {
                input.setAttribute('aria-invalid', 'true');
                input.setAttribute('aria-describedby', 'structure-error-' + layer);
              });
            }
          }
        }
        renderInto(summary, h.ul.class('structure-blockers').children(messages.map((reason) => h.li(reason))));
        return;
      }

      panel.dataset.stage = 'ready';
      status.textContent = `Ready to apply · checked R${inv.revision}`;
      renderInto(summary,
        h.div.class('structure-outcome').children(replacement.map((token) => h.span(token.original))),
      );
      renderInto(files,
        h.ul(
          Object.entries(checked.mapping).map(([old, mapped]) =>
            h.li(old, ' → ', mapped.map(displayText).join(', ')),
          ),
        ),
        Object.entries(checked.candidate_xml).map(([path, text]) => h.details(h.summary(path), h.pre(text))),
        h.p('Lineage file', h.br, h.code(displayText(checked.lineage_path))),
      );
      const focused = document.activeElement === preview;
      preview.hidden = true;
      commit.hidden = false;
      commit.disabled = false;
      if (focused) commit.focus({preventScroll: true});
    } catch (error) {
      if (turn !== epoch) return;
      resetPreview();
      status.textContent = String(error);
    }
  };

  commit.onclick = async () => {
    if (commit.disabled || !pending?.preview.execution_enabled) return;
    const approved = pending;
    commit.disabled = true;
    await onSave([{kind: 'retokenize', request: approved.preview.request, preview_hash: approved.preview_hash}],
      formValues(form).revision_label, form);
    if (form.isConnected) {
      resetPreview();
      status.textContent = 'See the save message before previewing again.';
    }
  };
  return panel;
}
