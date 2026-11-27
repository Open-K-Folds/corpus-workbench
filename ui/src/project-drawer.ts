import type {WorkspaceSummary} from './workbench-view';
import {h} from './effect-view';
import {icon} from './icons';
import {buttonGroup} from './controls';
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
  let started = false;
  const refresh = () => update?.(snapshot());

  async function open() {
    if (started) return;
    started = true;
    container.setAttribute('aria-busy', 'true');
    try {
      const {mountProjectFiles} = await import('./project-files');
      if (signal.aborted) return;
      update = mountProjectFiles(container, signal, snapshot(), onNavigate);
      buttonGroup(container.querySelector('nav')!);
    } catch {
      if (!signal.aborted) {
        container.setAttribute('role', 'alert');
        container.textContent = 'Project files could not load. Refresh the workbench to try again.';
      }
    } finally {
      container.removeAttribute('aria-busy');
    }
  }
  return {open, refresh};
}
