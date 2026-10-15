'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {SemanticaController, lastJSON} = require('../semantica.cjs');

// Deterministic control-plane doubles only. The adapter qualification separately
// executes the installed Semantica compiler and ContextGraph reader.
const HASH = 'a'.repeat(64), ID = 'b'.repeat(64), RECIPE = 'c'.repeat(64);
const FORMAT = 'open-k-folds/corpus-semantica-handoff';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-semantica-control-'));
  t.after(async () => {assert.equal(path.dirname(root), path.resolve(os.tmpdir())); await fs.rm(root, {recursive: true, force: true});});
  const python = path.join(root, 'Python with spaces.exe'), compilerRoot = path.join(root, 'compiler');
  await fs.writeFile(python, 'test double, not an executable'); await fs.mkdir(compilerRoot);
  const active = {store: path.join(root, 'authority'), project: 'synthetic-only'};
  const calls = [], pythonCalls = [], state = {accepted: false, approved: true, current: true, reuse: false, verification: true};
  const runtime = {ok: true, ready: true, semantica_version: '0.6.8', compiler_commit: 'd'.repeat(40), compiler_source_hash: 'e'.repeat(64), compile_sources: {supports_observations: true}, recipe: {mapping_version: 'corpus-evidence/2'}, runtime: {python: '3.13.14'}};
  const entry = {generation_id: ID, revision: 7, snapshot_hash: HASH, recipe_hash: RECIPE, current: true};
  const generation = {generation: entry, receipt: {binding: {project: active.project, revision: 7, snapshot_hash: HASH, recipe: {mapping_version: 'corpus-evidence/2'}}, node_count: 8, edge_count: 13}};
  const manifest = {format: FORMAT, schema: 1, generation_id: ID, revision: 7, snapshot_hash: HASH, current_at_export: true, node_count: 8, edge_count: 13};
  const runCLI = async (binary, args) => {
    calls.push({binary, args});
    assert.equal(args[args.indexOf('--store') + 1], active.store);
    assert.equal(args[args.indexOf('--project') + 1], active.project);
    switch (args[0]) {
      case 'contract':
        if (!state.approved) throw new Error('SOURCE NOTE MUST NEVER APPEAR');
        return JSON.stringify({project_id: active.project, revision: {id: 7}, bundle_hash: HASH, review: {decision: 'approved'}});
      case 'generations': return JSON.stringify(state.accepted && state.current ? [entry] : []);
      case 'generation':
        if (!state.accepted || !state.current) throw new Error('SOURCE NOTE MUST NEVER APPEAR');
        return JSON.stringify(generation);
      case 'export-handoff': {
        if (!state.current) throw new Error('SOURCE NOTE MUST NEVER APPEAR');
        const output = args[args.indexOf('--out') + 1];
        await fs.mkdir(output); await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest));
        return JSON.stringify(manifest);
      }
      default: throw new Error('Unexpected native operation ' + args[0]);
    }
  };
  const runPython = async (binary, args) => {
    pythonCalls.push({binary, args});
    if (args.includes('--check-runtime')) {
      if (state.runtimeFailure) throw new Error('SOURCE NOTE MUST NEVER APPEAR');
      return 'Runtime progress\n' + JSON.stringify(runtime);
    }
    if (args.includes('--verify-package')) {
      if (state.rejectVerify) throw new Error('SOURCE NOTE MUST NEVER APPEAR');
      if (state.afterVerify) state.afterVerify();
      return JSON.stringify({ok: true, verified: state.verification, native_reopen: true, generation_id: ID, revision: 7, snapshot_hash: HASH, node_count: 8, edge_count: 13, files_verified: 4, format: FORMAT, schema: 1});
    }
    if (state.hold) await state.hold;
    if (state.adapterFailure) throw new Error('SOURCE NOTE MUST NEVER APPEAR');
    const reused = state.accepted;
    if (!state.noAccept) state.accepted = true;
    return 'Compiler progress\n' + JSON.stringify({generation_id: ID, revision: 7, reused});
  };
  const options = {profileRoot: root, binary: path.join(root, 'backend.exe'), adapter: path.join(root, 'adapter.py'), runCLI, runPython};
  const controller = new SemanticaController(options);
  return {root, python, compilerRoot, active, state, calls, pythonCalls, controller, options, entry, generation, manifest};
}

test('runtime configuration is checked before persistence and public state excludes paths', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.controller.state(), {status: 'notconfigured', configured: false});
  await f.controller.configure({python: f.python, compilerRoot: f.compilerRoot});
  const saved = await fs.readFile(f.controller.configFile, 'utf8');
  const state = await f.controller.state(f.active);
  assert.equal(state.status, 'ready'); assert.equal(state.runtime.semantica_version, '0.6.8');
  assert.equal(JSON.stringify(state).includes(f.root), false);
  assert.ok(saved.includes('compilerRoot'));
  f.state.runtimeFailure = true;
  await assert.rejects(f.controller.configure({python: f.python, compilerRoot: f.compilerRoot}), /runtime check failed/);
  assert.equal(await fs.readFile(f.controller.configFile, 'utf8'), saved);
});

test('repairing invalid runtime metadata preserves the original exact bytes', async t => {
  const f = await fixture(t), raw = '{"schema":999,"raw":"preserve me"}';
  await fs.mkdir(path.dirname(f.controller.configFile), {recursive: true});
  await fs.writeFile(f.controller.configFile, raw);
  assert.equal((await f.controller.state(f.active)).status, 'failed');
  await f.controller.configure({python: f.python, compilerRoot: f.compilerRoot});
  const backup = (await fs.readdir(path.dirname(f.controller.configFile))).find(name => name.startsWith('runtime.json.invalid-'));
  assert.equal(await fs.readFile(path.join(path.dirname(f.controller.configFile), backup), 'utf8'), raw);
});

test('exact saved approved revision is required before any compiler dispatch', async t => {
  const f = await fixture(t);
  await f.controller.configure({python: f.python, compilerRoot: f.compilerRoot});
  f.state.approved = false;
  await assert.rejects(f.controller.run(f.active, {revision: 7, snapshot_hash: HASH}), /full approval/);
  f.state.approved = true;
  await assert.rejects(f.controller.run(f.active, {revision: 7, snapshot_hash: 'f'.repeat(64)}), /no longer/);
  assert.equal(f.pythonCalls.some(call => call.args.includes('--output')), false);
  assert.equal(f.calls.filter(call => call.args[0] === 'contract').length, 2);
  assert.ok(f.calls.filter(call => call.args[0] === 'contract').every(call => call.args.includes('corpus-evidence/2')));
});

test('accepted generation alone never claims live runtime consumption', async t => {
  const f = await fixture(t); f.state.accepted = true;
  const state = await f.controller.state(f.active);
  assert.equal(state.current.native_reopen, false);
  assert.equal(state.status, 'current'); assert.equal(state.configured, false);
});

test('legacy portable export gives an upgrade action before creating output and missing mapping invalidates the receipt', async t => {
  const f = await fixture(t); f.state.accepted = true;
  await f.controller.configure({python: f.python, compilerRoot: f.compilerRoot});
  f.generation.receipt.binding.recipe.mapping_version = 'corpus-evidence/1';
  assert.equal((await f.controller.state(f.active)).current.mapping_version, 'corpus-evidence/1');
  await assert.rejects(f.controller.export(f.active, ID, f.root), /Run local Semantica to create a V2 portable generation/);
  assert.equal(f.calls.some(call => call.args[0] === 'export-handoff'), false);
  assert.equal(f.pythonCalls.some(call => call.args.includes('--verify-package')), false);
  await assert.rejects(fs.stat(path.dirname(f.controller.journal(f.active))), {code: 'ENOENT'});
  assert.equal(f.state.accepted, true);
  delete f.generation.receipt.binding.recipe.mapping_version;
  const invalid = await f.controller.state(f.active);
  assert.equal(invalid.status, 'failed'); assert.equal(invalid.current, undefined);
});

test('successful run requires native acceptance and a real consumer-check response; retries reuse evidence', async t => {
  const f = await fixture(t);
  await f.controller.configure({python: f.python, compilerRoot: f.compilerRoot});
  const basis = {revision: 7, snapshot_hash: HASH};
  const first = await f.controller.run(f.active, basis), second = await f.controller.run(f.active, basis);
  assert.equal(first.current.native_reopen, true); assert.equal(first.lastAttempt.reused, false);
  assert.equal(second.lastAttempt.reused, true); assert.equal(second.current.generation_id, first.current.generation_id);
  const outputs = f.pythonCalls.filter(call => call.args.includes('--output')).map(call => call.args[call.args.indexOf('--output') + 1]);
  assert.equal(new Set(outputs).size, 2);
  assert.equal(f.pythonCalls.filter(call => call.args.includes('--verify-package')).length, 2);
  const recovered = await new SemanticaController(f.options).state(f.active);
  assert.equal(recovered.current.native_reopen, true); assert.equal(recovered.lastAttempt.reused, true);
  assert.equal(JSON.stringify(recovered).includes(f.root), false);
});

test('exit zero without native acceptance cannot report success or leak source diagnostics', async t => {
  const f = await fixture(t);
  await f.controller.configure({python: f.python, compilerRoot: f.compilerRoot}); f.state.noAccept = true;
  await assert.rejects(f.controller.run(f.active, {revision: 7, snapshot_hash: HASH}), /unavailable in current scope/);
  const state = await f.controller.state(f.active);
  assert.notEqual(state.status, 'current'); assert.equal(state.current, undefined);
  assert.equal(JSON.stringify(state).includes('SOURCE NOTE'), false);
});

test('consumer rejection preserves accepted evidence but does not mark it verified', async t => {
  const f = await fixture(t);
  await f.controller.configure({python: f.python, compilerRoot: f.compilerRoot}); f.state.verification = false;
  await assert.rejects(f.controller.run(f.active, {revision: 7, snapshot_hash: HASH}), /did not confirm/);
  const state = await f.controller.state(f.active);
  assert.equal(state.current.native_reopen, false); assert.equal(state.lastAttempt.status, 'failed');
  assert.equal(state.export, undefined);
  const latest = JSON.parse(await fs.readFile(f.controller.journal(f.active), 'utf8'));
  const attempts = path.join(path.dirname(f.controller.journal(f.active)), 'attempts');
  assert.equal(latest.generation_id, ID);
  const folders = await fs.readdir(attempts);
  assert.equal((await fs.stat(path.join(attempts, folders[0], 'consumer-check', 'manifest.json'))).isFile(), true);
  f.state.verification = true;
  assert.equal((await f.controller.run(f.active, {revision: 7, snapshot_hash: HASH})).lastAttempt.reused, true);
});

test('late revision changes reject successful consumer output and reconcile as stale', async t => {
  const f = await fixture(t);
  await f.controller.configure({python: f.python, compilerRoot: f.compilerRoot});
  f.state.afterVerify = () => {f.state.current = false;};
  await assert.rejects(f.controller.run(f.active, {revision: 7, snapshot_hash: HASH}), /unavailable in current scope/);
  const state = await f.controller.state(f.active);
  assert.equal(state.status, 'stale'); assert.equal(state.current, undefined);
});

test('export reserves a fresh child and requires consumer confirmation before exposing its path', async t => {
  const f = await fixture(t);
  await f.controller.configure({python: f.python, compilerRoot: f.compilerRoot});
  await f.controller.run(f.active, {revision: 7, snapshot_hash: HASH});
  const destination = path.join(f.root, 'exports'); await fs.mkdir(destination);
  const one = await f.controller.export(f.active, ID, destination), two = await f.controller.export(f.active, ID, destination);
  assert.equal(one.export.validated, true); assert.equal(path.dirname(one.output), destination);
  assert.notEqual(one.output, two.output); assert.equal((await fs.stat(one.output)).isDirectory(), true);
  const state = await new SemanticaController(f.options).state(f.active);
  assert.equal(state.export.filename, two.export.filename); assert.equal(JSON.stringify(state).includes(f.root), false);
  assert.equal(await new SemanticaController(f.options).exportedPath(f.active), two.output);
  f.state.current = false;
  await assert.rejects(new SemanticaController(f.options).exportedPath(f.active), /unavailable in current scope/);
  f.state.current = true;
  f.state.rejectVerify = true;
  await assert.rejects(f.controller.export(f.active, ID, destination), /have not passed/);
  const failed = await f.controller.state(f.active);
  assert.equal(failed.export, undefined); assert.equal(failed.lastAttempt.status, 'failed');
  assert.equal((await fs.readdir(destination)).length, 3);
});

test('reveal recovery rejects moved or substituted export folders', async t => {
  const f = await fixture(t);
  await f.controller.configure({python: f.python, compilerRoot: f.compilerRoot}); f.state.accepted = true;
  const exported = await f.controller.export(f.active, ID, f.root);
  await fs.writeFile(path.join(exported.output, 'manifest.json'), JSON.stringify({...f.manifest, generation_id: 'f'.repeat(64)}));
  await assert.rejects(new SemanticaController(f.options).exportedPath(f.active), /no longer identifies/);
  await fs.rename(exported.output, `${exported.output}.moved`);
  await assert.rejects(new SemanticaController(f.options).exportedPath(f.active), /moved or is unavailable/);
});

test('concurrent dispatch is refused and interrupted attempts reconcile against authoritative generations', async t => {
  const f = await fixture(t);
  await f.controller.configure({python: f.python, compilerRoot: f.compilerRoot});
  let release; f.state.hold = new Promise(resolve => {release = resolve;});
  const running = f.controller.run(f.active, {revision: 7, snapshot_hash: HASH});
  while (!f.pythonCalls.some(call => call.args.includes('--output'))) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.controller.run(f.active, {revision: 7, snapshot_hash: HASH}), /already in progress/);
  assert.equal((await f.controller.state(f.active)).status, 'running');
  const restored = await new SemanticaController(f.options).state(f.active);
  assert.equal(restored.status, 'interrupted'); assert.equal(restored.lastAttempt.status, 'interrupted');
  release(); await running;
  assert.equal((await f.controller.state(f.active)).status, 'current');
});

test('final JSON parser accepts progress and rejects missing completion', () => {
  assert.deepEqual(lastJSON('progress\n{"ok":true}\n'), {ok: true});
  assert.throws(() => lastJSON('progress only'), /no valid completion/);
});
