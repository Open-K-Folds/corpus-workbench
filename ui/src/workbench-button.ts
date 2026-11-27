import {Mount} from '@effect/ui';
import {Stream} from 'effect';

// Workbench also hosts independently mounted editors. Listen on the shell button itself
// so the shell and an embedded region never dispatch the same browser activation twice.
const Pressed = Mount.makeStream('ActivateWorkbenchButton', {}, (button: HTMLButtonElement) =>
  Stream.fromEventListener(button, 'click').pipe(Stream.map(() => undefined)));

export function activate<Msg>(message: Msg) {
  return Pressed({}).pipe(Mount.map(() => message));
}
