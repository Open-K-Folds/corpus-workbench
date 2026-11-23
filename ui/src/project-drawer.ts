import {icon} from './icons';
import './project-drawer.css';

export function projectDrawerBody() {
  return `<div class="project-drawer-body">
    <div class="project-identity">
      <span class="project-mark">${icon('library_books')}</span>
      <div><h2 id="drawer-project-title"></h2><span id="package-count"></span></div>
    </div>
    <div id="local-project-actions"></div>
    <nav class="navigation-modes project-tabs" aria-label="Corpus sections">
      <button type="button" id="navigate-documents" aria-controls="document-list" aria-pressed="true">${icon('book_2')}Documents</button>
      <button type="button" id="navigate-sources" aria-controls="source-list" aria-pressed="false">${icon('folder_open')}Sources</button>
    </nav>
    <div class="project-filter">
      <label class="sr-only" for="navigation-query">Find documents or sources</label>${icon('search')}
      <input id="navigation-query" type="search" autocomplete="off" placeholder="Filter files">
      <button type="button" id="clear-navigation" aria-label="Clear filter" title="Clear filter" hidden>${icon('close')}</button>
    </div>
    <div id="document-list"></div><div id="source-list" hidden></div>
    <details class="project-preservation"><summary>${icon('fact_check')}Package preservation${icon('expand_more')}</summary><div id="package-report"></div></details>
  </div>`;
}
