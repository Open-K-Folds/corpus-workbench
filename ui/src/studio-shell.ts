import {group, h} from './effect-view';
import {icon, type SymbolName} from './icons';

export function windowBar(projectOpen:boolean, project = '') {
  return h.header
    .class('window-bar workbench-header')
    .children(
      h.div
        .class('window-identity')
        .children(
          h.span.class('window-mark').children(icon('orbit')),
          projectOpen ? h.h1('Corpus Workbench') : h.span.class('window-name').children('Corpus Workbench'),
        ),
      projectOpen
        ? group(
            h.span.class('window-divider').attrs({'aria-hidden': 'true'}).children('/'),
            h.button
              .id('window-library')
              .attrs({
                type: 'button',
                'aria-controls': 'projects-pane',
                'aria-expanded': 'false',
                title: 'Browse project files',
              })
              .children(
                h.span.id('project-title').children(project),
                h.span.class('sr-only').children(' — Browse project files'),
                icon('expand_more'),
              ),
            h.span.id('save-state').attrs({role: 'status'}),
          )
        : '',
    );
}

function railButton(id:string, symbol:SymbolName, label:string, attributes: Record<string, string> = {}) {
  const visibleLabel = label.replace(/^Open (.)/, (_, first:string) => first.toUpperCase());
  return h.button
    .class('rail-button')
    .id(id)
    .attrs({type: 'button', 'aria-label': label, title: label, ...attributes})
    .children(icon(symbol), h.span.class('rail-label').attrs({'aria-hidden': 'true'}).children(visibleLabel));
}

export function activityRail() {
  return h.nav
    .class('studio-rail')
    .attrs({'aria-label': 'Workspace tools'})
    .children(
      h.button
        .class('rail-button')
        .id('rail-toggle')
        .attrs({
          type: 'button',
          'aria-label': 'Expand sidebar',
          title: 'Expand sidebar',
          'aria-expanded': 'false',
          'aria-controls': 'rail-commands',
        })
        .children(
          icon('left_panel_open'),
          h.span.class('rail-label').attrs({'aria-hidden': 'true'}).children('Collapse sidebar'),
        ),
      h.div
        .id('rail-commands')
        .children(
          h.div
            .class('rail-destinations')
            .children(
              railButton('rail-reading', 'menu_book', 'Transcript', {'aria-pressed': 'true'}),
              railButton(
                'toggle-navigation',
                'folder_open',
                'Projects',
                {'aria-controls': 'projects-pane', 'aria-expanded': 'false'},
              ),
              railButton('rail-search', 'search', 'Open corpus search', {'data-inspect': 'search'}),
              h.hr,
              railButton('rail-coanalysis', 'auto_awesome', 'Open co-analysis', {'data-inspect': 'coanalysis'}),
              railButton(
                'rail-training',
                'library_books',
                'Open training collections',
                {'data-inspect': 'training'},
              ),
              railButton(
                'toggle-properties',
                'tune',
                'Tools',
                {'aria-controls': 'properties-pane', 'aria-expanded': 'false'},
              ),
              railButton('rail-review', 'fact_check', 'Open revision review', {'data-inspect': 'review'}),
              railButton('rail-history', 'history', 'Open revision history', {'data-inspect': 'history'}),
              h.hr,
              railButton('open-overview', 'graphic_eq', 'Research overview'),
              railButton('open-research', 'link', 'Research handoff'),
            ),
          h.div
            .class('rail-utilities')
            .children(
              railButton('export-package', 'download', 'Export complete package'),
              railButton('toggle-theme', 'light_mode', 'Dark appearance', {'aria-pressed': 'true'}),
              railButton('workspace-options', 'settings', 'Workspace settings', {'aria-haspopup': 'dialog'}),
            ),
        ),
    );
}

export function drawerClose(side:'navigation'|'properties') {
  const label=side==='navigation'?'Close project files':'Close inspector';
  return h.button
    .class('drawer-close pane-return')
    .attrs({type: 'button', 'data-close-drawer': side, title: label})
    .children(
      icon('close'),
      h.span.class('sr-only drawer-desktop-name').children(label),
      h.span.class('sr-only drawer-phone-name').children('Back to transcript'),
    );
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
  return h.dialog
    .id('workspace-settings')
    .class('studio-settings')
    .attrs({'aria-labelledby': 'workspace-settings-title'})
    .children(
      h.div
        .class('studio-dialog-heading')
        .children(
          h.h2.id('workspace-settings-title').children('Workspace settings'),
          h.form
            .attrs({method: 'dialog'})
            .children(
              h.button.class('secondary').attrs({'aria-label': 'Close workspace settings'}).children('Close'),
            ),
        ),
      h.fieldset(
        h.legend('Workspace layout'),
        h.label(h.input.attrs({type: 'radio', name: 'studio-layout', value: 'stage'}), ' Transcript stage'),
        h.label(
          h.input.attrs({type: 'radio', name: 'studio-layout', value: 'editing'}),
          ' Transcript with library and tools',
        ),
      ),
      h.h3('Keyboard'),
      h.dl(
        h.div(h.dt('Find in transcript'), h.dd(h.kbd('Ctrl / ⌘ K'))),
        h.div(h.dt('Next match'), h.dd(h.kbd('F3'))),
        h.div(h.dt('Inspector tools'), h.dd(h.kbd('Alt 1–9'))),
      ),
      h.footer('Interaction design inspired by Chuanqi Sun’s Spaceship IDE, MIT Media Lab. ', h.span('2026')),
    );
}

export function initialLayout(): 'stage'|'editing' {
  try {return localStorage.getItem('wb-studio-layout')==='editing' ? 'editing' : 'stage'} catch {return 'stage'}
}
