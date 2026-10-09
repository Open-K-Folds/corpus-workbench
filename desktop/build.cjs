'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {cwd, stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32' && command.endsWith('.cmd')});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
async function build() {
  const cargo = process.env.WB_CARGO || 'cargo';
  run(cargo, ['build', '--release', '--locked']);
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], path.join(root, 'ui'));
  const resources = path.join(__dirname, 'resources');
  await require('./icon.cjs').generateIcon(resources);
  await fs.mkdir(path.join(resources, 'backend'), {recursive: true});
  await fs.copyFile(path.join(process.env.CARGO_TARGET_DIR || path.join(root, 'target'), 'release', process.platform === 'win32' ? 'corpus-workbench.exe' : 'corpus-workbench'), path.join(resources, 'backend', process.platform === 'win32' ? 'corpus-workbench.exe' : 'corpus-workbench'));
  const uiOutput = path.resolve(resources, 'ui');
  if (path.relative(resources, uiOutput) !== 'ui') throw new Error('Invalid generated UI output path');
  await fs.rm(uiOutput, {recursive: true, force: true});
  await fs.cp(path.join(root, 'ui', 'dist'), uiOutput, {recursive: true});
  const demo = path.join(resources, 'demo');
  await fs.cp(path.join(root, 'fixtures', 'synthetic'), demo, {recursive: true});
  await fs.mkdir(path.join(demo, 'Audio'), {recursive: true});
  const rate = 16000, samples = rate * 8, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) wav.writeInt16LE(Math.round(1200 * Math.sin(2 * Math.PI * 220 * index / rate)), 44 + index * 2);
  await fs.writeFile(path.join(demo, 'Audio', 'synthetic-workbench.wav'), wav);
  console.log('Built desktop sidecar, UI and clearly synthetic practice corpus.');
}
build().catch(error => {console.error(error.message); process.exitCode = 1;});
