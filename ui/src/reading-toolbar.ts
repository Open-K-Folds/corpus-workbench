import {icon} from './icons';
import './reading-toolbar.css';

export function readingToolbar(){
  return `<div class="stage-actions">
    <details class="reading-settings">
      <summary>${icon('tune')}Reading controls${icon('expand_more')}</summary>
      <div class="reader-sheet" data-reader-section="display">
        <div id="reader-section-switch" role="group" aria-label="Reading settings sections">
          <button type="button" aria-controls="reader-display" aria-pressed="true">Display</button>
          <button type="button" aria-controls="reader-source" aria-pressed="false">Source</button>
        </div>
        <section id="reader-display" aria-labelledby="reader-display-heading" class="reader-display">
          <div class="reader-section-heading"><h2 id="reader-display-heading">Text display</h2>
            <button type="button" id="reading-guide-button" class="reader-text-command" popovertarget="reading-guide" aria-label="Selection guide" title="Selection guide">${icon('keyboard')}<span>Selection guide</span></button>
          </div>
          <fieldset id="transcript-layout" class="segmented-radio"><legend class="sr-only">Text layout</legend><label><input type="radio" name="layout" value="paragraphs" aria-label="Flowing paragraphs" checked><span>${icon('notes')}Flow</span></label><label><input type="radio" name="layout" value="lines" aria-label="Source lines"><span>${icon('view_agenda')}Lines</span></label></fieldset>
          <label class="switch-field interlinear-toggle"><input id="show-interlinear" type="checkbox" role="switch"><span>Interlinear</span></label>
          <div class="reader-layer-field"><label class="reader-layer" for="reading-layer">Reading layer</label>
          <select id="reading-layer"><option value="corrected">Human-corrected</option><option value="original">Original source</option><option value="normalized">Normalized fallback</option></select></div>
        </section>
        <section id="reader-source" aria-labelledby="reader-source-heading" class="reader-source">
          <h2 id="reader-source-heading">Source reference</h2>
          <form id="source-jump-form" class="reader-input-group">
            <label for="source-location" class="sr-only">Go to source</label>
            <input id="source-location" placeholder="Utterance or token ID" autocomplete="off" required>
            <button id="jump-source" type="submit" aria-label="Go" title="Go to source">${icon('arrow_forward')}</button>
          </form>
          <div class="reader-source-actions"><button id="copy-citation" class="reader-text-command">${icon('link')}Copy link</button><button id="native-problems" class="reader-text-command">Package checks</button></div>
          <p id="source-location-status" role="status"></p>
        </section>
      </div>
    </details>
    <div class="reading-status">
      <button id="find-in-transcript" class="secondary" aria-label="Find in transcript" aria-expanded="false" aria-controls="reader-find" title="Find in transcript (Ctrl / ⌘ K)">${icon('search')}<span>Find</span></button>
      <button id="open-reading-canvas" class="secondary" aria-expanded="false" aria-controls="tokens" aria-label="Focus mode (Open reading canvas)" title="Focus mode">${icon('center_focus_strong')}<span>Focus mode</span></button>
    </div>
    <section id="reader-find" aria-label="Find in transcript" hidden>
      <div class="reader-input-group reader-query"><label class="sr-only" for="token-query">Find tokens</label>${icon('search')}<input id="token-query" type="search" autocomplete="off" placeholder="Find by reading, ID or variety"></div>
      <label class="sr-only" for="token-filter">Token filter</label>
      <select id="token-filter"><option value="all">All tokens</option><option value="corrected">With corrections</option><option value="untimed">Without word timing</option><option value="attention">Needs attention</option></select>
      <div class="reader-find-results">
        <span id="reading-match-count" role="status" aria-atomic="true"></span>
        <button id="next-match" class="reader-text-command" aria-label="Next match" title="Next match (F3)" hidden>${icon('skip_next')}</button>
        <button id="clear-token-search" class="reader-text-command" aria-label="Clear search and filters" title="Close find and clear filters">${icon('close')}</button>
      </div>
    </section>
    <aside id="reading-guide" popover aria-labelledby="reading-guide-title">
      <div class="reader-section-heading"><h2 id="reading-guide-title">Selection guide</h2><button type="button" class="reader-text-command" popovertarget="reading-guide" popovertargetaction="hide" aria-label="Close selection guide">${icon('close')}</button></div>
      <dl id="selection-help">
        <dt>Select a passage</dt><dd>Drag across words, or click the first word, choose <strong>Select through</strong> and click the last word.</dd>
        <dt>Open selection tools</dt><dd>Tap the selected count, right-click, or press <kbd>Shift</kbd> + <kbd>F10</kbd>.</dd>
        <dt>Choose a training lens</dt><dd>Press and hold a word.</dd>
        <dt>Clear the selection</dt><dd>Click away or press <kbd>Esc</kbd>.</dd>
      </dl>
    </aside>
  </div>`;
}
