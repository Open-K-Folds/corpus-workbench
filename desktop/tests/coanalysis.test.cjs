'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {queryModel} = require('../local-model.cjs');

test('a prompt binds the exact saved reading, separates utterances and marks omissions', async () => {
  const {preparePassage} = await import('../coanalysis-prompt.mjs');
  const view = {snapshot: {project: 'practice'}, revision: {id: 1, snapshot_hash: 'hash'},
    documents: [{path: 'sample', tokens: [
      {id: 'a', corrected: 'yes?', original: 'yes', utterance: 'turn-1'},
      {id: 'b', original: 'wait', utterance: 'turn-2'},
      {id: 'c', original: 'never include this', utterance: 'turn-2'},
      {id: 'd', original: 'now', utterance: 'turn-2'},
    ]}]};
  const request = {project: 'practice', revision: 1, snapshot_hash: 'hash', document: 'sample', token_ids: ['d', 'b', 'a'], question: 'What changed?'};
  const {groups, prompt} = preparePassage(view, request);
  assert.deepEqual(groups, [
    {utterance: 'turn-1', gap_before: false, tokens: [{id: 'a', text: 'yes?'}]},
    {utterance: 'turn-2', gap_before: false, tokens: [{id: 'b', text: 'wait'}]},
    {utterance: 'turn-2', gap_before: true, tokens: [{id: 'd', text: 'now'}]},
  ]);
  assert.ok(!prompt.includes('never include this'));
  assert.equal(preparePassage(view, {...request, first_reading: 'A private initial observation.'}).prompt, prompt);
  for (const patch of [{project: 'other'}, {revision: 2}, {snapshot_hash: 'other'}, {document: 'other'}, {token_ids: ['a', 'a']}, {token_ids: ['missing']}, {question: ' '}]) {
    assert.throws(() => preparePassage(view, {...request, ...patch}));
  }
});

test('the desktop adapter calls the fixed local chat endpoint once and bounds plain-text replies', async () => {
  let responseBody = '', code = 200;
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.method, 'POST');
    let body = '';
    for await (const bytes of req) body += bytes;
    bodies.push(JSON.parse(body));
    res.writeHead(code, {Location: '/should-not-follow'});
    res.end(responseBody);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const testRequest = (options, callback) => {
    assert.equal(options.port, 8080);
    assert.equal(options.hostname, '127.0.0.1');
    return http.request({...options, port: server.address().port}, callback);
  };
  try {
    responseBody = JSON.stringify({model: 'synthetic-model', choices: [{message: {content: '<plain proposal>'}}]});
    assert.deepEqual(await queryModel('Synthetic passage', testRequest), {model: 'synthetic-model', reply: '<plain proposal>'});
    assert.deepEqual(bodies[0].messages, [{role: 'user', content: 'Synthetic passage'}]);
    responseBody = 'x'.repeat(65537);
    await assert.rejects(queryModel('Synthetic passage', testRequest), /response limit/);
    responseBody = '{}';
    await assert.rejects(queryModel('Synthetic passage', testRequest), /unreadable/);
    code = 307;
    await assert.rejects(queryModel('Synthetic passage', testRequest), /HTTP 307/);
    assert.equal(bodies.length, 4);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
