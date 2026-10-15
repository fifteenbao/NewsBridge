// Reference server-side approval and durable signature replay protection.
import { createPublicKey, verify, createHash, randomUUID } from 'node:crypto';
import { SafeError } from '../src/lib/security.js';
import { parseConnectionUrl } from '../src/lib/connection-url.js';
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value || '');
function normalized(key) {
  if (!key || Object.keys(key).sort().join() !== 'crv,kty,x,y' || key.kty !== 'EC' || key.crv !== 'P-256' || !/^[A-Za-z0-9_-]{43}$/.test(key.x || '') || !/^[A-Za-z0-9_-]{43}$/.test(key.y || '')) throw new SafeError('Invalid pairing public key.');
  const result = { kty: 'EC', crv: 'P-256', x: key.x, y: key.y }; createPublicKey({ key: result, format: 'jwk' }); return result;
}
const fingerprint = key => createHash('sha256').update(JSON.stringify(key)).digest('hex');
export function createPairing({ config, store, exclusive, now = () => Date.now() }) {
  const target = parseConnectionUrl(config.baseUrl), origin = `chrome-extension://${config.extensionId}`;
  const stateOf = state => state.pairing ||= { requests: {}, keys: {}, nonces: {} };
  function matching(request) { return request.extensionId === config.extensionId && request.endpoint === target.baseUrl; }
  return {
    request: body => exclusive(async () => {
      if (!/^[a-p]{32}$/.test(config.extensionId || '') || !body || Object.keys(body).join() !== 'publicKey') throw new SafeError('Register the Chrome extension ID before pairing.');
      const publicKey = normalized(body.publicKey), fp = fingerprint(publicKey), state = await store.load(), pairing = stateOf(state);
      for (const [pairId, key] of Object.entries(pairing.keys)) if (matching(key) && key.fingerprint === fp) return { ok: true, pairId, fingerprint: fp, status: 'approved' };
      for (const [id, request] of Object.entries(pairing.requests)) if (request.expiresAt < now()) delete pairing.requests[id];
      for (const [pairId, request] of Object.entries(pairing.requests)) if (matching(request) && request.fingerprint === fp) return { ok: true, pairId, fingerprint: fp, status: 'pending' };
      if (Object.keys(pairing.requests).length >= 3) throw new SafeError('Pairing queue is full. Ask the operator to reject stale requests.');
      const pairId = randomUUID(); pairing.requests[pairId] = { publicKey, fingerprint: fp, endpoint: target.baseUrl, extensionId: config.extensionId, createdAt: now(), expiresAt: now() + 10 * 60000 };
      await store.save(state); return { ok: true, pairId, fingerprint: fp, status: 'pending' };
    }),
    manage: (action, pairId, expectedFingerprint) => exclusive(async () => {
      const state = await store.load(), pairing = stateOf(state);
      if (action === 'list') return { ok: true, pending: Object.entries(pairing.requests).map(([pairId, r]) => ({ pairId, fingerprint: r.fingerprint, extensionId: r.extensionId, expiresAt: r.expiresAt })), approved: Object.entries(pairing.keys).map(([pairId, r]) => ({ pairId, fingerprint: r.fingerprint, extensionId: r.extensionId })) };
      if (!uuid(pairId)) throw new SafeError('Choose one valid pairing request ID.');
      if (action === 'approve') {
        const request = pairing.requests[pairId];
        if (!request || !matching(request) || request.expiresAt < now() || request.fingerprint !== expectedFingerprint || !/^[a-f0-9]{64}$/.test(expectedFingerprint || '') || Object.keys(pairing.keys).length >= 16) throw new SafeError('Pairing expired, fingerprint mismatched, or approved-device limit reached.');
        pairing.keys[pairId] = { ...request, approvedAt: now() }; delete pairing.requests[pairId];
      } else if (action === 'reject') delete pairing.requests[pairId];
      else if (action === 'revoke') delete pairing.keys[pairId];
      else throw new SafeError('Unsupported pairing management operation.');
      await store.save(state); return { ok: true };
    }),
    authenticate: async request => {
      if (request.headers.get('Origin') !== origin || !config.extensionId || request.method !== 'POST') return false;
      const pairId = request.headers.get('X-NewsBridge-Pair'), nonce = request.headers.get('X-NewsBridge-Nonce'), stamp = request.headers.get('X-NewsBridge-Time'), signature = request.headers.get('X-NewsBridge-Signature');
      if (!uuid(pairId) || !uuid(nonce) || !/^\d{13}$/.test(stamp || '') || Math.abs(now() - Number(stamp)) > 60000 || !/^[A-Za-z0-9_-]{86}$/.test(signature || '')) return false;
      const url = new URL(request.url);
      if (url.origin !== target.origin || !url.pathname.startsWith(target.apiPath)) return false;
      // The HTTP handler bounds parsed JSON before authentication; hashing uses that exact body.
      const reader = request.clone().body?.getReader();
      if (!reader) return false;
      const hash = createHash('sha256'); let size = 0;
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 20 * 1024 * 1024) { await reader.cancel(); return false; } hash.update(value); } }
      finally { reader.releaseLock(); }
      const bodyDigest = hash.digest('hex');
      return exclusive(async () => {
        if (Math.abs(now() - Number(stamp)) > 60000) return false;
        const state = await store.load(), pairing = stateOf(state), key = pairing.keys[pairId];
        if (!key || !matching(key)) return false;
        const content = ['POST', request.url, stamp, nonce, bodyDigest].join('\n');
        if (!verify('sha256', Buffer.from(content), { key: createPublicKey({ key: normalized(key.publicKey), format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))) return false;
        for (const [id, expiry] of Object.entries(pairing.nonces)) if (expiry < now()) delete pairing.nonces[id];
        const id = pairId + ':' + nonce;
        if (pairing.nonces[id] || Object.keys(pairing.nonces).length >= 10000) return false;
        pairing.nonces[id] = now() + 120000; await store.save(state); return true;
      });
    },
  };
}
