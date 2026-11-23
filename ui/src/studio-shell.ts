import {icon, type SymbolName} from './icons';

export function windowBar(projectOpen:boolean) {
  return `<header class="window-bar workbench-header">
    <div class="window-identity"><span class="window-mark">${icon('orbit')}</span>${projectOpen ? '<h1>Corpus Workbench</h1>' : '<span class="window-name">Corpus Workbench</span>'}</div>
    ${projectOpen ? `<span class="window-divider" aria-hidden="true">/</span><button type="button" id="window-library" aria-controls="projects-pane" aria-expanded="false" title="Browse project files"><span id="project-title"></span><span class="sr-only"> — Browse project files</span>${icon('expand_more')}</button><span id="save-state" role="status"></span>` : ''}
  </header>`;
}

function railButton(id:string, symbol:SymbolName, label:string, attributes='') {
  const visibleLabel = label.replace(/^Open (.)/, (_, first:string) => first.toUpperCase());
  return `<button type="button" class="rail-button" id="${id}" aria-label="${label}" title="${label}" ${attributes}>${icon(symbol)}<span class="rail-label" aria-hidden="true">${visibleLabel}</span></button>`;
}

export function activityRail() {
  return `<nav class="studio-rail" aria-label="Workspace tools">
    <button type="button" class="rail-button" id="rail-toggle" aria-label="Expand sidebar" title="Expand sidebar" aria-expanded="false" aria-controls="rail-commands">
      ${icon('left_panel_open')}<span class="rail-label" aria-hidden="true">Collapse sidebar</span>
    </button>
    <div id="rail-commands">
      <div class="rail-destinations">
        ${railButton('rail-reading','menu_book','Transcript','aria-pressed="true"')}
        ${railButton('toggle-navigation','folder_open','Projects','aria-controls="projects-pane" aria-expanded="false"')}
        ${railButton('rail-search','search','Open corpus search','data-inspect="search"')}
        <hr>
        ${railButton('rail-coanalysis','auto_awesome','Open co-analysis','data-inspect="coanalysis"')}
        ${railButton('rail-training','library_books','Open training collections','data-inspect="training"')}
        ${railButton('toggle-properties','tune','Tools','aria-controls="properties-pane" aria-expanded="false"')}
        ${railButton('rail-review','fact_check','Open revision review','data-inspect="review"')}
        ${railButton('rail-history','history','Open revision history','data-inspect="history"')}
        <hr>
        ${railButton('open-overview','graphic_eq','Research overview')}
        ${railButton('open-research','link','Research handoff')}
      </div>
      <div class="rail-utilities">
        ${railButton('export-package','download','Export complete package')}
        ${railButton('toggle-theme','light_mode','Dark appearance','aria-pressed="true"')}
        ${railButton('workspace-options','settings','Workspace settings','aria-haspopup="dialog"')}
      </div>
    </div>
  </nav>`;
}

/** Pin labels beside a wide workspace. On smaller screens the same rail overlays it. */
export function bindActivityRail(app:HTMLElement, signal:AbortSignal) {
  const rail = app.querySelector<HTMLElement>('.studio-rail')!;
  const toggle = rail.querySelector<HTMLButtonElement>('#rail-toggle')!;
  const symbol = toggle.querySelector<HTMLElement>('.material-symbol')!;
  const compact = matchMedia('(max-width: 1120px)');
  let pinned = false;
  try { pinned = localStorage.getItem('wb-rail-expanded') === 'true' } catch { /* Optional preference. */ }

  function display(expanded:boolean) {
    app.toggleAttribute('data-rail-expanded',expanded);
    toggle.setAttribute('aria-expanded',String(expanded));
    toggle.title = expanded ? 'Collapse sidebar' : 'Expand sidebar';
    toggle.setAttribute('aria-label',toggle.title);
    symbol.textContent = expanded ? 'left_panel_close' : 'left_panel_open';
  }
  function overlayOpen() { return compact.matches && app.hasAttribute('data-rail-expanded') }
  function restore() { display(!compact.matches && pinned) }
  restore();
  compact.addEventListener('change',restore,{signal});
  toggle.addEventListener('click',() => {
    const expanded = !app.hasAttribute('data-rail-expanded');
    if (!compact.matches) {
      pinned = expanded;
      try { localStorage.setItem('wb-rail-expanded',String(expanded)) } catch { /* Optional preference. */ }
    }
    display(expanded);
  },{signal});
  rail.addEventListener('click',event => {
    const command = (event.target as Element).closest('button');
    if (overlayOpen() && command && command !== toggle) display(false);
  },{signal});
  function dismissOutside(event:Event) {
    if (overlayOpen() && !rail.contains(event.target as Node)) display(false);
  }
  document.addEventListener('pointerdown',dismissOutside,{capture:true,signal});
  document.addEventListener('focusin',dismissOutside,{signal});
  window.addEventListener('keydown',event => {
    if (event.key !== 'Escape' || !overlayOpen()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    display(false);
    toggle.focus({preventScroll:true});
  },{capture:true,signal});
}

export function workspaceSettings() {
  return `<dialog id="workspace-settings" class="studio-settings" aria-labelledby="workspace-settings-title">
    <div class="studio-dialog-heading"><h2 id="workspace-settings-title">Workspace settings</h2><form method="dialog"><button class="secondary" aria-label="Close workspace settings">Close</button></form></div>
    <fieldset><legend>Workspace layout</legend>
      <label><input type="radio" name="studio-layout" value="stage"> Transcript stage</label>
      <label><input type="radio" name="studio-layout" value="editing"> Transcript with library and tools</label>
    </fieldset>
    <h3>Keyboard</h3>
    <dl><div><dt>Find in transcript</dt><dd><kbd>Ctrl / ⌘ K</kbd></dd></div><div><dt>Next match</dt><dd><kbd>F3</kbd></dd></div><div><dt>Inspector tools</dt><dd><kbd>Alt 1–9</kbd></dd></div></dl>
    <footer>Interaction design inspired by Chuanqi Sun’s Spaceship IDE, MIT Media Lab. <span>2026</span></footer>
  </dialog>`;
}

export function initialLayout(): 'stage'|'editing' {
  try {return localStorage.getItem('wb-studio-layout')==='editing' ? 'editing' : 'stage'} catch {return 'stage'}
}
