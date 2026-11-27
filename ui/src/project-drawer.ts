import type {WorkspaceSummary} from './workbench-view';
import {h} from './effect-view';
import {icon} from './icons';
import {buttonGroup} from './controls';
import projectFilesUrl from 'virtual:workbench-project-files-url';
import type {FileNavigation, ProjectFileSnapshot, mountProjectFiles} from './project-files';
import './project-drawer.css';

export function projectDrawerBody(summary: WorkspaceSummary) {
  return h.div
    .class('project-drawer-body')
    .children(
      h.div
        .class('project-identity')
        .children(
          h.span.class('project-mark').children(icon('library_books')),
          h.div(h.h2.id('drawer-project-title').children(summary.project), h.span.id('package-count').children(String(summary.documents), summary.documents === 1 ? ' document' : ' documents')),
        ),
      h.div.id('local-project-actions'),
      h.div.id('project-files'),
      h.details
        .class('project-preservation')
        .children(
          h.summary(icon('fact_check'), 'Package preservation', icon('expand_more')),
          h.div.id('package-report').children(h.p(String(summary.files), ' preserved files'), h.p(summary.indexStatus), h.p(summary.rights), h.p('Unknown structures: ', summary.unknown)),
        ),
    );
}

export function bindProjectFiles(container: HTMLElement, signal: AbortSignal,
  snapshot: () => ProjectFileSnapshot, onNavigate: (event: FileNavigation) => void) {
  let update: ReturnType<typeof mountProjectFiles> | undefined;
  let loading = false;
  let attempts = 0;
  const refresh = () => update?.(snapshot());

  async function open() {
    if (update || loading || signal.aborted) return;
    loading = true;
    const retry = container.querySelector<HTMLButtonElement>('button');
    const url = new URL(projectFilesUrl, document.baseURI);
    if (attempts > 0) url.searchParams.set('retry', String(attempts));
    attempts++;
    container.setAttribute('aria-busy', 'true');
    try {
      const {mountProjectFiles}: typeof import('./project-files') = await import(/* @vite-ignore */ url.href);
      if (signal.aborted) return;
      const returnFocus = !!retry && document.activeElement === retry;
      container.replaceChildren();
      update = mountProjectFiles(container, signal, snapshot(), onNavigate);
      buttonGroup(container.querySelector('nav')!);
      if (returnFocus) container.querySelector<HTMLInputElement>('#navigation-query')?.focus();
    } catch {
      if (!signal.aborted && !retry) {
        const error = document.createElement('p');
        error.setAttribute('role', 'alert');
        error.textContent = 'Project files could not load.';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.textContent = 'Retry project files';
        button.addEventListener('click', open, {signal});
        container.replaceChildren(error, button);
      }
    } finally {
      loading = false;
      container.removeAttribute('aria-busy');
    }
  }
  return {open, refresh};
}
