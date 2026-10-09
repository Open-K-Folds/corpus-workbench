'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {appURL, apiRoute, staticPath, externalURL, revision, recentId, draftState, trustedSender} = require('../security.cjs');

test('desktop routes reject foreign origins, unlisted endpoints and mutation methods', () => {
  for (const value of ['https://app/api/view', 'workbench://app.evil/api/view', 'workbench://user@app/api/view', 'file:///api/view', 'workbench://app:8080/api/view']) assert.equal(appURL(value), false, value);
  assert.equal(apiRoute('workbench://app/api/view', 'GET'), true);
  assert.equal(apiRoute('workbench://app/api/command', 'POST'), true);
  for (const [url, method] of [['workbench://app/api/command','GET'],['workbench://app/api/view','POST'],['workbench://app/api/view','DELETE'],['workbench://app/api/arbitrary','GET'],['https://127.0.0.1/api/view','GET']]) assert.equal(apiRoute(url, method), false);
  assert.equal(apiRoute('workbench://app/api/view?value='+'x'.repeat(8192), 'GET'), false);
});

test('static assets cannot escape bundled real files through encoded Windows paths', () => {
  const root=path.resolve('synthetic-bundle');
  assert.equal(staticPath(root, 'workbench://app/'), path.join(root, 'index.html'));
  assert.equal(staticPath(root, 'workbench://app/assets/editor.js'), path.join(root, 'assets', 'editor.js'));
  for (const url of ['workbench://app/%2e%2e%5cprivate.txt','workbench://app/%2e%2e%2fprivate.txt','workbench://app/C%3A/private.txt','workbench://app/%00.txt','workbench://app/assets//editor.js','workbench://app/%ZZ','https://example.com/editor.js']) assert.throws(()=>staticPath(root,url), undefined, url);
});

test('IPC requires the actual main renderer frame and bounded operation values', () => {
  const frame={url:'workbench://app/'}, contents={mainFrame:frame}, window={isDestroyed:()=>false,webContents:contents};
  assert.equal(trustedSender({sender:contents,senderFrame:frame},window),true);
  assert.equal(trustedSender({sender:contents,senderFrame:{url:'workbench://app/'}},window),false);
  assert.equal(trustedSender({sender:{mainFrame:frame},senderFrame:frame},window),false);
  assert.equal(trustedSender({sender:contents,senderFrame:frame},{...window,isDestroyed:()=>true}),false);
  assert.equal(revision(1),1);
  for(const value of [0,-1,1.1,NaN,Infinity,'1',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>revision(value));
  assert.equal(recentId('a'.repeat(8)+'-'+('b'.repeat(4)+'-').repeat(3)+'c'.repeat(12)).length,36);
  for(const value of ['../../corpus',1,null,'arbitrary'])assert.throws(()=>recentId(value));
  assert.deepEqual(draftState({dirty:true,recoverable:false,saving:false}),{dirty:true,recoverable:false,saving:false});
  for(const value of [null,[],{dirty:'yes',recoverable:false,saving:false},{dirty:true,recoverable:false,saving:false,path:'C:\\private'}])assert.throws(()=>draftState(value));
});

test('external links are limited to documented HTTPS hosts without credentials', () => {
  assert.equal(externalURL('https://github.com/Open-K-Folds/corpus-workbench'),'https://github.com/Open-K-Folds/corpus-workbench');
  for(const value of ['javascript:alert(1)','file:///C:/private.txt','http://github.com/Open-K-Folds','https://github.com.evil.test/','https://user:secret@github.com/','https://example.com/'])assert.equal(externalURL(value),null,value);
});
