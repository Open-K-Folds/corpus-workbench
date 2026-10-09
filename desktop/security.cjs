'use strict';
const path = require('node:path');
const ORIGIN = 'workbench://app';
const GET = new Set(['/api/session', '/api/view', '/api/history', '/api/inventory', '/api/teitok-reader', '/api/generations', '/api/generation', '/api/diff', '/api/reading', '/api/xml', '/api/contract', '/api/media', '/api/download']);
const POST = new Set(['/api/command', '/api/preflight', '/api/retokenize-preview', '/api/search', '/api/search/resolve', '/api/return/start', '/api/return/file', '/api/return/finish', '/api/return/cancel', '/api/return/preview', '/api/review', '/api/export']);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
function appURL(value) {
  try { const u = new URL(value); return u.protocol === 'workbench:' && u.host === 'app' && !u.username && !u.password && !u.port; } catch { return false; }
}
function trustedSender(event, window) {
  return !!window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && appURL(event.senderFrame.url) && ['/', '/index.html'].includes(new URL(event.senderFrame.url).pathname);
}
function apiRoute(url, method) {
  if (!appURL(url)) return false;
  const u = new URL(url);
  return (method === 'GET' ? GET : method === 'POST' ? POST : new Set()).has(u.pathname) && u.search.length <= 8192;
}
function staticPath(root, url) {
  if (!appURL(url)) throw new Error('Unsupported app origin');
  const u = new URL(url);
  let relative = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname).slice(1);
  if (!relative || relative.includes('\\') || relative.includes('\0') || relative.includes(':') || relative.split('/').some(part => part === '..' || part === '.' || !part)) throw new Error('Invalid asset path');
  const file = path.resolve(root, relative);
  const resolved = path.relative(root, file);
  if (!resolved || resolved.startsWith('..') || path.isAbsolute(resolved)) throw new Error('Asset path escapes bundle');
  return file;
}
function externalURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && value.length <= 2048 && ['github.com', 'open-k-folds.github.io', 'www.gnu.org', 'www.electronjs.org'].includes(u.hostname) ? u.href : null; } catch { return null; }
}
function revision(value) { if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid revision'); return value; }
function recentId(value) { if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new Error('Invalid project ID'); return value; }
function draftState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['dirty', 'recoverable', 'saving'].includes(key)) || !['dirty', 'recoverable', 'saving'].every(key => typeof value[key] === 'boolean')) throw new Error('Invalid draft status');
  return {dirty: value.dirty, recoverable: value.recoverable, saving: value.saving};
}
module.exports = {ORIGIN, CSP, appURL, trustedSender, apiRoute, staticPath, externalURL, revision, recentId, draftState};
