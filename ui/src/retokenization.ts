import {api} from './api';
import type {Document, InventoryEnvelope, Operation, Reading, RetokenizeRequest, StructuralPreview, View} from './contracts';
import {esc, field, formValues} from './dom';
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
    panel.innerHTML = '<h2>Split or merge</h2><p>Select one word to split it, or two adjacent words to merge them.</p>';
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
    `<fieldset class="structure-row" data-field="${key}"><legend>${label}</legend><div class="structure-columns">
      ${values.map((value, i) => `<input name="${key}_${i}" aria-label="${accessibleLabel} ${i + 1}" value="${esc(value)}" autocomplete="off"${key === 'id' ? ' spellcheck="false"' : ''}>`).join('')}
    </div></fieldset>`;

  const readings = layers.filter(([layer]) => tokens[0][layer] !== null).map(([layer, label]) => {
    const values = split ? splitValue(tokens[0][layer]!) : [tokens.map(token => token[layer] ?? '').join('')];
    return editorRow(layer, label, label + ' layer', values);
  }).join('');
  const hasIncoming = split && inv.carriers.some(carrier => carrier.qname === 'relation_target' &&
    carrier.targets.some(target => target.artifact === doc.path && target.id === tokens[0].id));

  panel.innerHTML = `
    <div class="structure-heading"><h2>${title}</h2><span>R${inv.revision}</span></div>
    <div class="structure-source"><small>Selected ${split ? 'token' : 'tokens'}</small>
      <p>${tokens.map(token => esc(token.original)).join(' ')}</p><code>${esc(ids)}</code>
    </div>
    <form id="structural-form" class="${split ? 'split' : 'merge'}">
      <div class="structure-columns structure-column-titles">${split ? '<span>First token</span><span>Second token</span>' : '<span>Merged token</span>'}</div>
      ${readings}
      ${editorRow('id', 'Token ID', 'New token ID', positions.map(i => tokens[0].id + (split ? '-part-' + (i + 1) : '-merged')))}
      <details class="structure-settings"${hasIncoming ? ' open' : ''}><summary>Revision settings</summary>
        ${split ? '<label>Assign incoming links to<select name="endpoint"><option value="">Choose a token if needed</option><option value="0">First token</option><option value="1">Second token</option></select></label>' : ''}
        ${field('revision_label', 'Revision name', (split ? 'Split ' : 'Merge ') + ids)}
      </details>
      <div class="structure-decision">
        <p id="structural-status" role="status" aria-live="polite"></p>
        <div id="structural-result"></div>
        <button id="preview-structure" type="submit">${icon('fact_check')}Preview ${verb}</button>
        <button id="commit-structure" type="button" disabled hidden>${icon('check')}Apply ${verb}</button>
      </div>
    </form>
    <details class="structure-evidence" hidden><summary>Inspect package changes</summary>
      <div class="structure-files"></div><details><summary>Full proof</summary><pre id="structural-proof"></pre></details>
    </details>`;

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
        const messages: string[] = [];
        for (const reason of checked.blockers) {
          if (reason !== 'replacement would lose or alter a text layer') {
            messages.push(esc(reason));
          } else if (!split) {
            messages.push('Preserve the original text and its spacing in every merged reading.');
          } else {
            for (const [layer, label] of layers) {
              const original = tokens[0][layer];
              if (original === null || replacement.map(part => part[layer]).join('') === original) continue;
              messages.push(`<span id="structure-error-${layer}">${label} must join to <strong>${esc(original)}</strong>.</span>`);
              form.querySelectorAll(`[data-field="${layer}"] input`).forEach(input => {
                input.setAttribute('aria-invalid', 'true');
                input.setAttribute('aria-describedby', 'structure-error-' + layer);
              });
            }
          }
        }
        summary.innerHTML = `<ul class="structure-blockers">${messages.map(reason => `<li>${reason}</li>`).join('')}</ul>`;
        return;
      }

      panel.dataset.stage = 'ready';
      status.textContent = `Ready to apply · checked R${inv.revision}`;
      summary.innerHTML = `<div class="structure-outcome">${replacement.map(token => `<span>${esc(token.original)}</span>`).join('')}</div>`;
      files.innerHTML = `<ul>${Object.entries(checked.mapping).map(([old, mapped]) =>
        `<li>${esc(old)} → ${mapped.map(esc).join(', ')}</li>`).join('')}</ul>
        ${Object.entries(checked.candidate_xml).map(([path, text]) =>
          `<details><summary>${esc(path)}</summary><pre>${esc(text)}</pre></details>`).join('')}
        <p>Lineage file<br><code>${esc(checked.lineage_path)}</code></p>`;
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
