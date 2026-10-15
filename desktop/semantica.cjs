'use strict';
// The renderer supplies revision identities only. Paths and the active authority
// come from trusted native dialogs/main; corpus approval remains in the backend.
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {createHash, randomUUID} = require('node:crypto');
const {runCLI: nativeCLI} = require('./backend.cjs');

const HASH = /^[a-f0-9]{64}$/;
const FORMAT = 'open-k-folds/corpus-semantica-handoff';
const digest = text => createHash('sha256').update(text).digest('hex');
const safeCount = value => Number.isSafeInteger(value) && value >= 0;
function lastJSON(text) {
  // Semantica emits progress before its final machine-readable response.
  const lines = String(text).trim().split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index--) {
    try { return JSON.parse(lines[index]); } catch { /* Ignore progress lines. */ }
  }
  throw new Error('The local tool returned no valid completion. No successful handoff was recorded.');
}
function pythonCLI(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '', bytes = 0, stopped = false;
    const finish = (error, value) => {
      if (stopped) return;
      stopped = true; clearTimeout(timer); error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => {child.kill(); finish(new Error('The local Semantica operation timed out. Its attempt was preserved; check the runtime and retry.'));}, 30 * 60 * 1000);
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) {child.kill(); finish(new Error('The local tool exceeded its output limit. Its attempt was preserved.')); return;}
      output += chunk;
    });
    // Drain diagnostics without reflecting possible source text into the UI.
    child.stderr.on('data', () => {});
    child.once('error', () => finish(new Error('The configured Python executable could not start. Choose a working local runtime.')));
    child.once('close', code => code === 0 ? finish(null, output) : finish(new Error('The local Semantica operation failed. Check the configured runtime and the current revision, then retry. Previous accepted evidence is preserved.')));
  });
}
async function atomicJSON(file, value) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx');
  try {await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync();} finally {await handle.close();}
  await fs.rename(temporary, file);
}
async function readJSON(file, limit = 65536) {
  const info = await fs.stat(file);
  if (!info.isFile() || info.size > limit) throw new Error('Saved research handoff metadata is invalid and has been preserved.');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

class SemanticaController {
  constructor({profileRoot, binary, adapter, runCLI = nativeCLI, runPython = pythonCLI}) {
    for (const value of [profileRoot, binary, adapter]) if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Local handoff paths must be absolute');
    this.root = path.join(profileRoot, 'semantica');
    this.configFile = path.join(this.root, 'runtime.json');
    this.binary = binary; this.adapter = adapter; this.runCLI = runCLI; this.runPython = runPython;
    this.busy = false; this.activeKey = null; this.phase = null; this.runtime = null;
  }
  active(active) {
    if (!active || typeof active.store !== 'string' || !path.isAbsolute(active.store) || typeof active.project !== 'string' || !active.project || active.project.length > 128) throw new Error('Open a corpus project before preparing a research handoff.');
    return {store: path.resolve(active.store), project: active.project};
  }
  key(active) {
    const store = process.platform === 'win32' ? active.store.toLowerCase() : active.store;
    return digest(JSON.stringify([store, active.project]));
  }
  async config() {
    try {
      const value = await readJSON(this.configFile);
      if (value.schema !== 1 || !path.isAbsolute(value.python ?? '') || !path.isAbsolute(value.compilerRoot ?? '')) throw new Error('Invalid runtime settings');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error('Saved research runtime settings are invalid and have been preserved. Choose the runtime again to recover.');
    }
  }
  async exclusive(key, phase, work) {
    if (this.busy) throw new Error('A local research handoff operation is already in progress.');
    this.busy = true; this.activeKey = key; this.phase = phase;
    try {return await work();} finally {this.busy = false; this.activeKey = null; this.phase = null;}
  }
  async native(active, ...arguments_) {
    return lastJSON(await this.runCLI(this.binary, [...arguments_, '--store', active.store, '--project', active.project]));
  }
  async preflight(config) {
    const python = await fs.stat(config.python).catch(() => null), compiler = await fs.stat(config.compilerRoot).catch(() => null);
    if (!python?.isFile() || !compiler?.isDirectory()) throw new Error('The configured Python or compiler folder is unavailable. Choose the local runtime again.');
    let result;
    try {result = lastJSON(await this.runPython(config.python, [this.adapter, '--check-runtime', '--compiler-root', config.compilerRoot]));}
    catch {throw new Error('Local Semantica runtime check failed. Use Semantica 0.6.8 and a clean compiler checkout supporting authored evidence; no corpus data was sent.');}
    if (result.ok !== true || result.ready !== true || result.semantica_version !== '0.6.8' || !HASH.test(result.compiler_source_hash) || !/^[a-f0-9]{40,64}$/.test(result.compiler_commit) || result.compile_sources?.supports_observations !== true || result.recipe?.mapping_version !== 'corpus-evidence/2') throw new Error('The local runtime did not confirm the supported Semantica evidence contract.');
    this.runtime = {semantica_version: result.semantica_version, compiler_commit: result.compiler_commit, mapping_version: result.recipe.mapping_version, python: typeof result.runtime?.python === 'string' ? result.runtime.python.slice(0, 32) : null};
    return this.runtime;
  }
  async configure({python, compilerRoot} = {}) {
    if (typeof python !== 'string' || typeof compilerRoot !== 'string' || !path.isAbsolute(python) || !path.isAbsolute(compilerRoot)) throw new Error('Choose an absolute Python executable and compiler folder.');
    return this.exclusive(null, 'checking', async () => {
      const config = {schema: 1, python: await fs.realpath(python), compilerRoot: await fs.realpath(compilerRoot)};
      await this.preflight(config);
      // Repairing configuration must not silently destroy malformed metadata.
      try {await this.config();} catch {await fs.copyFile(this.configFile, `${this.configFile}.invalid-${randomUUID()}`, require('node:fs').constants.COPYFILE_EXCL);}
      await atomicJSON(this.configFile, config);
      return {status: 'ready', configured: true, runtime: this.runtime};
    });
  }
  async checkRuntime() {
    return this.exclusive(null, 'checking', async () => {
      const config = await this.config();
      if (!config) return {status: 'notconfigured', configured: false};
      await this.preflight(config);
      return {status: 'ready', configured: true, runtime: this.runtime};
    });
  }
  journal(active) {return path.join(this.root, 'authorities', this.key(active), 'latest.json');}
  async attempt(active) {
    try {
      const record = await readJSON(this.journal(active));
      if (record.schema !== 1 || record.key !== this.key(active) || !['running', 'exporting', 'current', 'failed', 'interrupted'].includes(record.status)) throw new Error('Invalid attempt');
      if (['running', 'exporting'].includes(record.status) && this.activeKey !== this.key(active)) return {...record, status: 'interrupted', message: 'The previous local attempt was interrupted. Accepted generations are checked below; retry safely to reuse matching evidence.'};
      return record;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      return {status: 'failed', message: 'Saved attempt metadata is unreadable and has been preserved. Current accepted generations are checked independently.'};
    }
  }
  publicAttempt(record) {
    if (!record) return undefined;
    return {status: record.status, ...(Number.isSafeInteger(record.revision) ? {revision: record.revision} : {}), ...(typeof record.reused === 'boolean' ? {reused: record.reused} : {}), ...(typeof record.message === 'string' ? {message: record.message.slice(0, 600)} : {})};
  }
  async generation(active, id) {
    if (!HASH.test(id ?? '')) throw new Error('Choose a valid accepted generation.');
    let value;
    try {value = await this.native(active, 'generation', '--id', id);}
    catch {throw new Error('The accepted generation is unavailable in current scope. Review the current revision and retry; earlier evidence is preserved.');}
    const entry = value.generation, receipt = value.receipt, binding = receipt?.binding;
    if (entry?.generation_id !== id || entry.current !== true || !HASH.test(entry.snapshot_hash ?? '') || !HASH.test(entry.recipe_hash ?? '') || binding?.project !== active.project || binding.revision !== entry.revision || binding.snapshot_hash !== entry.snapshot_hash || !['corpus-evidence/1', 'corpus-evidence/2'].includes(binding.recipe?.mapping_version) || !safeCount(receipt.node_count) || !safeCount(receipt.edge_count)) throw new Error('The backend did not confirm a current accepted generation. Recheck the exact revision and review.');
    return {generation_id: id, revision: entry.revision, snapshot_hash: entry.snapshot_hash, recipe_hash: entry.recipe_hash, mapping_version: binding.recipe.mapping_version, node_count: receipt.node_count, edge_count: receipt.edge_count, native_reopen: false};
  }
  async state(activeInput) {
    let config;
    try {config = await this.config();} catch (error) {return {status: 'failed', configured: false, lastAttempt: {status: 'failed', message: error.message}};}
    const state = {status: config ? 'ready' : 'notconfigured', configured: Boolean(config), ...(this.runtime ? {runtime: this.runtime} : {})};
    if (!activeInput) return state;
    const active = this.active(activeInput), key = this.key(active), record = await this.attempt(active);
    if (record) state.lastAttempt = this.publicAttempt(record);
    try {
      const entries = await this.native(active, 'generations');
      if (!Array.isArray(entries)) throw new Error('Invalid generation list');
      const entry = entries.find(item => item.generation_id === record?.generation_id) ?? entries[0];
      if (entry) {
        state.current = await this.generation(active, entry.generation_id);
        state.current.native_reopen = record?.status === 'current' && record.generation_id === state.current.generation_id && record.native_reopen === true;
        state.status = 'current';
        if (record?.export?.validated === true && record.export.generation_id === entry.generation_id && /^corpus-handoff-r[0-9]+-[a-f0-9]{12}-[a-f0-9]{8}$/.test(record.export.filename ?? '')) state.export = {validated: true, filename: record.export.filename, generation_id: entry.generation_id};
      } else if (record?.generation_id) state.status = 'stale';
      else if (record && ['failed', 'interrupted'].includes(record.status)) state.status = record.status;
    } catch {
      state.status = 'failed';
      state.lastAttempt = {status: 'failed', message: 'Current acceptance could not be checked. Reopen the authority or retry; no successful handoff is claimed.'};
    }
    if (this.busy && (this.activeKey === key || this.activeKey === null)) state.status = this.phase;
    return state;
  }
  async saveAttempt(active, attempt, record) {
    await atomicJSON(path.join(attempt, 'attempt.json'), record);
    await atomicJSON(this.journal(active), record);
  }
  async newAttempt(active, phase, basis) {
    const parent = path.join(this.root, 'authorities', this.key(active), 'attempts');
    await fs.mkdir(parent, {recursive: true});
    const folder = path.join(parent, randomUUID());
    await fs.mkdir(folder); // Never reuse or remove a prior attempt's evidence.
    const record = {schema: 1, key: this.key(active), status: phase, ...basis};
    await this.saveAttempt(active, folder, record);
    return {folder, record};
  }
  async verifyExport(active, config, id, destination) {
    let manifest;
    try {manifest = await this.native(active, 'export-handoff', '--generation', id, '--out', destination);}
    catch {throw new Error('The current accepted generation could not be exported. The destination and previous evidence were preserved; confirm review and choose a fresh folder.');}
    if (manifest.format !== FORMAT || manifest.schema !== 1 || manifest.generation_id !== id || manifest.current_at_export !== true) throw new Error('The backend did not return a versioned current handoff manifest. The partial folder was preserved.');
    this.phase = 'verifying';
    let proof;
    try {proof = lastJSON(await this.runPython(config.python, [this.adapter, '--verify-package', destination, '--compiler-root', config.compilerRoot]));}
    catch {throw new Error('The exported files have not passed the local Semantica consumer check. The folder was preserved for recovery; check the runtime and retry.');}
    if (proof.ok !== true || proof.verified !== true || proof.native_reopen !== true || proof.format !== FORMAT || proof.schema !== 1 || proof.generation_id !== id || proof.revision !== manifest.revision || proof.snapshot_hash !== manifest.snapshot_hash || proof.node_count !== manifest.node_count || proof.edge_count !== manifest.edge_count || proof.files_verified !== 4) throw new Error('The local Semantica consumer did not confirm this exact exported generation. No validated export is claimed.');
    const current = await this.generation(active, id);
    if (current.revision !== proof.revision || current.snapshot_hash !== proof.snapshot_hash || current.node_count !== proof.node_count || current.edge_count !== proof.edge_count) throw new Error('The exact reviewed revision changed during verification. The output remains historical; review the current revision and retry.');
    return {...current, native_reopen: true};
  }
  async run(activeInput, basis) {
    const active = this.active(activeInput);
    if (!Number.isSafeInteger(basis?.revision) || basis.revision < 1 || !HASH.test(basis?.snapshot_hash ?? '')) throw new Error('Use the exact saved revision and snapshot before running Semantica.');
    return this.exclusive(this.key(active), 'running', async () => {
      const config = await this.config();
      if (!config) throw new Error('Choose a local Semantica runtime first.');
      await this.preflight(config);
      let contract;
      try {contract = await this.native(active, 'contract', '--revision', String(basis.revision), '--mapping-version', 'corpus-evidence/2');}
      catch {throw new Error('Semantica requires the current saved revision, full approval and passing corpus validation. Save, review and try again.');}
      if (contract.project_id !== active.project || contract.revision?.id !== basis.revision || contract.bundle_hash !== basis.snapshot_hash || contract.review?.decision !== 'approved') throw new Error('The selected revision is no longer the current approved evidence. Refresh, review and retry.');
      const {folder, record} = await this.newAttempt(active, 'running', {revision: basis.revision, snapshot_hash: basis.snapshot_hash});
      try {
        let result;
        try {result = lastJSON(await this.runPython(config.python, [this.adapter, '--binary', this.binary, '--store', active.store, '--project', active.project, '--revision', String(basis.revision), '--compiler-root', config.compilerRoot, '--output', path.join(folder, 'analysis')]));}
        catch {throw new Error('Semantica did not complete this attempt. Check the runtime and exact current approval, then retry safely; partial output was preserved.');}
        if (!HASH.test(result.generation_id ?? '') || result.revision !== basis.revision || typeof result.reused !== 'boolean') throw new Error('Semantica returned no valid generation completion. Partial output was preserved.');
        record.generation_id = result.generation_id;
        const accepted = await this.generation(active, result.generation_id);
        if (accepted.revision !== basis.revision || accepted.snapshot_hash !== basis.snapshot_hash) throw new Error('Semantica completion does not match the selected exact revision.');
        // Reused generations also pass a real consumer read, not merely an exit code.
        const current = await this.verifyExport(active, config, result.generation_id, path.join(folder, 'consumer-check'));
        await this.saveAttempt(active, folder, {...record, status: 'current', reused: result.reused, native_reopen: true});
        return {status: 'current', configured: true, runtime: this.runtime, current, lastAttempt: {status: 'current', revision: basis.revision, reused: result.reused}};
      } catch (error) {
        await this.saveAttempt(active, folder, {...record, status: 'failed', message: error.message});
        throw error;
      }
    });
  }
  async export(activeInput, id, parentDirectory) {
    const active = this.active(activeInput);
    if (!HASH.test(id ?? '') || typeof parentDirectory !== 'string' || !path.isAbsolute(parentDirectory)) throw new Error('Choose a current generation and an existing destination folder.');
    return this.exclusive(this.key(active), 'exporting', async () => {
      const current = await this.generation(active, id);
      if (current.mapping_version !== 'corpus-evidence/2') throw new Error('This legacy graph uses corpus-evidence/1. Run local Semantica to create a V2 portable generation before exporting. The earlier graph is preserved.');
      const config = await this.config();
      if (!config) throw new Error('Choose a local Semantica runtime to validate the exported handoff.');
      await this.preflight(config);
      const parent = await fs.realpath(parentDirectory);
      if (!(await fs.stat(parent)).isDirectory()) throw new Error('Choose an existing destination folder.');
      const {folder, record} = await this.newAttempt(active, 'exporting', {revision: current.revision, snapshot_hash: current.snapshot_hash, generation_id: id});
      const filename = `corpus-handoff-r${current.revision}-${id.slice(0, 12)}-${randomUUID().slice(0, 8)}`;
      const output = path.join(parent, filename);
      try {
        const verified = await this.verifyExport(active, config, id, output);
        const exported = {validated: true, filename, generation_id: id};
        await this.saveAttempt(active, folder, {...record, status: 'current', native_reopen: true, export: {...exported, output}});
        return {status: 'current', configured: true, runtime: this.runtime, current: verified, lastAttempt: {status: 'current', revision: current.revision}, export: exported, output};
      } catch (error) {
        await this.saveAttempt(active, folder, {...record, status: 'failed', message: error.message});
        throw error;
      }
    });
  }
  async exportedPath(activeInput) {
    const active = this.active(activeInput), record = await this.attempt(active), exported = record?.export;
    if (record?.status !== 'current' || exported?.validated !== true || exported.generation_id !== record.generation_id || !HASH.test(exported.generation_id ?? '') || typeof exported.output !== 'string' || !path.isAbsolute(exported.output) || !/^corpus-handoff-r[0-9]+-[a-f0-9]{12}-[a-f0-9]{8}$/.test(exported.filename ?? '') || path.basename(exported.output) !== exported.filename) throw new Error('No validated export is available for this current generation. Export a fresh handoff folder.');
    const current = await this.generation(active, exported.generation_id);
    const output = await fs.realpath(exported.output).catch(() => null);
    const samePath = output && (process.platform === 'win32' ? output.toLowerCase() === path.resolve(exported.output).toLowerCase() : output === path.resolve(exported.output));
    if (!samePath || !(await fs.lstat(exported.output)).isDirectory()) throw new Error('The validated export folder has moved or is unavailable. Export a fresh handoff folder.');
    const manifest = await readJSON(path.join(output, 'manifest.json'), 4 * 1024 * 1024);
    if (manifest.format !== FORMAT || manifest.schema !== 1 || manifest.generation_id !== current.generation_id || manifest.revision !== current.revision || manifest.snapshot_hash !== current.snapshot_hash) throw new Error('The export folder no longer identifies this current generation. Export a fresh handoff folder.');
    return output;
  }
}

module.exports = {SemanticaController, lastJSON};
