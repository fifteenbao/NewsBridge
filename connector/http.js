import { SafeError, safeErrorMessage, readJsonResponse } from '../src/lib/security.js';

import { parseConnectionUrl } from '../src/lib/connection-url.js';

// Mount this Fetch Request/Response handler in an existing HTTPS environment.
// It creates no listener, process, credentials, deployment or scheduler.
export function createHttpHandler({ baseUrl, extensionId, authenticate, connector, maxBytes = 20 * 1024 * 1024 }) {
  const target = parseConnectionUrl(baseUrl);
  if (!/^[a-p]{32}$/.test(extensionId || '') || typeof authenticate !== 'function' || typeof connector?.dispatch !== 'function') {
    throw new SafeError('Configure an HTTPS base URL, extension ID and authentication verifier.');
  }
  const expectedOrigin = `chrome-extension://${extensionId}`;
  const actions = new Set(['health', 'sync', 'read', 'pending', 'resolve', 'preferences']);
  let active = 0;
  return async request => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const send = (status, body) => {
      let text = JSON.stringify(body);
      if (new TextEncoder().encode(text).length > 20 * 1024 * 1024) { status = 500; text = '{"ok":false,"error":"Response too large."}'; }
      return new Response(status === 204 ? null : text, { status, headers });
    };
    const url = new URL(request.url), originHeader = request.headers.get('Origin');
    if (url.origin !== target.origin || url.search || url.hash) return send(400, { ok: false, error: 'Invalid connection URL.' });
    if (originHeader && originHeader !== expectedOrigin) return send(403, { ok: false, error: 'Untrusted extension.' });
    const action = url.pathname.startsWith(target.apiPath) ? url.pathname.slice(target.apiPath.length) : '';
    if (!actions.has(action)) return send(404, { ok: false, error: 'Unknown operation.' });
    if (originHeader === expectedOrigin) { headers['Access-Control-Allow-Origin'] = originHeader; headers.Vary = 'Origin'; }
    if (request.method === 'OPTIONS') {
      if (originHeader !== expectedOrigin || request.headers.get('Access-Control-Request-Method') !== 'POST' ||
          (request.headers.get('Access-Control-Request-Headers') || '').split(',').some(key => key.trim() && !['authorization', 'content-type'].includes(key.trim().toLowerCase()))) {
        return send(403, { ok: false, error: 'Invalid preflight.' });
      }
      headers['Access-Control-Allow-Methods'] = 'POST'; headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
      return send(204, null);
    }
    if (request.method !== 'POST') return send(405, { ok: false, error: 'POST required.' });
    if (!/^Bearer [A-Za-z0-9_-]{32,512}$/.test(request.headers.get('Authorization') || '')) return send(401, { ok: false, error: 'Access key required.' });
    try { if (await authenticate(request) !== true) return send(401, { ok: false, error: 'Access denied.' }); }
    catch { return send(401, { ok: false, error: 'Access denied.' }); }
    if ((request.headers.get('Content-Type') || '').split(';')[0].trim() !== 'application/json' || request.headers.has('Content-Encoding')) {
      return send(415, { ok: false, error: 'Uncompressed JSON required.' });
    }
    if (active >= 2) return send(429, { ok: false, error: 'Connection busy. Retry later.' });
    active++;
    try {
      const body = await readJsonResponse(request, maxBytes);
      return send(200, await connector.dispatch(action, body));
    } catch (error) { return send(400, { ok: false, error: safeErrorMessage(error) }); }
    finally { active--; }
  };
}
