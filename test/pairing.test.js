import test from 'node:test';
import assert from 'node:assert/strict';
import { createPairing } from '../examples/pairing.js';
import { createHttpHandler } from '../connector/http.js';
import { fixture } from '../test-support/connector-fixture.js';
import { area } from '../test-support/chrome-mock.js';
import { requestPairing, signConnectionRequest, getPairingStatus } from '../src/lib/pairing-client.js';
import { createConnectionClient } from '../src/lib/connection.js';
const baseUrl = 'https://connection.example.com/readflow/', extensionId = 'a'.repeat(32);
function setup(t) {
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch }; t.after(() => Object.assign(globalThis, original));
  const f = fixture(), data = { connectionEndpoint: baseUrl, connectionProvider: 'feishu' }, storage = area(data);
  let time = Date.now();
  const pairing = createPairing({ config: { baseUrl, extensionId }, store: f.store, exclusive: f.exclusive, now: () => time });
  const handler = createHttpHandler({ baseUrl, extensionId, connector: f.runtime, pairing, authenticate: pairing.authenticate });
  globalThis.chrome = { storage: { local: storage }, permissions: { contains: async () => true } };
  globalThis.fetch = (url, options) => handler(new Request(url, { ...options, headers: { ...options.headers, Origin: 'chrome-extension://' + extensionId } }));
  return { f, data, storage, pairing, handler, advance: ms => { time += ms; } };
}
test('pairing needs explicit matching fingerprint approval; signed browser works without a manual key', async t => {
  const f = setup(t), pending = await requestPairing(baseUrl);
  assert.equal(pending.status, 'pending'); assert.equal((await f.pairing.manage('list')).approved.length, 0);
  await assert.rejects(createConnectionClient()('health'), /Pair this browser/);
  await assert.rejects(f.pairing.manage('approve', pending.pairId, '0'.repeat(64)), /fingerprint/);
  await f.pairing.manage('approve', pending.pairId, pending.fingerprint);
  assert.equal((await requestPairing(baseUrl)).status, 'approved');
  const result = await createConnectionClient()('health'); assert.equal(result.connected, true);
  assert.equal(f.data.connectionAccessKey, undefined);
  const status = await getPairingStatus(); assert.equal(status.approved, true); assert.ok(!JSON.stringify(status).includes('privateKey'));
  const unapproved = await f.handler(new Request(baseUrl + 'v1/health', { method: 'POST', headers: { Origin: 'chrome-extension://' + extensionId, 'Content-Type': 'application/json' }, body: '{}' })); assert.equal(unapproved.status, 401);
});
test('signatures reject forged origin-only requests, body tampering, replay, stale timestamps and revoked devices', async t => {
  const f = setup(t), pending = await requestPairing(baseUrl); await f.pairing.manage('approve', pending.pairId, pending.fingerprint); await requestPairing(baseUrl);
  const body = '{}', url = baseUrl + 'v1/health', auth = await signConnectionRequest(baseUrl, url, body);
  const req = (headers = auth, text = body) => new Request(url, { method: 'POST', headers: { ...headers, Origin: 'chrome-extension://' + extensionId, 'Content-Type': 'application/json' }, body: text });
  assert.equal((await f.handler(req({}, body))).status, 401);
  assert.equal((await f.handler(req(auth, '{"provider":"feishu"}'))).status, 401);
  assert.equal((await f.handler(req())).status, 200);
  assert.equal((await f.handler(req())).status, 401);
  const next = await signConnectionRequest(baseUrl, url, body);
  f.advance(61000); assert.equal((await f.handler(req(next))).status, 401); f.advance(-61000);
  await f.pairing.manage('revoke', pending.pairId);
  assert.equal((await f.handler(req(await signConnectionRequest(baseUrl, url, body)))).status, 401);
});
test('pending request expiry, queue limits and extension registration do not grant access automatically', async t => {
  const f = setup(t), pending = await requestPairing(baseUrl);
  assert.equal((await requestPairing(baseUrl)).pairId, pending.pairId);
  f.advance(10 * 60000 + 1); await assert.rejects(f.pairing.manage('approve', pending.pairId, pending.fingerprint), /expired/);
  const expired = await requestPairing(baseUrl); assert.notEqual(expired.pairId, pending.pairId);
  const badOrigin = await f.handler(new Request(baseUrl + 'v1/pair', { method: 'POST', headers: { Origin: 'chrome-extension://' + 'b'.repeat(32), 'Content-Type': 'application/json' }, body: JSON.stringify({ publicKey: f.data.pairingDevices[baseUrl].publicKey }) })); assert.equal(badOrigin.status, 403);
  const badKey = await f.handler(new Request(baseUrl + 'v1/pair', { method: 'POST', headers: { Origin: 'chrome-extension://' + extensionId, 'Content-Type': 'application/json' }, body: JSON.stringify({ publicKey: { ...f.data.pairingDevices[baseUrl].publicKey, d: 'private' } }) })); assert.equal(badKey.status, 400);
});

test('reference CLI initializes without access.key and confirms/revokes an exact fingerprint', async t => {
  const { mkdtemp, writeFile, rm, access } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util');
  const { createHost } = await import('../examples/host.js');
  const dir = await mkdtemp(join(tmpdir(), 'readflow-pair-cli-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const config = { baseUrl, extensionId, stateDir: join(dir, 'state'), connector: { storageProvider: 'database', remindersEnabled: false } };
  const file = join(dir, 'host.json'); await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  const exec = promisify(execFile), cli = new URL('../examples/run.mjs', import.meta.url).pathname;
  await exec(process.execPath, [cli, 'init', file]); await assert.rejects(access(join(config.stateDir, 'access.key')));
  const host = await createHost(config); t.after(() => host.close()); const server = host.pairing;
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign','verify']);
  const pub = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const request = await server.request({ publicKey: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y } });
  const listing = await exec(process.execPath, [cli, 'pair-list', file]); assert.equal(JSON.parse(listing.stdout).pending[0].fingerprint, request.fingerprint);
  await exec(process.execPath, [cli, 'pair-approve', file, '--pair-id', request.pairId, '--fingerprint', request.fingerprint]);
  assert.equal((await server.manage('list')).approved.length, 1);
  await exec(process.execPath, [cli, 'pair-revoke', file, '--pair-id', request.pairId]); assert.equal((await server.manage('list')).approved.length, 0);
});
