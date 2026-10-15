'use strict';
const {contextBridge, ipcRenderer} = require('electron');
const call = (method, ...args) => ipcRenderer.invoke(`workbench:${method}`, ...args);
const listen = (channel, listener) => {
  if (typeof listener !== 'function') throw new TypeError('A listener is required');
  const handler = (_event, value) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld('workbenchDesktop', Object.freeze({
  state: () => call('state'),
  chooseOpen: () => call('chooseOpen'),
  importPackage: () => call('importPackage'),
  previewPreparation: options => call('previewPreparation', options),
  commitPreparation: token => call('commitPreparation', token),
  cancelPreparation: token => call('cancelPreparation', token),
  createDemo: () => call('createDemo'),
  openRecent: id => call('openRecent', id),
  exportRevision: revision => call('exportRevision', revision),
  backup: () => call('backup'),
  retry: () => call('retry'),
  semanticaState: () => call('semanticaState'),
  configureSemantica: () => call('configureSemantica'),
  runSemantica: basis => call('runSemantica', basis),
  exportSemantica: basis => call('exportSemantica', basis),
  revealSemantica: () => call('revealSemantica'),
  readDraftJournal: () => call('readDraftJournal'),
  persistDraftJournal: raw => call('persistDraftJournal', raw),
  reportDraft: status => call('reportDraft', status).catch(() => false),
  reportAppearance: appearance => call('reportAppearance', appearance).catch(() => false),
  onState: listener => listen('workbench:state', listener),
  onMenu: listener => listen('workbench:menu', listener),
}));
