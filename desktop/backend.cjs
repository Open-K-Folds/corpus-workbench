'use strict';
const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {EventEmitter} = require('node:events');

function runCLI(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options});
    let output = '', errors = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Corpus operation timed out after 30 minutes. The source package and any partial import have been preserved.')); }, 30 * 60 * 1000);
    child.stdout.on('data', bytes => { output += bytes; if (output.length > 8 * 1024 * 1024) child.kill(); });
    child.stderr.on('data', bytes => { errors = (errors + bytes).slice(-16000); });
    child.once('error', error => {clearTimeout(timeout); reject(error);});
    child.once('exit', code => {clearTimeout(timeout); code === 0 ? resolve(output.trim()) : reject(new Error(errors.trim() || `Corpus operation exited with code ${code}`));});
  });
}
class Backend extends EventEmitter {
  constructor(binary, ui, runtimeRoot) { super(); this.binary = binary; this.ui = ui; this.runtimeRoot = runtimeRoot; this.child = null; this.ready = null; this.stopping = false; }
  async cleanupRuntime(runtime) {
    if (!runtime) return;
    const target = path.resolve(runtime), root = path.resolve(this.runtimeRoot);
    if (path.dirname(target) !== root || !/^[a-f0-9-]{36}$/.test(path.basename(target))) throw new Error('Refusing cleanup outside the owned launch runtime');
    await fs.rm(target, {recursive: true, force: true, maxRetries: 10, retryDelay: 30});
  }
  async start(store, project) {
    if (this.child) throw new Error('A corpus backend is already active');
    const runtime = path.join(this.runtimeRoot, randomUUID());
    await fs.mkdir(runtime, {recursive: true});
    this.runtime = runtime; this.stopping = false;
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, ['serve', '--store', store, '--project', project, '--ui', this.ui, '--port', '0', '--runtime-dir', runtime, '--desktop', 'yes', '--parent-stdin', 'yes'], {cwd: runtime, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
      this.child = child;
      let lines = '', errors = '', settled = false;
      const fail = error => { if (!settled) {settled = true; clearTimeout(timeout); reject(error);} };
      const timeout = setTimeout(() => {fail(new Error('The corpus backend did not become ready. Retry opening this project.')); void this.stop();}, 30000);
      child.stdout.on('data', bytes => {
        lines += bytes;
        if (lines.length > 65536) {fail(new Error('Invalid backend startup output')); void this.stop(); return;}
        while (lines.includes('\n')) {
          const index = lines.indexOf('\n'), line = lines.slice(0, index).trim(); lines = lines.slice(index + 1);
          let value; try { value = JSON.parse(line); } catch { continue; }
          if (value.event !== 'workbench-ready') continue;
          if (!Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65535 || typeof value.capability !== 'string' || !/^[a-f0-9]{64}$/.test(value.capability) || value.project !== project) {fail(new Error('Invalid backend readiness handshake')); void this.stop(); return;}
          this.ready = {port: value.port, capability: value.capability, project};
          if (!settled) {settled = true; clearTimeout(timeout); resolve(this.ready);}
        }
      });
      child.stderr.on('data', bytes => {errors = (errors + bytes).slice(-16000);});
      child.stdin.on('error', () => {});
      child.once('error', error => fail(error));
      child.once('close', (code, signal) => {
        const interrupted = !this.stopping;
        this.child = null; this.ready = null;
        fail(new Error(errors.trim() || `Corpus backend stopped (${signal || code})`));
        if (interrupted) void this.cleanupRuntime(runtime).catch(() => {});
        if (interrupted && settled) this.emit('interrupted', errors.trim() || 'The corpus backend stopped unexpectedly. Your saved revisions are preserved; retry to recover.');
      });
    });
  }
  async request(route, {method = 'GET', headers = {}, body, signal} = {}) {
    const ready = this.ready;
    if (!ready) throw new Error('No corpus backend is ready');
    return fetch(`http://127.0.0.1:${ready.port}${route}`, {method, headers: {...headers, 'X-WB-Desktop': ready.capability}, body, signal: signal ?? AbortSignal.timeout(120000), redirect: 'error'});
  }
  async stop() {
    this.stopping = true;
    const child = this.child, runtime = this.runtime;
    this.ready = null;
    if (!child) {await this.cleanupRuntime(runtime); return;}
    await new Promise(resolve => {
      let done = false;
      const finish = () => {if (done) return; done = true; clearTimeout(timer); resolve();};
      child.once('close', finish);
      const timer = setTimeout(() => {child.kill();}, 5000);
      try { child.stdin.end('shutdown\n'); } catch { child.kill(); }
      if (child.exitCode !== null) finish();
    });
    if (this.child === child) this.child = null;
    await this.cleanupRuntime(runtime);
  }
}
module.exports = {Backend, runCLI};
