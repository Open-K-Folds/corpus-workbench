import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createHandoff } from './handoff.mjs';

test('the Access handoff checks the assertion before reading the current session', async t => {
  const issuer = 'https://example.cloudflareaccess.com';
  const audience = 'preview-test';
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwks = createLocalJWKSet({ keys: [await exportJWK(publicKey)] });
  let session = randomBytes(32).toString('hex');
  let reads = 0;
  const readSession = async () => {
    reads++;
    return session;
  };
  const server = createServer(createHandoff({ issuer, audience, jwks, readSession }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const open = (jwt, path = '/open', method = 'GET') => fetch(base + path, {
    method, redirect: 'manual', headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {},
  });
  const now = Math.floor(Date.now() / 1000);
  const sign = (overrides = {}) => new SignJWT({ iss: issuer, aud: audience, exp: now + 120, ...overrides })
    .setProtectedHeader({ alg: 'RS256' }).sign(privateKey);

  for (const jwt of [null, await sign({ aud: 'another-application' }), await sign({ iss: 'another-issuer' }),
    await sign({ exp: now - 1 }), await sign({ exp: undefined })]) {
    const response = await open(jwt);
    assert.equal(response.status, 403);
    assert.equal(response.headers.has('Set-Cookie'), false);
  }
  const jwt = await sign();
  assert.equal((await open(jwt, '/open', 'POST')).status, 405);
  assert.equal((await open(jwt, '/open?next=/elsewhere')).status, 404);
  assert.equal(reads, 0);

  for (let n = 0; n < 2; n++) {
    session = randomBytes(32).toString('hex');
    const response = await open(jwt);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(response.headers.get('set-cookie') === `wb_session=${session}; Path=/; Secure; HttpOnly; SameSite=Strict`);
    assert.equal(await response.text(), '');
  }
  assert.equal(reads, 2);
  session = '';
  const unavailable = await open(jwt);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.has('set-cookie'), false);
});
