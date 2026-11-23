import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRemoteJWKSet } from 'jose';
import { createHandoff } from './handoff.mjs';

const team = process.env.WB_ACCESS_TEAM ?? '';
const audience = process.env.WB_ACCESS_AUD ?? '';
if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(team) || !/^[0-9a-f]{64}$/.test(audience)) {
  throw new Error('Configure the Cloudflare Access team name and application audience.');
}

const issuer = `https://${team}.cloudflareaccess.com`;
const jwks = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer));
const readSession = () => readFile('/run/workbench/session-code', 'utf8');
createServer(createHandoff({ issuer, audience, jwks, readSession })).listen(8080, '0.0.0.0');
