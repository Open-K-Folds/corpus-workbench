function builtAssets(page: Document) {
  const entry = page.querySelector('script[type="module"][src^="/assets/index-"][src$=".js"]')?.getAttribute('src');
  if (!entry || !page.getElementById('app')) return null;
  const styles = [...page.querySelectorAll('link[rel="stylesheet"][href^="/assets/"]')];
  return [entry, ...styles.map(link => link.getAttribute('href'))].join('\n');
}

export function watchPreviewUpdates(footer: HTMLElement, signal: AbortSignal) {
  const loaded = builtAssets(document);
  if (!loaded) return;

  const notice = document.createElement('div');
  notice.className = 'preview-update sr-only';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'secondary';
  refresh.textContent = 'Refresh';
  refresh.setAttribute('aria-label','Refresh to load update');
  refresh.hidden = true;
  refresh.addEventListener('click', () => location.reload(), {signal});
  notice.append(status, refresh);
  footer.append(notice);

  let checking = false;
  async function check() {
    if (document.hidden || checking || !refresh.hidden) return;
    checking = true;
    try {
      const response = await fetch('/index.html', {
        cache:'no-store', redirect:'error', signal:AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok || !response.headers.get('Content-Type')?.includes('text/html')) return;
      const next = builtAssets(new DOMParser().parseFromString(await response.text(), 'text/html'));
      if (next && next !== loaded && !signal.aborted) {
        notice.classList.remove('sr-only');
        status.textContent = 'Update ready';
        refresh.hidden = false;
        clearInterval(timer);
      }
    } catch {
      // An offline tab or an in-flight deployment can check again later.
    } finally {
      checking = false;
    }
  }
  const timer = window.setInterval(check, 60_000);
  signal.addEventListener('abort', () => clearInterval(timer), {once:true});
  document.addEventListener('visibilitychange', check, {signal});
  void check();
}
