'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {PreparationController} = require('../preparation.cjs');
const {Registry} = require('../registry.cjs');
const {buildPackage} = require('../preparation-format.cjs');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function syntheticWav() {
  const bytes = Buffer.alloc(44 + 64000);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(64000, 40);
  return bytes;
}
async function listFiles(directory, prefix = '') {
  const result = {};
  for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
    const name = prefix + entry.name, file = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await listFiles(file, name + '/'));
    else {const bytes = await fs.readFile(file); result[name] = {sha256: hash(bytes), bytes: bytes.length};}
  }
  return result;
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-preparation-control-'));
  t.after(async () => {assert.equal(path.dirname(root), path.resolve(os.tmpdir())); await fs.rm(root, {recursive: true, force: true});});
  const audioPath = path.join(root, 'synthetic-tone.wav'), transcriptPath = path.join(root, 'synthetic-transcript.txt');
  const audio = syntheticWav(), raw = Buffer.from('SYNTHETIC e\u0301??\r\n  code-switching  sample.\n');
  await fs.writeFile(audioPath, audio); await fs.writeFile(transcriptPath, raw);
  const profile = path.join(root, 'profile'), registry = await new Registry(profile).load();
  const native = {calls: [], authorities: new Map(), failures: 0, loseResponse: false, noCommit: false, sourceMismatch: false};
  const runCLI = async (_binary, args) => {
    native.calls.push(args);
    const option = flag => args[args.indexOf(flag) + 1], store = option('--store'), project = option('--project');
    if (args[0] === 'import') {
      if (native.hold) await native.hold;
      await fs.mkdir(store, {recursive: true}); await fs.writeFile(path.join(store, 'ledger.sqlite'), 'synthetic control-plane double');
      if (native.failures-- > 0) throw new Error('SYNTHETIC private native diagnostic');
      if (native.noCommit) return '{}';
      const files = await listFiles(option('--package'));
      const view = {snapshot: {project, files}, revision: {id: 1, snapshot_hash: hash(Buffer.from(JSON.stringify(files)))}, approved: false};
      if (native.sourceMismatch) files['Raw/transcript.raw.txt'].sha256 = 'f'.repeat(64);
      native.authorities.set(store, view);
      if (native.loseResponse) throw new Error('SYNTHETIC response lost after transaction');
      return JSON.stringify(view.revision);
    }
    const view = native.authorities.get(store);
    // Match the real CLI envelope, rather than an invented discovery shape.
    if (args[0] === 'projects') return JSON.stringify({projects: view ? [view.snapshot.project] : []});
    if (args[0] === 'view' && view?.snapshot.project === project) return JSON.stringify(view);
    throw new Error('Unexpected native operation');
  };
  const options = {profile, binary: path.join(root, 'backend.exe'), registry, runCLI};
  return {root, profile, audioPath, transcriptPath, audio, raw, registry, native, options, controller: new PreparationController(options), input: {audioPath, transcriptPath, format: 'utf8-text', title: 'Synthetic local preparation'}};
}

test('preview retains exact frozen source bytes, bounds public text and cannot mutate originals', async t => {
  const f = await fixture(t), long = Buffer.from('SYNTHETIC '.repeat(500));
  await fs.writeFile(f.transcriptPath, long);
  const preview = await f.controller.preview({...f.input, title: undefined});
  assert.equal(preview.summary.tokens, 500); assert.equal(preview.summary.segments, 0);
  assert.equal(preview.summary.text.length, 2000); assert.equal(preview.copy_policy, 'frozen-preview');
  assert.equal(preview.sources.audio.sha256, hash(f.audio)); assert.equal(preview.sources.transcript.sha256, hash(long));
  assert.equal(JSON.stringify(preview).includes(f.root), false); assert.equal(f.native.calls.length, 0);
  await fs.writeFile(f.transcriptPath, 'Changed original after preview');
  const committed = await f.controller.commit(preview.token);
  assert.equal(committed.reused, false); assert.equal(committed.recovered, false);
  assert.equal(committed.entry.title, 'synthetic-transcript');
  const view = f.native.authorities.get(committed.entry.store);
  assert.equal(view.snapshot.files['Raw/transcript.raw.txt'].sha256, hash(long)); assert.equal(view.approved, false);
  assert.equal(await fs.readFile(f.transcriptPath, 'utf8'), 'Changed original after preview');
  assert.deepEqual(await fs.readFile(f.audioPath), f.audio);
});

test('same bytes, renamed sources and edited authority reuse one identity without import or overwrite', async t => {
  const f = await fixture(t), first = await f.controller.preview(f.input), committed = await f.controller.commit(first.token);
  const view = f.native.authorities.get(committed.entry.store);
  view.revision = {id: 7, snapshot_hash: '7'.repeat(64)}; view.snapshot.files['xmlfiles/transcript.xml'].sha256 = '8'.repeat(64);
  const renamedAudio = path.join(f.root, 'renamed.wav'), renamedRaw = path.join(f.root, 'renamed.txt');
  await fs.copyFile(f.audioPath, renamedAudio); await fs.copyFile(f.transcriptPath, renamedRaw);
  const next = await f.controller.preview({...f.input, audioPath: renamedAudio, transcriptPath: renamedRaw, title: 'Different title'});
  assert.equal(next.key, first.key); assert.equal(next.duplicate, true);
  const reused = await f.controller.commit(next.token);
  assert.equal(reused.reused, true); assert.equal(reused.entry.id, committed.entry.id); assert.equal(reused.entry.store, committed.entry.store);
  assert.equal(f.native.calls.filter(args => args[0] === 'import').length, 1);
  assert.equal(view.revision.id, 7); assert.equal(view.snapshot.files['xmlfiles/transcript.xml'].sha256, '8'.repeat(64));
  const repeatedToken = await new PreparationController(f.options).commit(first.token);
  assert.equal(repeatedToken.entry.id, committed.entry.id);
});

test('native failure keeps the frozen preview and retries the same reserved authority', async t => {
  const f = await fixture(t), preview = await f.controller.preview(f.input); f.native.failures = 1;
  await assert.rejects(f.controller.commit(preview.token), /did not commit/);
  assert.equal(f.registry.data.recent.length, 0);
  const firstImport = f.native.calls.find(args => args[0] === 'import');
  const restored = new PreparationController(f.options), result = await restored.commit(preview.token);
  const imports = f.native.calls.filter(args => args[0] === 'import');
  assert.equal(imports.length, 2); assert.equal(imports[1][imports[1].indexOf('--store') + 1], firstImport[firstImport.indexOf('--store') + 1]);
  assert.equal(result.reused, false); assert.equal(f.registry.data.recent.length, 1);
});

test('native response loss is recovered from authoritative source-bound readback', async t => {
  const f = await fixture(t), preview = await f.controller.preview(f.input); f.native.loseResponse = true;
  const result = await f.controller.commit(preview.token);
  assert.equal(result.recovered, true); assert.equal(f.registry.data.recent.length, 1);
  assert.equal(f.native.calls.filter(args => args[0] === 'import').length, 1);
});

test('registry failure preserves imported identity for a fresh controller retry', async t => {
  const f = await fixture(t), preview = await f.controller.preview(f.input), remember = f.registry.remember.bind(f.registry);
  let fail = true;
  f.registry.remember = async (...args) => {if (fail) {fail = false; throw new Error('Synthetic registry write interruption');} return remember(...args);};
  await assert.rejects(f.controller.commit(preview.token), /imported and preserved/);
  const nativeStore = [...f.native.authorities.keys()][0];
  const restoredRegistry = await new Registry(f.profile).load();
  const result = await new PreparationController({...f.options, registry: restoredRegistry}).commit(preview.token);
  assert.equal(result.reused, true); assert.equal(result.entry.store, nativeStore); assert.equal(restoredRegistry.data.recent.length, 1);
  assert.equal(f.native.calls.filter(args => args[0] === 'import').length, 1);
});

test('exit zero and mismatched source hashes cannot produce a successful preparation', async t => {
  const f = await fixture(t), preview = await f.controller.preview(f.input); f.native.noCommit = true;
  await assert.rejects(f.controller.commit(preview.token), /did not commit/);
  assert.equal(f.registry.data.recent.length, 0);
  f.native.noCommit = false; f.native.sourceMismatch = true;
  await assert.rejects(f.controller.commit(preview.token), /does not retain/);
  assert.equal(f.registry.data.recent.length, 0);
  assert.deepEqual(await fs.readFile(f.transcriptPath), f.raw);
});

test('changed staged bytes reject commit before native import', async t => {
  const f = await fixture(t), preview = await f.controller.preview(f.input);
  await fs.writeFile(path.join(f.controller.previews, preview.token, 'package', 'Raw', 'transcript.raw.txt'), 'tampered synthetic staging');
  await assert.rejects(f.controller.commit(preview.token), /frozen preparation bytes changed/);
  assert.equal(f.native.calls.length, 0); assert.deepEqual(await fs.readFile(f.transcriptPath), f.raw);
  await f.controller.cancel(preview.token);
});

test('cancellation removes only its owned preview and never a committed authority or originals', async t => {
  const f = await fixture(t), preview = await f.controller.preview(f.input);
  await f.controller.cancel(preview.token); await f.controller.cancel(preview.token);
  await assert.rejects(f.controller.commit(preview.token), /unavailable/);
  await assert.rejects(f.controller.cancel('../projects'), /Invalid preparation preview/);
  const second = await f.controller.preview(f.input), result = await f.controller.commit(second.token);
  await f.controller.cancel(second.token);
  assert.equal((await fs.stat(path.join(result.entry.store, 'ledger.sqlite'))).isFile(), true);
  assert.deepEqual(await fs.readFile(f.audioPath), f.audio); assert.deepEqual(await fs.readFile(f.transcriptPath), f.raw);
});

test('missing previously successful authority blocks duplication while its receipt remains intact', async t => {
  const f = await fixture(t), preview = await f.controller.preview(f.input), result = await f.controller.commit(preview.token);
  await fs.rename(result.entry.store, `${result.entry.store}.moved`);
  await assert.rejects(f.controller.preview(f.input), /earlier prepared authority is unavailable/);
  assert.equal(f.native.calls.filter(args => args[0] === 'import').length, 1);
  assert.equal((await fs.stat(`${result.entry.store}.moved`)).isDirectory(), true);
});

test('reserved receipt preview recovers a committed edited authority and empty reserved attempts remain retryable', async t => {
  const f = await fixture(t), first = await f.controller.preview(f.input), result = await f.controller.commit(first.token);
  const receiptFile = path.join(f.controller.receipts, `${first.key}.json`);
  const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
  await fs.writeFile(receiptFile, JSON.stringify({...receipt, status: 'reserved'}));
  const view = f.native.authorities.get(result.entry.store);
  view.revision = {id: 7, snapshot_hash: '7'.repeat(64)};
  view.snapshot.files['xmlfiles/transcript.xml'].sha256 = '8'.repeat(64);
  const restored = new PreparationController(f.options), next = await restored.preview(f.input);
  assert.equal(next.duplicate, true);
  const reopened = await restored.commit(next.token);
  assert.equal(reopened.reused, true); assert.equal(reopened.entry.id, result.entry.id);
  assert.equal(view.revision.id, 7); assert.equal(f.native.calls.filter(args => args[0] === 'import').length, 1);

  await fs.writeFile(f.transcriptPath, 'SYNTHETIC different source for interrupted empty attempt.');
  const empty = await restored.preview(f.input); f.native.failures = 1;
  await assert.rejects(restored.commit(empty.token), /did not commit/);
  const retried = await new PreparationController(f.options).preview(f.input);
  assert.equal(retried.duplicate, false);
  await restored.commit(retried.token);
});

test('source and generated-file limits and path checks run before staging/native operations', async t => {
  const f = await fixture(t);
  await assert.rejects(f.controller.preview({...f.input, audioPath: f.root}), /regular source file/);
  await assert.rejects(f.controller.preview({...f.input, format: 'auto'}), /Choose UTF-8 text/);
  const huge = path.join(f.root, 'too-large.wav'); await fs.writeFile(huge, 'SYNTHETIC'); await fs.truncate(huge, 64 * 1024 * 1024 + 1);
  await assert.rejects(f.controller.preview({...f.input, audioPath: huge}), /64 MiB/);
  const unsafe = new PreparationController({...f.options, buildPackage: input => {const result = buildPackage(input); result.files['../outside.txt'] = Buffer.from('synthetic'); return result;}});
  await assert.rejects(unsafe.preview(f.input), /path or size/);
  assert.equal(f.native.calls.length, 0); assert.equal((await fs.readdir(f.controller.previews)).length, 0);
});

test('source junctions and substituted preview directories never become cleanup targets', async t => {
  const f = await fixture(t), sourceFolder = path.join(f.root, 'linked-sources');
  await fs.symlink(f.root, sourceFolder, process.platform === 'win32' ? 'junction' : 'dir');
  try {await assert.rejects(f.controller.preview({...f.input, audioPath: path.join(sourceFolder, path.basename(f.audioPath))}), /without symbolic links or junctions/);}
  finally {await fs.unlink(sourceFolder);}
  const preview = await f.controller.preview(f.input), folder = path.join(f.controller.previews, preview.token), moved = folder + '.saved';
  await fs.rename(folder, moved);
  await fs.symlink(f.root, folder, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await assert.rejects(f.controller.cancel(preview.token), /Refusing cleanup/);
    assert.deepEqual(await fs.readFile(f.transcriptPath), f.raw);
  } finally {await fs.unlink(folder);}
});

test('one controller refuses duplicate commit/cancel dispatch while importing', async t => {
  const f = await fixture(t), preview = await f.controller.preview(f.input);
  let release; f.native.hold = new Promise(resolve => {release = resolve;});
  const pending = f.controller.commit(preview.token);
  while (!f.native.calls.some(args => args[0] === 'import')) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.controller.commit(preview.token), /already in progress/);
  await assert.rejects(f.controller.cancel(preview.token), /already in progress/);
  release(); await pending;
  assert.equal(f.native.calls.filter(args => args[0] === 'import').length, 1);
});
