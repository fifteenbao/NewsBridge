import { createHash, timingSafeEqual } from 'node:crypto';
import { SafeError, safeErrorMessage } from '../src/lib/security.js';
const actions = new Set(['health', 'sync', 'read', 'pending', 'resolve', 'preferences']);
export const MAX_BODY = 20 * 1024 * 1024;

function authenticated(header, hash) {
  if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) return false;
  return timingSafeEqual(createHash('sha256').update(header.slice(7)).digest(), Buffer.from(hash, 'hex'));
}
async function readBody(req, limit) {
  if (Number(req.headers['content-length']) > limit) throw new SafeError('Request body exceeds the size limit.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new SafeError('Request body exceeds the size limit.');
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new SafeError('Invalid JSON request.'); }
}
export function createHttpHandler({ config, dispatch, maxBytes = MAX_BODY }) {
  let active = 0;
  return async (req, res) => {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const send = (status, value) => {
      if (res.destroyed) return;
      let bytes = Buffer.from(JSON.stringify(value));
      if (bytes.length > MAX_BODY) { status = 500; bytes = Buffer.from('{"ok":false,"error":"Server response exceeds its size limit."}'); }
      res.writeHead(status, headers); res.end(bytes);
    };
    const origin = req.headers.origin;
    const expected = `chrome-extension://${config.extensionId}`;
    const action = req.url?.startsWith('/v1/') ? req.url.slice(4) : null;
    // The API binds to loopback only. The controlled reverse proxy must replace
    // Host and X-Forwarded-Proto; never expose this HTTP listener to the Internet.
    if (req.headers['x-forwarded-proto'] !== 'https' || req.headers.host !== new URL(config.publicOrigin).host) return send(400, { ok: false, error: 'HTTPS proxy required.' });
    if (origin && origin !== expected) return send(403, { ok: false, error: 'Untrusted request origin.' });
    if (!actions.has(action)) return send(404, { ok: false, error: 'Unknown operation.' });
    if (origin === expected) { headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin'; }
    if (req.method === 'OPTIONS') {
      if (origin !== expected || req.headers['access-control-request-method'] !== 'POST' ||
          (req.headers['access-control-request-headers'] || '').split(',').some(key => key.trim() && !['authorization', 'content-type'].includes(key.trim().toLowerCase()))) return send(403, { ok: false, error: 'Invalid preflight.' });
      headers['Access-Control-Allow-Methods'] = 'POST'; headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
      return send(204, null);
    }
    if (req.method !== 'POST') return send(405, { ok: false, error: 'POST required.' });
    if (!authenticated(req.headers.authorization, config.apiTokenHash)) return send(401, { ok: false, error: 'Service access key required.' });
    if ((req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json' || req.headers['content-encoding']) return send(415, { ok: false, error: 'Uncompressed JSON required.' });
    if (active >= 2) return send(429, { ok: false, error: 'The service is busy. Retry later.' });
    active++;
    try { send(200, await dispatch(action, await readBody(req, maxBytes))); }
    catch (error) { send(400, { ok: false, error: safeErrorMessage(error) }); }
    finally { active--; }
  };
}
