'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
async function physicalLocation(target) {
  const remaining = [];
  let ancestor = target;
  for (;;) {
    try {return path.resolve(await fs.realpath(ancestor), ...remaining.reverse());}
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      remaining.push(path.basename(ancestor)); ancestor = parent;
    }
  }
}
async function resolvePackagingOutput(root, args = []) {
  if (args.length && (args.length !== 2 || args[0] !== '--out' || !args[1]?.trim())) throw new Error('Usage: node desktop/package.cjs [--out release/DIRECTORY]');
  const requested = args[1] || path.join('release', 'desktop');
  const release = path.resolve(root, 'release'), output = path.resolve(root, requested), relative = path.relative(release, output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || requested.split(/[\\/]/).includes('..')) throw new Error('Package output must be a directory inside this checkout\'s release folder');
  const canonicalRoot = await fs.realpath(root), expected = path.resolve(canonicalRoot, 'release', relative);
  const finalDirectory = path.join(output, 'Open-K-Folds Workbench-win32-x64');
  if (path.relative(expected, await physicalLocation(output)) || path.relative(path.join(expected, 'Open-K-Folds Workbench-win32-x64'), await physicalLocation(finalDirectory))) throw new Error('Package output must not use a linked directory or alias another build');
  return output;
}
async function packageWindows() {
  if (process.platform !== 'win32') throw new Error('This local packaging script is verified only on Windows');
  const root = path.resolve(__dirname, '..'), resources = path.join(__dirname, 'resources');
  const outputRoot = await resolvePackagingOutput(root, process.argv.slice(2));
  await fs.access(path.join(resources, 'backend', 'corpus-workbench.exe'));
  await fs.access(path.join(resources, 'ui', 'index.html'));
  await require('./icon.cjs').generateIcon(resources);
  const {packager} = await import('@electron/packager');
  const output = await packager({dir: root, out: outputRoot, name: 'Open-K-Folds Workbench', executableName: 'Open-K-Folds Workbench', icon: path.join(resources, 'icon.ico'), platform: 'win32', arch: 'x64', overwrite: true, asar: true, prune: true, extraResource: ['backend', 'ui', 'demo', 'icon.png'].map(name => path.join(resources, name)), ignore: file => {
    const relative = file.replaceAll('\\', '/');
    if (!relative || relative === '/package.json') return false;
    if (relative === '/package-lock.json' || relative.startsWith('/node_modules')) return true;
    if (relative === '/desktop') return false;
    if (relative.startsWith('/desktop/')) return !['backend.cjs', 'main.cjs', 'preload.cjs', 'registry.cjs', 'security.cjs', 'journal.cjs'].includes(relative.slice('/desktop/'.length));
    return true;
  }, win32metadata: {CompanyName: 'Open-K-Folds', FileDescription: 'Transcript-first corpus workbench', ProductName: 'Open-K-Folds Workbench', InternalName: 'Open-K-Folds Workbench'}, appCopyright: 'Open-K-Folds contributors; GPL-3.0-or-later'});
  for (const directory of output) {
    await fs.copyFile(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE.workbench'));
    await fs.copyFile(path.join(root, 'NOTICE'), path.join(directory, 'NOTICE.workbench'));
    const sourceCommit = require('node:child_process').spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8', windowsHide: true}).stdout.trim();
    const sourceDirty = !!require('node:child_process').spawnSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8', windowsHide: true}).stdout.trim();
    const manifest = {application: 'Open-K-Folds Workbench', version: require('../package.json').version, platform: 'win32', architecture: 'x64', electron: require('../package.json').devDependencies.electron, sourceCommit, sourceDirty, signed: false, backend: crypto.createHash('sha256').update(await fs.readFile(path.join(directory, 'resources', 'backend', 'corpus-workbench.exe'))).digest('hex')};
    await fs.writeFile(path.join(directory, 'local-build.json'), JSON.stringify(manifest, null, 2));
    console.log(`Runnable local Windows package: ${directory}`);
  }
}
module.exports = {resolvePackagingOutput};
if (require.main === module) packageWindows().catch(error => {console.error(error.stack); process.exitCode = 1;});
