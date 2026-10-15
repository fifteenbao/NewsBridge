import { SafeError, readJsonResponse } from './security.js';
import { endpointValue, endpointPermission, storedEndpoint } from './endpoint.js';
const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const hex = bytes => [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
export const publicKeyValue = key => ({ kty: 'EC', crv: 'P-256', x: key.x, y: key.y });
export const pairingFingerprint = async key => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(publicKeyValue(key)))));
let queue = Promise.resolve();
async function deviceFor(endpoint, storage) {
  const task = queue.then(async () => {
    const { pairingDevices = {} } = await storage.get('pairingDevices');
    if (pairingDevices[endpoint]) return pairingDevices[endpoint];
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const device = { publicKey: publicKeyValue(await crypto.subtle.exportKey('jwk', pair.publicKey)), privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey), createdAt: new Date().toISOString() };
    await storage.set({ pairingDevices: { ...pairingDevices, [endpoint]: device } }); return device;
  }); queue = task.catch(() => {}); return task;
}
export async function requestPairing(endpoint, { storage = chrome.storage.local, fetchImpl = fetch } = {}) {
  endpoint = endpointValue(endpoint);
  if (!endpoint || !await chrome.permissions.contains(endpointPermission(endpoint))) throw new SafeError('Grant access to this connection host in Settings before connecting.');
  const device = await deviceFor(endpoint, storage), fingerprint = await pairingFingerprint(device.publicKey);
  let response;
  try { response = await fetchImpl(endpoint + 'v1/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publicKey: device.publicKey }), credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) }); }
  catch { throw new SafeError('Connection failed or timed out. Check its availability and HTTPS configuration.'); }
  if (response.status === 403) throw new SafeError('The extension origin is not registered on this connection (403).');
  const result = await readJsonResponse(response, 4096);
  if (!response.ok || result.ok !== true || !/^[a-f0-9-]{36}$/.test(result.pairId || '') || result.fingerprint !== fingerprint || !['pending', 'approved'].includes(result.status)) throw new SafeError('Pairing failed. Check the configured extension ID and pending requests on the server.');
  const { connectionPairings = {} } = await storage.get('connectionPairings');
  await storage.set({ connectionPairings: { ...connectionPairings, [endpoint]: { pairId: result.pairId, fingerprint, status: result.status } } });
  return { pairId: result.pairId, fingerprint, status: result.status };
}
export async function signConnectionRequest(endpoint, url, body, storage = chrome.storage.local) {
  const { connectionPairings = {}, pairingDevices = {} } = await storage.get(['connectionPairings', 'pairingDevices']);
  const binding = connectionPairings[endpoint], device = pairingDevices[endpoint];
  if (binding?.status !== 'approved' || !device) throw new SafeError('Pair this browser in Settings and confirm the request on the server before connecting.');
  const stamp = String(Date.now()), nonce = crypto.randomUUID();
  const digest = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
  const content = ['POST', url, stamp, nonce, digest].join('\n');
  const privateKey = await crypto.subtle.importKey('jwk', device.privateKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(content));
  return { 'X-NewsBridge-Pair': binding.pairId, 'X-NewsBridge-Time': stamp, 'X-NewsBridge-Nonce': nonce, 'X-NewsBridge-Signature': encode(signature) };
}
export async function getPairingStatus(storage = chrome.storage.local) {
  const data = await storage.get(['connectionEndpoint', 'connectionPairings']);
  const endpoint = storedEndpoint(data), binding = data.connectionPairings?.[endpoint];
  return { baseUrl: endpoint, approved: binding?.status === 'approved', status: binding?.status || 'unpaired', pairId: binding?.pairId || '', fingerprint: binding?.fingerprint || '' };
}
