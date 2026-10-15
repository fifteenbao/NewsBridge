import { requestPairing, signConnectionRequest } from '../src/lib/pairing-client.js';
export async function approveTestBrowser(storage, endpoint, pairing) {
  const pair = await requestPairing(endpoint, { storage });
  await pairing.manage('approve', pair.pairId, pair.fingerprint);
  await requestPairing(endpoint, { storage });
  return pair;
}
export async function seedApprovedBrowser(storage, endpoint) {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', keys.publicKey);
  await storage.set({ pairingDevices: { [endpoint]: { publicKey: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y }, privateKey: await crypto.subtle.exportKey('jwk', keys.privateKey) } }, connectionPairings: { [endpoint]: { pairId: crypto.randomUUID(), status: 'approved' } } });
}
export { signConnectionRequest };
