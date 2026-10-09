'use strict';
const {app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell, nativeTheme} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {Readable} = require('node:stream');
const {Backend, runCLI} = require('./backend.cjs');
const {Registry} = require('./registry.cjs');
const {Journal} = require('./journal.cjs');
const security = require('./security.cjs');

protocol.registerSchemesAsPrivileged([{scheme: 'workbench', privileges: {standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true}}]);
app.setName('Open-K-Folds Workbench');
if (process.env.WB_DESKTOP_USER_DATA) {
  if (!path.isAbsolute(process.env.WB_DESKTOP_USER_DATA)) throw new Error('Desktop profile path must be absolute');
  app.setPath('userData', process.env.WB_DESKTOP_USER_DATA);
}
const resources = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'desktop', 'resources');
const binary = process.env.WB_DESKTOP_BACKEND || (app.isPackaged ? path.join(process.resourcesPath, 'backend', 'corpus-workbench.exe') : path.join(resources, 'backend', process.platform === 'win32' ? 'corpus-workbench.exe' : 'corpus-workbench'));
const ui = path.join(resources, 'ui');
let window, backend, registry, journal, current = null, status = 'idle', error = null, busy = false, quitting = false, quitRequested = false, permitUnload = false;
let drafts = {dirty: false, recoverable: false, saving: false};
const publicState = () => ({status, project: current ? {id: current.id, project: current.project, title: current.title} : null, recent: registry?.publicRecent() ?? [], error, version: app.getVersion()});
const sendState = () => {if (window && !window.isDestroyed()) window.webContents.send('workbench:state', publicState());};
const sendMenu = command => {if (window && !window.isDestroyed()) window.webContents.send('workbench:menu', command);};
async function refreshDrafts() {sendMenu('draft-status'); await new Promise(resolve => setTimeout(resolve, 120));}
async function canLeave(action) {
  await refreshDrafts();
  if (drafts.saving) {
    await dialog.showMessageBox(window, {type: 'warning', title: 'Resolve the pending save', message: 'A save is still being resolved.', detail: 'Keep this project open until the original bound command is resolved. This protects the exact revision and command identity.', buttons: ['Keep editing'], noLink: true});
    return false;
  }
  if (!drafts.dirty) return true;
  const result = await dialog.showMessageBox(window, {type: 'question', title: 'Unsaved changes', message: `Unsaved changes before ${action}.`, detail: drafts.recoverable ? 'Your inline correction is stored locally and will be offered when this project reopens. The source package and saved revisions are preserved.' : 'Some changes are only in this window. Leaving will discard those unsaved changes. Locally retained corrections will remain available for recovery.', buttons: ['Keep editing', drafts.recoverable ? 'Leave and retain draft' : 'Discard unsaved changes'], defaultId: 0, cancelId: 0, noLink: true});
  return result.response === 1;
}
async function operation(work) {
  if (busy) throw new Error('A desktop operation is already in progress');
  busy = true;
  try { return await work(); } finally {busy = false;}
}
async function switchProject(entry, options = {}) {
  if (current?.store === entry.store && current?.project === entry.project && status === 'ready') {window.focus(); return publicState();}
  if (!options.initial && !await canLeave('opening another project')) return publicState();
  const previous = current, previousDrafts = drafts;
  status = 'loading'; error = null; sendState();
  try {
    await backend.stop();
    await backend.start(entry.store, entry.project);
    current = options.transient ? entry : await registry.remember(entry.store, entry.project, entry.title);
    status = 'ready'; drafts = {dirty: false, recoverable: false, saving: false};
    window.setTitle(`${current.title} — Open-K-Folds Workbench`);
    sendState();
    if (!options.initial) {permitUnload = true; window.reload();}
  } catch (failure) {
    await backend.stop();
    if (previous && (previous.store !== entry.store || previous.project !== entry.project)) {
      current = previous; drafts = previousDrafts;
      try {await backend.start(previous.store, previous.project); status = 'ready'; error = `Could not open ${entry.title}: ${failure.message}. Your previous project remains open.`;}
      catch (restoreFailure) {status = 'error'; error = `Could not open ${entry.title}: ${failure.message}. Reopening your previous project also failed: ${restoreFailure.message}`;}
    } else {current = entry; status = 'error'; error = failure.message;}
    sendState();
  }
  return publicState();
}
async function chooseOpen() {
  return operation(async () => {
    const picked = await dialog.showOpenDialog(window, {title: 'Open a corpus authority', buttonLabel: 'Open authority', properties: ['openDirectory'], message: 'Choose the folder containing ledger.sqlite and objects.'});
    if (picked.canceled || !picked.filePaths.length) return publicState();
    const store = await fs.realpath(picked.filePaths[0]);
    const inspected = JSON.parse(await runCLI(binary, ['projects', '--store', store]));
    const projects = Array.isArray(inspected) ? inspected : inspected.projects;
    if (!Array.isArray(projects) || !projects.length || projects.some(value => typeof value !== 'string' || !value || value.length > 128)) throw new Error('This authority contains no supported corpus projects');
    let project = projects[0];
    if (projects.length > 1) {
      if (projects.length > 12) throw new Error('This authority has more than 12 projects. Open a specific project with the existing CLI, or use an authority with fewer projects.');
      const selected = await dialog.showMessageBox(window, {type: 'question', title: 'Choose a corpus project', message: 'Open a project from this authority', buttons: [...projects, 'Cancel'], cancelId: projects.length, noLink: true});
      if (selected.response >= projects.length) return publicState();
      project = projects[selected.response];
    }
    return switchProject({id: randomUUID(), store, project, title: project});
  });
}
async function importDirectory(source, title) {
  if (!await canLeave('importing a corpus')) return publicState();
  const id = randomUUID(), store = path.join(app.getPath('userData'), 'projects', id), project = title === 'Synthetic practice corpus' ? 'synthetic' : `corpus-${id.slice(0, 8)}`;
  status = 'loading'; error = null; sendState();
  try {
    await runCLI(binary, ['import', '--store', store, '--project', project, '--package', source]);
    const entry = await registry.remember(store, project, title);
    return await switchProject(entry, {initial: true}).then(result => {if (result.status === 'ready' && result.project?.id === entry.id) {permitUnload = true; window.reload();} return result;});
  } catch (failure) {status = backend.ready ? 'ready' : 'error'; error = `Import failed: ${failure.message}`; sendState(); throw failure;}
}
async function importPackage() {
  return operation(async () => {
    const picked = await dialog.showOpenDialog(window, {title: 'Import a complete corpus package', buttonLabel: 'Import package', properties: ['openDirectory'], message: 'The source folder stays intact. A new local authority stores revisions and history.'});
    if (picked.canceled || !picked.filePaths.length) return publicState();
    const source = await fs.realpath(picked.filePaths[0]);
    return importDirectory(source, path.basename(source));
  });
}
async function exportRevision(value) {
  const revision = security.revision(value);
  return operation(async () => {
    if (!current || status !== 'ready') throw new Error('Open a corpus before exporting');
    const picked = await dialog.showSaveDialog(window, {title: `Export exact revision ${revision}`, buttonLabel: 'Export package', defaultPath: `${current.project}-R${revision}.zip`, filters: [{name: 'Complete corpus package', extensions: ['zip']}], properties: ['showOverwriteConfirmation', 'createDirectory']});
    if (picked.canceled || !picked.filePath) return {cancelled: true};
    const response = await backend.request('/api/export', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({revision})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Export failed');
    if (typeof result.download !== 'string' || !/^\/api\/download\?id=export-[a-f0-9-]+$/.test(result.download)) throw new Error('Invalid export response');
    const download = await backend.request(result.download);
    if (!download.ok || !download.body) throw new Error('Export download failed');
    const destination = picked.filePath, temporary = `${destination}.${randomUUID()}.partial`;
    try {
      const {pipeline} = require('node:stream/promises');
      await pipeline(Readable.fromWeb(download.body), require('node:fs').createWriteStream(temporary, {flags: 'wx'}));
      await fs.rename(temporary, destination);
    } catch (failure) {await fs.rm(temporary, {force: true}); throw failure;}
    return {cancelled: false, filename: path.basename(destination), revision};
  });
}
async function backup() {
  return operation(async () => {
    if (!current || status !== 'ready') throw new Error('Open a corpus before creating a backup');
    const picked = await dialog.showSaveDialog(window, {title: 'Save a verified authority backup', buttonLabel: 'Save backup folder', defaultPath: `${current.project}-backup-${new Date().toISOString().slice(0, 10)}`, properties: ['createDirectory']});
    if (picked.canceled || !picked.filePath) return {cancelled: true};
    await runCLI(binary, ['backup', '--store', current.store, '--out', picked.filePath]);
    return {cancelled: false, filename: path.basename(picked.filePath)};
  });
}
async function requestQuit() {
  if (quitting || quitRequested) return;
  quitRequested = true;
  try {
    if (busy) {await dialog.showMessageBox(window, {type: 'info', title: 'Corpus operation in progress', message: 'Wait for the current import, export or backup to finish before closing.', buttons: ['Keep open'], noLink: true}); return;}
    if (!await canLeave('closing the workbench')) return;
    quitting = true;
    const cleanupErrors = [];
    if (window && !window.isDestroyed() && registry) {registry.data.bounds = window.getNormalBounds(); try {await registry.save();} catch (failure) {cleanupErrors.push(failure.message);}}
    await journal?.pending;
    try {await backend?.stop();} catch (failure) {cleanupErrors.push(failure.message);}
    if (cleanupErrors.length) await dialog.showMessageBox(window, {type: 'warning', title: 'Workbench shutdown', message: 'The corpus is closed, but some desktop metadata or temporary files could not be saved or cleared.', detail: cleanupErrors.join('\n'), buttons: ['Close'], noLink: true});
    app.quit();
  } finally {quitRequested = false;}
}
function installIPC() {
  const handlers = {state: () => publicState(), chooseOpen, importPackage, createDemo: () => operation(() => importDirectory(path.join(resources, 'demo'), 'Synthetic practice corpus')), openRecent: id => operation(async () => {const entry = registry.get(security.recentId(id)); if (!entry) throw new Error('Project is no longer in the recent list'); return switchProject(entry);}), exportRevision, backup, retry: () => operation(async () => {
    if (!current) return publicState();
    status = 'loading'; error = null; sendState();
    try {await backend.stop(); await backend.start(current.store, current.project); status = 'ready'; sendState(); sendMenu('backend-reconnected');}
    catch (failure) {status = 'error'; error = failure.message; sendState();}
    return publicState();
  }), readDraftJournal: () => journal.read(), persistDraftJournal: raw => journal.write(raw), reportDraft: value => {drafts = security.draftState(value); return true;}, reportAppearance: value => {if (!['light', 'dark', 'system'].includes(value)) throw new Error('Invalid appearance'); nativeTheme.themeSource = value; window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#151c25' : '#f5f6f8'); return true;}};
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(`workbench:${name}`, async (event, ...args) => {
    if (!security.trustedSender(event, window)) throw new Error('Desktop command denied');
    const expected = ['openRecent', 'exportRevision', 'reportDraft', 'reportAppearance', 'persistDraftJournal'].includes(name) ? 1 : 0;
    if (args.length !== expected) throw new Error('Invalid desktop command arguments');
    return handler(...args);
  });
}
function installMenu() {
  const native = action => void action().catch(failure => dialog.showMessageBox(window, {type: 'error', title: 'Corpus workbench', message: failure.message}));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label: '&File', submenu: [{label: 'Open corpus authority…', accelerator: 'CmdOrCtrl+O', click: () => native(chooseOpen)}, {label: 'Import corpus package…', accelerator: 'CmdOrCtrl+Shift+O', click: () => native(importPackage)}, {type: 'separator'}, {label: 'Save correction', accelerator: 'CmdOrCtrl+S', click: () => sendMenu('save')}, {label: 'Export exact revision…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenu('export')}, {label: 'Create verified backup…', click: () => native(backup)}, {type: 'separator'}, {label: 'Close workbench', accelerator: 'Alt+F4', click: () => void requestQuit()}]},
    {label: '&Edit', submenu: [{role: 'undo'}, {role: 'redo'}, {type: 'separator'}, {role: 'cut'}, {role: 'copy'}, {role: 'paste'}, {role: 'selectAll'}, {type: 'separator'}, {label: 'Search corpus', accelerator: 'CmdOrCtrl+F', click: () => sendMenu('search')}]},
    {label: '&View', submenu: [{label: 'Revision history', accelerator: 'CmdOrCtrl+H', click: () => sendMenu('history')}, {label: 'Toggle inspector', accelerator: 'CmdOrCtrl+Shift+I', click: () => sendMenu('toggle-inspector')}, {label: 'Toggle recording', accelerator: 'CmdOrCtrl+Shift+A', click: () => sendMenu('toggle-recording')}, {type: 'separator'}, {label: 'Reload workbench', accelerator: 'CmdOrCtrl+R', click: () => native(async () => {if (await canLeave('reloading')) {permitUnload = true; window.reload();}})}, {role: 'resetZoom'}, {role: 'zoomIn'}, {role: 'zoomOut'}, {role: 'togglefullscreen'}]},
    {label: '&Help', submenu: [{label: 'About Open-K-Folds Workbench', click: () => native(() => dialog.showMessageBox(window, {type: 'info', title: 'Open-K-Folds Workbench', message: `Open-K-Folds Workbench ${app.getVersion()}`, detail: 'Local transcript authoring, immutable revisions and reviewed evidence. GPL-3.0-or-later.\nYour corpus stays on this computer.', buttons: ['Close']}))}]},
  ]));
}
function responseError(message, code) { return new Response(JSON.stringify({error: message}), {status: code, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Security-Policy': security.CSP}}); }
async function handleProtocol(request) {
  if (!security.appURL(request.url) || request.initiatorOrigin && request.initiatorOrigin !== security.ORIGIN) return responseError('App origin denied', 403);
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    if (!security.apiRoute(request.url, request.method)) return responseError('API route denied', 403);
    if (!backend.ready) return responseError('The corpus backend is unavailable. Retry opening this project.', 503);
    try {
      const headers = {};
      for (const name of ['content-type', 'range']) {const value = request.headers.get(name); if (value && value.length < 256) headers[name] = value;}
      const body = request.method === 'POST' ? Buffer.from(await request.arrayBuffer()) : undefined;
      const limit = url.pathname === '/api/return/file' ? 64 * 1024 * 1024 : 1024 * 1024;
      if (body?.length > limit) return responseError('Request size limit exceeded', 413);
      const upstream = await backend.request(url.pathname + url.search, {method: request.method, headers, body});
      const safeHeaders = new Headers({'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': security.CSP});
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {const value = upstream.headers.get(name); if (value) safeHeaders.set(name, value);}
      return new Response(upstream.body, {status: upstream.status, headers: safeHeaders});
    } catch (failure) {return responseError(failure.message, 503);}
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return responseError('Method denied', 405);
  try {
    const file = security.staticPath(ui, request.url), bytes = request.method === 'HEAD' ? null : await fs.readFile(file);
    const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8'}[path.extname(file)] || 'application/octet-stream';
    return new Response(bytes, {headers: {'Content-Type': mime, 'Content-Security-Policy': security.CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'}});
  } catch {return new Response('App asset not found', {status: 404});}
}
async function main() {
  if (!app.requestSingleInstanceLock()) {app.quit(); return;}
  app.on('second-instance', () => {if (window) {if (window.isMinimized()) window.restore(); window.focus();}});
  await app.whenReady();
  nativeTheme.themeSource = 'light';
  const profile = app.getPath('userData');
  registry = new Registry(profile);
  journal = new Journal(profile);
  try {await registry.load();} catch (failure) {status = 'error'; error = failure.message;}
  backend = new Backend(binary, ui, path.join(profile, 'runtime'));
  backend.on('interrupted', message => {if (!quitting) {status = 'error'; error = message; sendState();}});
  const partition = 'persist:workbench', browserSession = session.fromPartition(partition);
  browserSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  browserSession.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write');
  browserSession.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*', 'file://*/*', 'ws://*/*', 'wss://*/*']}, (_details, callback) => callback({cancel: true}));
  browserSession.protocol.handle('workbench', handleProtocol);
  const saved = registry.data.bounds;
  const bounds = saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite) ? {width: Math.max(1000, Math.min(saved.width, 2560)), height: Math.max(700, Math.min(saved.height, 1600))} : {width: 1440, height: 1000};
  window = new BrowserWindow({...bounds, minWidth: 1000, minHeight: 700, show: false, icon: path.join(resources, 'icon.png'), backgroundColor: '#f5f6f8', title: 'Open-K-Folds Workbench', webPreferences: {preload: path.join(__dirname, 'preload.cjs'), partition, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false}});
  window.webContents.setWindowOpenHandler(({url}) => {const target = security.externalURL(url); if (target) void shell.openExternal(target); return {action: 'deny'};});
  window.webContents.on('will-navigate', (event, url) => {if (!security.appURL(url)) {event.preventDefault(); const target = security.externalURL(url); if (target) void shell.openExternal(target);}});
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', async (_event, details) => {
    if (quitting) return;
    const result = await dialog.showMessageBox(window, {type: 'error', title: 'The workbench window stopped', message: 'The workbench window needs to reopen.', detail: `Saved revisions and locally retained correction drafts remain available. Changes held only in the stopped window could not be retained.\nReason: ${details.reason}`, buttons: ['Reopen workbench', 'Close'], defaultId: 0, cancelId: 1, noLink: true});
    drafts = {dirty: false, recoverable: false, saving: false};
    if (result.response === 0) {permitUnload = true; window.reload();} else void requestQuit();
  });
  window.webContents.on('will-prevent-unload', event => {if (quitting || permitUnload) {permitUnload = false; event.preventDefault();}});
  window.webContents.on('did-finish-load', () => {permitUnload = false;});
  window.on('close', event => {if (!quitting) {event.preventDefault(); void requestQuit();}});
  window.on('ready-to-show', () => window.show());
  installIPC(); installMenu();
  let startup = null, transient = false;
  if (status !== 'error') {
    const override = process.env.WB_DESKTOP_STORE;
    if (override) {
      if (!path.isAbsolute(override) || !process.env.WB_DESKTOP_PROJECT) throw new Error('Startup authority requires an absolute store path and project ID');
      startup = {id: randomUUID(), store: override, project: process.env.WB_DESKTOP_PROJECT, title: process.env.WB_DESKTOP_PROJECT}; transient = true;
    } else {
      const recent = registry.get(registry.data.current);
      if (recent) startup = recent;
    }
  }
  if (startup) {status = 'loading'; current = startup; busy = true;}
  await window.loadURL(`${security.ORIGIN}/`);
  if (startup) {
    try {await switchProject(startup, {initial: true, transient}); if (status === 'ready') {permitUnload = true; window.reload();}}
    finally {busy = false;}
  }
}
app.on('before-quit', event => {if (!quitting) {event.preventDefault(); void requestQuit();}});
app.on('window-all-closed', () => app.quit());
process.on('exit', () => {try {backend?.child?.kill();} catch {}});
main().catch(async failure => {await dialog.showMessageBox({type: 'error', title: 'Workbench startup failed', message: failure.message, detail: 'Your corpus data has been preserved.'}); quitting = true; await backend?.stop(); app.quit();});
