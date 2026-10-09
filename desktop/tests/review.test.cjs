'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

// Exercise project departure/reconnection with native Electron APIs replaced
// by deterministic doubles; the real Electron smoke tests cover the window.
function mainHarness() {
  const sent = [], handlers = new Map();
  const backend = {
    ready: {project: 'old'},
    attempts: [], failures: 1,
    async stop() { this.ready = null; },
    async start(store, project) {
      this.attempts.push({store, project});
      if (this.failures > 0) { this.failures--; throw new Error('Synthetic open failure'); }
      this.ready = {store, project};
    },
  };
  const original = {id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', store: path.resolve('old-authority'), project: 'same-project', title: 'Original authority'};
  const next = {id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', store: path.resolve('next-authority'), project: 'same-project', title: 'New authority'};
  const window = {
    isDestroyed: () => false, focus() {}, setTitle() {},
    reload() { sent.push({channel: 'reload'}); },
    webContents: {mainFrame: {url: 'workbench://app/'}, send: (channel, value) => sent.push({channel, value})},
  };
  const registry = {publicRecent: () => [], async remember(store, project, title) { return {...next, store, project, title}; }};
  const electron = {
    app: {setName() {}, getAppPath: () => path.resolve(__dirname, '../..'), getVersion: () => 'test'},
    protocol: {registerSchemesAsPrivileged() {}},
    ipcMain: {handle: (name, fn) => handlers.set(name, fn)},
    dialog: {showMessageBox: async () => ({response: 1})},
  };
  const context = vm.createContext({
    console, Buffer, URL, Response, Headers, AbortSignal,
    process: {env: {}, platform: process.platform, resourcesPath: ''},
    // Departure status has already been delivered by the renderer in this test.
    setTimeout: fn => { queueMicrotask(fn); return 0; }, clearTimeout() {},
    __dirname: path.resolve(__dirname, '..'),
    require: name => name === 'electron' ? electron : ['./backend.cjs', './registry.cjs', './journal.cjs'].includes(name) ? {} : name === './security.cjs' ? require('../security.cjs') : require(name),
    testBackend: backend, testWindow: window, testRegistry: registry, testOriginal: original,
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  const standalone = source.slice(0, source.indexOf("\napp.on('before-quit'"));
  vm.runInContext(standalone + '\nbackend=testBackend;window=testWindow;registry=testRegistry;current=testOriginal;status="ready";installIPC();globalThis.review={switchProject,publicState};', context);
  return {context, sent, handlers, original, next, backend, window};
}

test('failed switch cannot reconnect a different authority behind the existing transcript', async () => {
  const h = mainHarness();
  await h.context.review.switchProject(h.next);
  const retry = h.handlers.get('workbench:retry');
  await retry({sender: h.window.webContents, senderFrame: h.window.webContents.mainFrame});
  const ready = h.context.review.publicState();
  assert.equal(ready.status, 'ready');
  const keptOriginal = ready.project.title === h.original.title && h.backend.ready.store === h.original.store;
  const reloaded = h.sent.some(message => message.channel === 'reload');
  assert.ok(keptOriginal || reloaded, 'A new authority requires a renderer reload; same-authority recovery may retain the current draft and view');
});

test('failed switch and failed rollback keep retry bound to the displayed authority', async () => {
  const h = mainHarness();
  h.backend.failures = 2;
  await h.context.review.switchProject(h.next);
  assert.equal(h.context.review.publicState().status, 'error');
  assert.equal(h.context.review.publicState().project.title, h.original.title);
  await h.handlers.get('workbench:retry')({sender: h.window.webContents, senderFrame: h.window.webContents.mainFrame});
  assert.equal(h.context.review.publicState().status, 'ready');
  assert.equal(h.backend.ready.store, h.original.store);
});

test('saving replacement registry data preserves the malformed original for inspection', async () => {
  const {Registry} = require('../registry.cjs');
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'workbench-review-registry-'));
  const original = '{"schema":1,"recent":"unrecognized saved metadata"}';
  try {
    await fs.promises.writeFile(path.join(root, 'desktop-projects.json'), original);
    const registry = new Registry(root);
    await assert.rejects(() => registry.load());
    // Main saves window bounds at shutdown even when registry loading failed.
    // Either refusing that save or preserving a backup keeps unknown data safe.
    try { await registry.save(); } catch { /* A blocked save is also safe. */ }
    const preserved = (await fs.promises.readdir(root)).some(name => fs.readFileSync(path.join(root, name), 'utf8') === original);
    assert.ok(preserved, 'Registry error recovery must retain the original bytes');
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.promises.rm(root, {recursive: true, force: true});
  }
});

function draftHarness() {
  const ts = require('../../ui/node_modules/typescript');
  const journal = new Map();
  const native = {raw: null, failNext: false, writes: 0};
  const storage = {failBackup: false, getItem: key => journal.get(key) ?? null, setItem(key, value) { if (this.failBackup && key.startsWith('wb-correction-v1:unflushed-')) throw new Error('Synthetic storage quota failure'); journal.set(key, value); }, removeItem: key => journal.delete(key), key: index => [...journal.keys()][index], get length() { return journal.size; }};
  const exported = {};
  const context = vm.createContext({
    exports: exported, module: {exports: exported}, console,
    crypto: require('node:crypto').webcrypto,
    localStorage: storage,
    navigator: {locks: {request: async (_name, run) => run()}},
    window: {workbenchDesktop: {
      readDraftJournal: async () => native.raw,
      persistDraftJournal: async raw => {native.writes++; if (native.failNext) {native.failNext = false; throw new Error('Synthetic transient native write failure');} native.raw = raw; return true;},
    }},
    require: name => name === './api' ? {draftContext: () => ({authority: 'a'.repeat(64), actor: 'local-owner', project: 'preview'})} : require(name),
  });
  const source = fs.readFileSync(path.join(__dirname, '../../ui/src/draft-storage.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
  vm.runInContext(compiled, context);
  const record = {schema: 1, id: 'draft-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', authority: 'a'.repeat(64), actor: 'local-owner', project: 'preview', document: 'xmlfiles/test.xml', revision: 1, snapshot: 'b'.repeat(64), artifact: 'c'.repeat(64), config: 1, layer: 'corrected', ids: ['w1'], internalIds: ['internal-w1'], readings: ['word'], start: 0, end: 4, backward: false, quote: 'word', before: 'word', prefix: '', suffix: '', replacement: 'first', command: null, updated: 1};
  return {api: exported, native, storage, record};
}

test('transient native journal failure does not poison the correction persistence retry', async () => {
  const h = draftHarness();
  assert.equal(await h.api.initializeNativeDrafts(), '');
  assert.equal(await h.api.writeDraft(h.record), '');
  const changed = {...h.record, replacement: 'second', updated: 2};
  h.native.failNext = true;
  assert.notEqual(await h.api.writeDraft(changed, h.record), '');
  assert.equal(await h.api.writeDraft(changed, h.record), '', 'A failed native barrier must leave the same correction retryable');
  assert.equal(JSON.parse(h.native.raw)[h.record.id].replacement, 'second');
});

test('relaunching a stale browser mirror preserves bytes without replaying discarded proposals', async () => {
  const h = draftHarness();
  const changed = {...h.record, replacement: 'second', updated: 2, command: {schema: 1, project: h.record.project, command_id: 'cmd-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', base_revision: 1, preimage_hash: h.record.snapshot, config_version: 1, label: 'Correct w1 in place', operations: [{kind: 'set_token', document: h.record.document, token: 'w1', fields: {nform: 'second'}}]}};
  const canonical = JSON.stringify({[changed.id]: changed});
  h.native.raw = canonical;
  const stale = JSON.stringify({[h.record.id]: h.record});
  h.storage.setItem('wb-correction-v1:journal', stale);
  assert.match(await h.api.initializeNativeDrafts(), /preserved separately/);
  assert.equal(h.native.raw, canonical);
  assert.equal(h.storage.getItem('wb-correction-v1:journal'), canonical);
  assert.ok(Array.from({length: h.storage.length}, (_, index) => h.storage.key(index)).some(key => key.startsWith('wb-correction-v1:unflushed-') && h.storage.getItem(key) === stale));
  // A second abrupt parent interruption can still leave the older Chromium
  // mirror even though the first merge's native write completed.
  h.storage.setItem('wb-correction-v1:journal', stale);
  assert.match(await h.api.initializeNativeDrafts(), /preserved separately/);
  assert.equal(h.native.raw, canonical, 'Relaunch must keep the exact original command identity');
  // An acknowledged removal has equal authority: the previous Chromium mirror
  // must not make that proposal active again on the next launch.
  h.native.raw = '{}';
  h.storage.setItem('wb-correction-v1:journal', canonical);
  assert.match(await h.api.initializeNativeDrafts(), /preserved separately/);
  assert.equal(h.storage.getItem('wb-correction-v1:journal'), '{}');
});

test('failed browser hydration cannot replace a native pending command with its stale mirror', async () => {
  const h = draftHarness();
  const pending = {...h.record, replacement: 'second', updated: 2, command: {schema: 1, project: h.record.project, command_id: 'cmd-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', base_revision: 1, preimage_hash: h.record.snapshot, config_version: 1, label: 'Correct w1 in place', operations: [{kind: 'set_token', document: h.record.document, token: 'w1', fields: {nform: 'second'}}]}};
  const canonical = JSON.stringify({[pending.id]: pending});
  h.native.raw = canonical;
  h.storage.setItem('wb-correction-v1:journal', JSON.stringify({[h.record.id]: h.record}));
  h.storage.failBackup = true;
  assert.match(await h.api.initializeNativeDrafts(), /unavailable/);
  assert.equal(h.api.scopedDrafts().records.length, 0, 'An unavailable canonical journal must not expose a stale browser proposal');
  h.storage.failBackup = false;
  assert.notEqual(await h.api.writeDraft({...h.record, replacement: 'third', updated: 3}, h.record), '', 'Native mutations must remain blocked until canonical hydration succeeds');
  assert.equal(h.native.raw, canonical, 'The original unresolved command must remain durable');
  await h.api.initializeNativeDrafts();
  assert.equal(h.storage.getItem('wb-correction-v1:journal'), canonical);
});

function correctionHarness(phase = 'editing') {
  const ts = require('../../ui/node_modules/typescript'), exported = {}, events = [];
  const command = {command_id: 'cmd-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', operations: [{kind: 'set_token', fields: {nform: 'second'}}]};
  const saved = {revision: {id: 2}, approved: false};
  const context = vm.createContext({
    exports: exported, module: {exports: exported}, console,
    window: {workbenchDesktop: {}},
    require: name => name === './api' ? {
      makeCommand: () => ({...command}),
      commit: async value => {events.push({kind: 'command', value}); return saved.revision;},
      loadView: async () => saved,
    } : {},
  });
  const source = fs.readFileSync(path.join(__dirname, '../../ui/src/transcript.ts'), 'utf8');
  vm.runInContext(ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText, context);
  const transcript = Object.create(exported.Transcript.prototype);
  Object.assign(transcript, {
    finalizing: false, composing: false, settling: false, stored: null,
    host: {busy: () => false, otherDraft: () => false, message: value => events.push({kind: 'message', value}), accepted: () => events.push({kind: 'accepted'})},
    draft: {basis: {view: {revision: {id: 1}}, ids: ['w1'], document: 'xmlfiles/test.xml'}, phase, command: phase === 'unknown' ? command : null, prefix: '', replacement: 'second', suffix: '', unlock: phase === 'unknown' ? () => {} : undefined},
    updateDraft() {}, reason: () => '', lock: () => () => {}, reconcileReading: async () => {},
  });
  return {transcript, command, events};
}

test('desktop correction refuses command dispatch until its native journal is acknowledged', async () => {
  const failed = correctionHarness();
  failed.transcript.persist = async () => {failed.transcript.storageWarning = 'Synthetic native write failure';};
  await failed.transcript.accept();
  assert.equal(failed.events.some(event => event.kind === 'command'), false);
  assert.equal(failed.transcript.draft.phase, 'editing');
  assert.equal(failed.transcript.draft.command, null, 'An unsent binding must not survive subsequent proposal changes');

  const pending = correctionHarness('unknown'), originalUnlock = pending.transcript.draft.unlock;
  pending.transcript.persist = async () => {pending.transcript.storageWarning = 'Synthetic native write failure';};
  await pending.transcript.accept(true);
  assert.equal(pending.events.some(event => event.kind === 'command'), false);
  assert.equal(pending.transcript.draft.phase, 'unknown');
  assert.equal(pending.transcript.draft.command, pending.command);
  assert.equal(pending.transcript.draft.unlock, originalUnlock);

  const successful = correctionHarness();
  let acknowledge;
  successful.transcript.persist = () => new Promise(resolve => {acknowledge = () => {successful.events.push({kind: 'native-acknowledged'}); successful.transcript.storageWarning = ''; resolve();};});
  const attempt = successful.transcript.accept();
  assert.equal(successful.events.some(event => event.kind === 'command'), false);
  acknowledge();
  await attempt;
  assert.deepEqual(successful.events.map(event => event.kind).filter(kind => kind !== 'message'), ['native-acknowledged', 'command', 'accepted']);
});
