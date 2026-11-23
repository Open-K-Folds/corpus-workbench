import { jwtVerify } from 'jose';

export function createHandoff({ issuer, audience, jwks, readSession }) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (request.url !== '/open') {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end();
      return;
    }

    try {
      await jwtVerify(request.headers['cf-access-jwt-assertion'], jwks, {
        issuer, audience, algorithms: ['RS256'], requiredClaims: ['exp'],
      });
    } catch {
      response.writeHead(403).end('Sign in to the Workbench through Cloudflare Access.');
      return;
    }

    // Read on each authorized handoff because the backend rotates this file on restart.
    try {
      const session = (await readSession()).trim();
      if (!/^[a-f0-9]{64}$/.test(session)) throw new Error('Invalid session file');
      response.writeHead(303, {
        Location: '/',
        'Set-Cookie': `wb_session=${session}; Path=/; Secure; HttpOnly; SameSite=Strict`,
      }).end();
    } catch {
      response.writeHead(503, { 'Retry-After': '3' }).end('Workbench is starting. Try again shortly.');
    }
  };
}
