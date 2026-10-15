'use strict';
// Native main owns source pickers. The renderer receives an opaque preview token;
// commit imports the immutable, bounded bytes shown in that preview.
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {runCLI: nativeCLI} = require('./backend.cjs');

const MAX_FILE = 64 * 1024 * 1024;
const MAX_PACKAGE = 256 * 1024 * 1024;
const MAX_XML = 16 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const FORMATS = ['utf8-text', 'omnilingual-json'];
const VERSION = 'local-transcript/1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value));
const samePath = (left, right) => process.platform === 'win32' ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right);
const safeName = value => path.basename(value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160);
const validRelative = value => typeof value === 'string' && value.length > 0 && value.length < 240 && !value.includes('\\') && !value.includes(':') && !value.includes('\0') && value.split('/').every(part => part && part !== '.' && part !== '..');
const identityKey = (format, version, sources) => hash(encoded({schema: 1, format, version, audio: sources.audio.sha256, transcript: sources.transcript.sha256}));
const identityId = key => `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20, 32)}`;
const validSources = sources => sources && ['audio', 'transcript'].every(kind => {
  const source = sources[kind];
  return source && HASH.test(source.sha256 ?? '') && Number.isSafeInteger(source.bytes) && source.bytes > 0 && source.bytes <= MAX_FILE && validRelative(source.path) && source.path.startsWith(kind === 'audio' ? 'Audio/' : 'Raw/') && typeof source.name === 'string';
});

async function readJSON(file) {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024) throw new Error('Preparation metadata is invalid and has been preserved.');
  try {return JSON.parse(await fs.readFile(file, 'utf8'));} catch {throw new Error('Preparation metadata is unreadable and has been preserved.');}
}
async function writeJSON(file, value, exclusive = false) {
  const destination = exclusive ? file : `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(destination, 'wx');
  try {await handle.writeFile(encoded(value)); await handle.sync();} finally {await handle.close();}
  if (!exclusive) await fs.rename(destination, file);
}
async function regularBytes(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Choose an absolute local source file.');
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Choose a regular source file, not a symbolic link or folder.');
  for (let ancestor = path.dirname(file); ; ancestor = path.dirname(ancestor)) {
    if ((await fs.lstat(ancestor)).isSymbolicLink()) throw new Error('Choose a regular source path without symbolic links or junctions.');
    if (path.dirname(ancestor) === ancestor) break;
  }
  if (info.size === 0 || info.size > MAX_FILE) throw new Error('Each source must contain data and fit the 64 MiB file limit.');
  const handle = await fs.open(file, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== info.size || opened.ino !== info.ino || opened.dev !== info.dev) throw new Error('A selected source changed while opening. Choose it again.');
    // Limit the read itself too: a growing source cannot bypass the preflight.
    const bytes = Buffer.alloc(info.size), extra = Buffer.alloc(1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    const final = await handle.stat();
    const trailing = await handle.read(extra, 0, 1, bytes.length);
    if (offset !== bytes.length || trailing.bytesRead || final.size !== opened.size || final.mtimeMs !== opened.mtimeMs || final.ctimeMs !== opened.ctimeMs) throw new Error('A selected source changed while reading. Choose it again.');
    return bytes;
  } finally {await handle.close();}
}

class PreparationController {
  constructor({profile, binary, registry, runCLI = nativeCLI, buildPackage} = {}) {
    if (typeof profile !== 'string' || !path.isAbsolute(profile) || typeof binary !== 'string' || !path.isAbsolute(binary) || typeof registry?.remember !== 'function') throw new Error('Preparation requires a native profile, backend and project registry.');
    this.profile = path.resolve(profile); this.root = path.join(this.profile, 'preparation');
    this.previews = path.join(this.root, 'previews'); this.receipts = path.join(this.root, 'receipts'); this.projects = path.join(this.profile, 'projects');
    this.binary = binary; this.registry = registry; this.runCLI = runCLI; this.buildPackage = buildPackage; this.busy = false;
  }
  async exclusive(work) {
    if (this.busy) throw new Error('A recording preparation operation is already in progress.');
    this.busy = true;
    try {return await work();} finally {this.busy = false;}
  }
  async directory(directory, parent) {
    await fs.mkdir(directory, {recursive: true});
    const info = await fs.lstat(directory), resolved = await fs.realpath(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || parent && !samePath(path.dirname(resolved), await fs.realpath(parent))) throw new Error('Preparation storage must remain inside its owned profile directories.');
    return resolved;
  }
  async roots() {
    await this.directory(this.profile);
    await this.directory(this.root, this.profile);
    await this.directory(this.previews, this.root);
    await this.directory(this.receipts, this.root);
    await this.directory(this.projects, this.profile);
  }
  previewFolder(token) {
    if (typeof token !== 'string' || !UUID.test(token)) throw new Error('Invalid preparation preview. Choose the recording and transcript again.');
    return path.join(this.previews, token);
  }
  async checkedPreview(token) {
    const folder = this.previewFolder(token), info = await fs.lstat(folder).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink() || !samePath(path.dirname(await fs.realpath(folder)), await fs.realpath(this.previews))) throw new Error('This preparation preview is unavailable. Choose the source files again.');
    const record = await readJSON(path.join(folder, 'preview.json'));
    if (record.schema !== 1 || record.token !== token || !FORMATS.includes(record.format) || record.version !== VERSION || !['preview', 'committed'].includes(record.status) || !HASH.test(record.key ?? '') || !validSources(record.sources) || !record.files || identityKey(record.format, record.version, record.sources) !== record.key) throw new Error('This preparation preview is invalid and has been preserved. Choose the sources again.');
    for (const source of [record.sources.audio, record.sources.transcript]) {
      if (!source || !HASH.test(source.sha256 ?? '') || !Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > MAX_FILE || !validRelative(source.path) || record.files[source.path]?.sha256 !== source.sha256 || record.files[source.path]?.bytes !== source.bytes) throw new Error('This preparation preview lost its source binding and has been preserved.');
    }
    return {folder, record};
  }
  async walk(directory, prefix = '') {
    const files = [];
    for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
      const relative = prefix + entry.name, absolute = path.join(directory, entry.name);
      const info = await fs.lstat(absolute);
      if (info.isSymbolicLink()) throw new Error('Preparation staging contains a symbolic link and was preserved.');
      if (info.isDirectory()) files.push(...await this.walk(absolute, relative + '/'));
      else if (info.isFile()) files.push(relative);
      else throw new Error('Preparation staging contains an unsupported file and was preserved.');
    }
    return files;
  }
  async removeOwnedPreview(token, packageOnly = false) {
    const folder = this.previewFolder(token);
    const info = await fs.lstat(folder).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!info) return;
    if (!info.isDirectory() || info.isSymbolicLink() || !samePath(path.dirname(await fs.realpath(folder)), await fs.realpath(this.previews))) throw new Error('Refusing cleanup outside an owned preparation preview.');
    const target = packageOnly ? path.join(folder, 'package') : folder;
    const targetInfo = await fs.lstat(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!targetInfo) return;
    if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink() || !samePath(await fs.realpath(target), target)) throw new Error('Preparation cleanup target changed and was preserved.');
    await this.walk(target); // Refuse links before any recursive deletion.
    await fs.rm(target, {recursive: true});
  }
  async receipt(record) {
    const file = path.join(this.receipts, `${record.key}.json`);
    let value;
    try {value = await readJSON(file);} catch (error) {if (error.code === 'ENOENT') return null; throw error;}
    if (value.schema !== 1 || value.key !== record.key || value.identity_id !== identityId(record.key) || value.project !== `prepared-${record.key.slice(0, 16)}` || !['reserved', 'imported'].includes(value.status) || value.format !== record.format || value.version !== record.version || !validSources(value.sources) || identityKey(value.format, value.version, value.sources) !== record.key || ['audio', 'transcript'].some(kind => value.sources[kind].bytes !== record.sources[kind].bytes) || typeof value.title !== 'string') throw new Error('The earlier preparation identity is invalid and was preserved. Do not create another copy; recover its recorded authority.');
    return value;
  }
  async preview({audioPath, transcriptPath, format, title} = {}) {
    if (!FORMATS.includes(format)) throw new Error('Choose UTF-8 text or supported Omnilingual JSON.');
    if (title !== undefined && (typeof title !== 'string' || title.length > 160 || /[\u0000-\u001f\u007f]/.test(title))) throw new Error('Use a recording title of at most 160 characters without control characters.');
    return this.exclusive(async () => {
      await this.roots();
      const [audioBytes, transcriptBytes] = await Promise.all([regularBytes(audioPath), regularBytes(transcriptPath)]);
      const selectedTitle = title?.trim() || safeName(transcriptPath).replace(/\.[^.]+$/, '') || 'Prepared recording';
      const parser = this.buildPackage ?? require('./preparation-format.cjs').buildPackage;
      const result = parser({audioBytes, audioName: path.basename(audioPath), transcriptBytes, transcriptName: path.basename(transcriptPath), format, title: selectedTitle});
      if (!result || result.version !== VERSION || !result.files || typeof result.files !== 'object') throw new Error('The preparation format did not return a supported versioned package.');
      const entries = Object.entries(result.files), files = {};
      let total = 0;
      if (!entries.length || entries.length >= 10000) throw new Error('Prepared package exceeds its file-count limit.');
      for (const [name, bytes] of entries) {
        if (!validRelative(name) || !Buffer.isBuffer(bytes) || bytes.length > MAX_FILE || /\.xml$/i.test(name) && bytes.length > MAX_XML) throw new Error('A prepared file exceeds its supported path or size limit.');
        total += bytes.length;
        if (total > MAX_PACKAGE) throw new Error('Prepared package exceeds the 256 MiB total limit.');
        files[name] = {sha256: hash(bytes), bytes: bytes.length};
      }
      const audioFiles = entries.filter(([name]) => name.startsWith('Audio/')), rawFiles = entries.filter(([name]) => name.startsWith('Raw/'));
      if (audioFiles.length !== 1 || rawFiles.length !== 1 || !audioFiles[0][1].equals(audioBytes) || !rawFiles[0][1].equals(transcriptBytes)) throw new Error('Preparation must retain both original source files byte for byte.');
      const sources = {audio: {name: path.basename(audioPath), path: audioFiles[0][0], sha256: hash(audioBytes), bytes: audioBytes.length}, transcript: {name: path.basename(transcriptPath), path: rawFiles[0][0], sha256: hash(transcriptBytes), bytes: transcriptBytes.length}};
      const key = identityKey(format, VERSION, sources), token = randomUUID(), folder = this.previewFolder(token);
      const rawSummary = result.summary ?? {};
      const summary = {format, segments: rawSummary.segments, tokens: rawSummary.tokens, text: typeof rawSummary.text === 'string' ? rawSummary.text.slice(0, 2000) : '', timing: typeof rawSummary.timing === 'string' ? rawSummary.timing.slice(0, 240) : '', warnings: Array.isArray(rawSummary.warnings) ? rawSummary.warnings.filter(value => typeof value === 'string').slice(0, 12).map(value => value.slice(0, 500)) : []};
      if (![summary.segments, summary.tokens].every(value => Number.isSafeInteger(value) && value >= 0) || !summary.tokens) throw new Error('The prepared transcript contains no supported tokens.');
      const record = {schema: 1, token, key, status: 'preview', format, version: VERSION, title: selectedTitle, sources, files, summary};
      const earlier = await this.receipt(record);
      // An interrupted native import may have committed before its receipt was
      // marked imported. Describe the authority that commit will actually open.
      const duplicate = earlier ? Boolean(await this.inspect(earlier)) : false;
      await fs.mkdir(folder);
      try {
        const stage = path.join(folder, 'package'); await fs.mkdir(stage);
        for (const [name, bytes] of entries) {
          const target = path.join(stage, ...name.split('/'));
          await fs.mkdir(path.dirname(target), {recursive: true});
          await fs.writeFile(target, bytes, {flag: 'wx'});
        }
        await writeJSON(path.join(folder, 'preview.json'), record, true);
      } catch (error) {await this.removeOwnedPreview(token).catch(() => {}); throw error;}
      const publicSource = ({name, sha256, bytes}) => ({name, sha256, bytes});
      return {token, key, duplicate, summary, sources: {audio: publicSource(sources.audio), transcript: publicSource(sources.transcript)}, copy_policy: 'frozen-preview'};
    });
  }
  async verifyStage(folder, record) {
    const stage = path.join(folder, 'package'), info = await fs.lstat(stage).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink() || !samePath(path.dirname(await fs.realpath(stage)), folder)) throw new Error('The frozen preparation package is unavailable and has been preserved. Choose the sources again.');
    const names = await this.walk(stage), expected = Object.keys(record.files);
    if (names.length !== expected.length || names.some(name => !Object.hasOwn(record.files, name))) throw new Error('The frozen preparation package changed. Cancel it and preview the source files again.');
    let total = 0;
    for (const name of expected) {
      if (!validRelative(name)) throw new Error('The preparation package has an invalid file path.');
      const bytes = await regularBytes(path.join(stage, ...name.split('/')));
      total += bytes.length;
      if (total > MAX_PACKAGE || /\.xml$/i.test(name) && bytes.length > MAX_XML || hash(bytes) !== record.files[name].sha256 || bytes.length !== record.files[name].bytes) throw new Error('The frozen preparation bytes changed. Cancel it and preview the source files again.');
    }
    return stage;
  }
  async inspect(receipt) {
    const store = path.join(this.projects, receipt.identity_id);
    const directory = await fs.lstat(store).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!directory) {
      if (receipt.status === 'imported') throw new Error('The earlier prepared authority is unavailable. Restore it or open its backup; another copy was not created.');
      return null;
    }
    if (!directory.isDirectory() || directory.isSymbolicLink() || !samePath(path.dirname(await fs.realpath(store)), await fs.realpath(this.projects))) throw new Error('The recorded preparation authority moved outside its owned project directory.');
    const ledger = await fs.lstat(path.join(store, 'ledger.sqlite')).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!ledger) {
      if (receipt.status === 'imported' || (await fs.readdir(store)).length) throw new Error('The earlier preparation authority is incomplete and was preserved. Recover it before retrying.');
      return null;
    }
    if (!ledger.isFile() || ledger.isSymbolicLink()) throw new Error('The recorded preparation ledger is not a regular local file.');
    let projects;
    try {const discovered = JSON.parse(await this.runCLI(this.binary, ['projects', '--store', store])); projects = Array.isArray(discovered) ? discovered : discovered?.projects;}
    catch {throw new Error('The earlier preparation authority could not be checked. It was preserved; retry when it is available.');}
    if (!Array.isArray(projects)) throw new Error('The backend returned no valid preparation authority discovery.');
    if (!projects.includes(receipt.project)) {
      if (receipt.status === 'imported' || projects.length) throw new Error('The earlier preparation identity no longer matches its authority. It was preserved.');
      return null;
    }
    let view;
    try {view = JSON.parse(await this.runCLI(this.binary, ['view', '--store', store, '--project', receipt.project]));}
    catch {throw new Error('The prepared authority could not be verified. Its source files and saved revisions were preserved.');}
    if (view.snapshot?.project !== receipt.project || !Number.isSafeInteger(view.revision?.id) || !HASH.test(view.revision?.snapshot_hash ?? '') || Object.values(receipt.sources).some(source => view.snapshot.files?.[source.path]?.sha256 !== source.sha256 || view.snapshot.files?.[source.path]?.bytes !== source.bytes)) throw new Error('The prepared authority does not retain the recorded original source hashes. It was preserved without another import.');
    return {store, revision: view.revision.id, snapshot_hash: view.revision.snapshot_hash};
  }
  async commit(token) {
    return this.exclusive(async () => {
      await this.roots();
      const {folder, record} = await this.checkedPreview(token);
      const stage = record.status === 'committed' ? null : await this.verifyStage(folder, record);
      let receipt = await this.receipt(record);
      const receiptFile = path.join(this.receipts, `${record.key}.json`);
      if (!receipt) {
        receipt = {schema: 1, key: record.key, identity_id: identityId(record.key), project: `prepared-${record.key.slice(0, 16)}`, title: record.title, status: 'reserved', format: record.format, version: record.version, sources: record.sources};
        try {await writeJSON(receiptFile, receipt, true);} catch (error) {if (error.code !== 'EEXIST') throw error; receipt = await this.receipt(record);}
      }
      let inspected = await this.inspect(receipt), reused = Boolean(inspected), recovered = false;
      if (!inspected) {
        if (!stage) throw new Error('This committed preview has no recoverable authority. Restore its backup; another import was not attempted.');
        const store = path.join(this.projects, receipt.identity_id);
        let failed = false;
        try {await this.runCLI(this.binary, ['import', '--store', store, '--project', receipt.project, '--package', stage]);} catch {failed = true;}
        // Native transaction/objects are authoritative even after response loss.
        inspected = await this.inspect(receipt);
        if (!inspected) throw new Error('Preparation import did not commit. Its preview and partial authority were preserved; retry this preview safely.');
        recovered = failed;
      }
      receipt = {...receipt, status: 'imported', revision: inspected.revision, snapshot_hash: inspected.snapshot_hash};
      await writeJSON(receiptFile, receipt);
      let entry;
      try {entry = await this.registry.remember(inspected.store, receipt.project, receipt.title);}
      catch {throw new Error('The prepared corpus was imported and preserved, but adding it to Recent projects failed. Retry this preview to reopen the same authority.');}
      if (!entry || typeof entry.id !== 'string' || !UUID.test(entry.id) || !samePath(entry.store ?? '', inspected.store) || entry.project !== receipt.project) throw new Error('The prepared corpus is preserved, but the project registry did not confirm its identity. Retry this preview.');
      await writeJSON(path.join(folder, 'preview.json'), {...record, status: 'committed'});
      await this.removeOwnedPreview(token, true).catch(() => {});
      return {entry, reused, recovered};
    });
  }
  async cancel(token) {
    return this.exclusive(async () => {await this.roots(); await this.removeOwnedPreview(token); return {cancelled: true};});
  }
  // Keep unfinished previews for explicit retry/cancellation after an interruption.
  async dispose() {}
}

module.exports = {PreparationController};
