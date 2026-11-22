import {icon, type SymbolName} from './icons';

export function windowBar(projectOpen:boolean) {
  return `<header class="window-bar workbench-header">
    <div class="window-identity"><span class="window-mark">${icon('orbit')}</span>${projectOpen ? '<h1>Corpus Workbench</h1>' : '<span class="window-name">Corpus Workbench</span>'}</div>
    ${projectOpen ? `<span class="window-divider" aria-hidden="true">/</span><button type="button" id="window-library" aria-label="Browse project library" title="Browse project library"><span id="project-title"></span>${icon('expand_more')}</button><span id="save-state" role="status"></span>` : ''}
  </header>`;
}

function railButton(id:string, symbol:SymbolName, label:string, attributes='') {
  return `<button type="button" class="rail-button" id="${id}" aria-label="${label}" title="${label}" ${attributes}>${icon(symbol)}</button>`;
}

export function activityRail() {
  return `<nav class="studio-rail" aria-label="Workspace tools">
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
  </nav>`;
}

export function workspaceSettings() {
  return `<dialog id="workspace-settings" class="studio-settings" aria-labelledby="workspace-settings-title">
    <div class="studio-dialog-heading"><h2 id="workspace-settings-title">Workspace settings</h2><form method="dialog"><button class="secondary" aria-label="Close workspace settings">Close</button></form></div>
    <fieldset><legend>Opening layout</legend>
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
