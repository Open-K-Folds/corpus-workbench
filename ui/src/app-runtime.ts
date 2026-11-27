import {Effect, Exit, Scope} from 'effect';

// Each browser or desktop screen has one renderer lifetime. A replaced screen may still
// be releasing an asynchronous command, so retire its mount point with it.
let screenLifetime: AbortController | undefined;

export function runComponent<A>(mount: Effect.Effect<A, never, Scope.Scope>, signal: AbortSignal): A {
  const scope = Effect.runSync(Scope.make());
  const close = () => { Effect.runFork(Scope.close(scope, Exit.void)); };
  signal.throwIfAborted();
  signal.addEventListener('abort', close, {once: true});
  try {
    return Effect.runSync(Scope.provide(mount, scope));
  } catch (error) {
    signal.removeEventListener('abort', close);
    close();
    throw error;
  }
}

export function mountScreen<A>(host: HTMLElement, mount: (stage: HTMLElement, signal: AbortSignal) => A): A {
  screenLifetime?.abort();
  screenLifetime = new AbortController();
  const stage = document.createElement('div');
  stage.className = 'screen-mount';
  host.replaceChildren(stage);
  return mount(stage, screenLifetime.signal);
}
