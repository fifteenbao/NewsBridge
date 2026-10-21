import test from 'node:test';
import assert from 'node:assert/strict';
import { getPairingStatus } from '../src/lib/pairing-client.js';
import { seedApprovedBrowser } from '../test-support/pairing.js';
import { area } from '../test-support/chrome-mock.js';
import { createConnectionClient } from '../src/lib/connection.js';
import { endpointValue, endpointPermission, requestEndpointPermission, collectionArchiveKey } from '../src/lib/endpoint.js';
import { setSettings, getSettings, disconnectCollection } from '../src/lib/storage.js';
const address = 'https://connection.example.com/newsbridge/', other = 'https://other.example.com/library/';
const key = 't'.repeat(43), identity = { connectionId: 'app:cli_Test', base: 'baseTest/tblTest' };
const healthy = () => new Response(JSON.stringify({ ok: true, connected: true, identity, protocolVersion: 1, capabilities: { tableRead: true, tableWrite: true }, configuration: { storageProvider: 'feishu' } }));
test('runtime addresses stay offline until configured, normalize paths and require exact host permission', async () => {
  const data = {}, storage = area(data), calls = [];
  const client = createConnectionClient({ authentication: 'bearer', storage, fetchImpl: async (url, opts) => { calls.push({ url, opts }); return healthy(); }, hasPermission: async permission => { assert.deepEqual(permission, { origins: ['https://connection.example.com/*'] }); return false; } });
  assert.equal((await client('health')).connected, false); assert.equal(calls.length, 0);
  data.connectionEndpoint = address; data.connectionAccessKey = key; data.connectionBaseUrl = address;
  await assert.rejects(client('health'), /Grant access/); assert.equal(calls.length, 0);
  const approved = createConnectionClient({ authentication: 'bearer', storage, hasPermission: async () => true, fetchImpl: async (url, opts) => { calls.push({ url, opts }); return healthy(); } });
  await approved('health'); assert.equal(calls[0].url, address + 'v1/health'); assert.equal(calls[0].opts.credentials, 'omit'); assert.equal(calls[0].opts.redirect, 'error');
  data.connectionEndpoint = other;
  await assert.rejects(approved('health'), /Disconnect/); assert.equal(calls.length, 1);
  assert.equal(endpointValue('  https://connection.example.com/newsbridge  '), address);
  for (const value of ['https://user:secret@example.com/', 'https://localhost/', 'http://example.com/', 'http://localhost:8787/', 'https://example.com/path?token=secret', 'https://example.com/../', 'https://*.example.com/']) assert.throws(() => endpointValue(value));
});
test('settings atomically persist address/key/identity, isolate archives by endpoint and revoke saved permission on disconnect', async t => {
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch }; t.after(() => Object.assign(globalThis, original));
  const values = { items: [{ id: 'first', url: 'https://example.com/article' }] }, grants = new Set(), requests = [], removed = [];
  const storage = area(values);
  globalThis.chrome = { storage: { local: storage }, permissions: {
    request: async ({ origins }) => { assert.equal(origins.length, 1); assert.ok(!origins[0].includes('*://') && !origins[0].includes('https://*')); grants.add(origins[0]); return true; },
    contains: async ({ origins }) => grants.has(origins[0]), remove: async ({ origins }) => { removed.push(...origins); for (const o of origins) grants.delete(o); return true; },
  } };
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return healthy(); };
  await assert.rejects(setSettings({ language: 'en', connectionUrl: address, connectionAccessKey: key }), /Grant access/); assert.equal(requests.length, 0);
  await requestEndpointPermission(address);
  await seedApprovedBrowser(storage, address);
  await setSettings({ language: 'en', connectionUrl: address });
  assert.equal(values.connectionEndpoint, address); assert.equal(values.connectionBaseUrl, address); assert.equal(values.connectionAccessKey, '');
  assert.equal((await getSettings()).connectionUrl, address); assert.equal((await getPairingStatus()).approved, true);
  assert.equal(requests[0].url, address + 'v1/preferences');
  await requestEndpointPermission(other);
  await assert.rejects(setSettings({ language: 'en', connectionUrl: other, connectionAccessKey: 'u'.repeat(43) }), /Disconnect/);
  assert.equal(requests.length, 1);
  await disconnectCollection(); assert.equal(requests.length, 1); assert.equal(values.connectionAccessKey, ''); assert.equal(values.connectionEndpoint, ''); assert.deepEqual(values.items, []);
  assert.equal(values.collectionArchives[collectionArchiveKey(identity, address)][0].id, 'first'); assert.ok(removed.includes(endpointPermission(address).origins[0]));
  await seedApprovedBrowser(storage, other);
  await setSettings({ language: 'en', connectionUrl: other });
  assert.deepEqual(values.items, []); assert.equal(requests.at(-1).options.headers.Authorization, undefined); assert.ok(requests.at(-1).options.headers['X-NewsBridge-Signature']);
  await disconnectCollection(); await requestEndpointPermission(address);
  await seedApprovedBrowser(storage, address);
  await setSettings({ language: 'en', connectionUrl: address }); assert.equal(values.items[0].id, 'first');
});
test('failed address validation never sends the saved key to a new target and denied permission does not save', async t => {
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch }; t.after(() => Object.assign(globalThis, original));
  const data = { connectionEndpoint: address, connectionBaseUrl: address, connectionAccessKey: key }, storage = area(data); let calls = 0;
  globalThis.chrome = { storage: { local: storage }, permissions: { contains: async () => true, request: async () => false } };
  globalThis.fetch = async () => { calls++; return healthy(); };
  await assert.rejects(setSettings({ language: 'en', connectionUrl: other }), /Pair this browser/);
  assert.equal(await requestEndpointPermission(other), false); assert.equal(calls, 0); assert.equal(data.connectionEndpoint, address);
  const client = createConnectionClient({ authentication: 'bearer', storage, hasPermission: async () => true, fetchImpl: globalThis.fetch });
  await assert.rejects(client('health', {}, { endpoint: other, pinIdentity: false }), /access key/);
  assert.equal(calls, 0);
});
