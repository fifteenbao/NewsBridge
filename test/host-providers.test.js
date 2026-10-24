import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLibrary } from '../examples/database.js';
import { createConnectionClient } from '../src/lib/connection.js';
import { createHost } from '../examples/host.js';
import { createFileState } from '../examples/file-state.js';
import { createNodeServer } from '../examples/serve.mjs';
import { area } from '../test-support/chrome-mock.js';
import { seedApprovedBrowser, signConnectionRequest } from '../test-support/pairing.js';
import { ARTICLE_FIELDS } from '../connector/lib/bitable.js';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

test('Database reference host signs browser requests and rejects unsupported provider configurations', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'readflow-host-'));
  const originalFetch = globalThis.fetch;
  t.after(async () => { globalThis.fetch = originalFetch; await rm(dir, { recursive: true, force: true }); });
  const feishu = { storageProvider: 'database', remindersEnabled: false };
  const config = { baseUrl: 'https://connection.example.com/readflow/', extensionId: 'a'.repeat(32), stateDir: join(dir, 'state'), connector: feishu, feishu: { appId: 'cli_Test' } };
  const state = await createFileState(config); await state.initialize(); (await openLibrary(config.stateDir, { initialize: true })).close();
  globalThis.fetch = async (url, options) => {
    let body;
    if (String(url).includes('/auth/')) body = { code: 0, tenant_access_token: 'test_feishu_token' };
    else if (String(url).includes('/fields')) body = { code: 0, data: { items: Object.entries(ARTICLE_FIELDS).map(([field_name, type]) => ({ field_name, type })) } };
    else throw new Error('Unexpected provider request');
    assert.equal(options.redirect, 'error'); return new Response(JSON.stringify(body));
  };
  const host = await createHost(config, { getCredentials: () => ({ appId: 'cli_Test', appSecret: 'test_secret' }), onDiagnostic: () => {} });
  t.after(() => host.close());
  const browserState = {}, browserStorage = area(browserState);
  await seedApprovedBrowser(browserStorage, config.baseUrl);
  const pending = await host.pairing.request({ publicKey: browserState.pairingDevices[config.baseUrl].publicKey });
  await host.pairing.manage('approve', pending.pairId, pending.fingerprint);
  await browserStorage.set({ connectionPairings: { [config.baseUrl]: { pairId: pending.pairId, status: 'approved' } } });
  const call = async (action, data) => { const body = JSON.stringify(data), url = config.baseUrl + 'v1/' + action;
    const signed = await signConnectionRequest(config.baseUrl, url, body, browserStorage);
    return host.handleRequest(new Request(url, { method: 'POST', headers: { ...signed, Origin: 'chrome-extension://' + config.extensionId, 'Content-Type': 'application/json' }, body })); };
  for (const provider of ['database']) {
    const response = await call('health', { provider }); assert.equal(response.status, 200); assert.equal((await response.json()).configuration.storageProvider, provider);
  }
  await browserStorage.set({ connectionProvider: 'database' });
  const client = createConnectionClient({ baseUrl: config.baseUrl, storage: browserStorage, hasPermission: async () => true,
    fetchImpl: (url, options) => host.handleRequest(new Request(url, { ...options, headers: { ...options.headers, Origin: 'chrome-extension://' + config.extensionId } })) });
  const health = await client('health'); assert.match(health.identity.connectionId, /^db:/);
  const saved = await client('sync', { items: [{ id: 'local1', title: 'Signed capture', url: 'https://example.com/read', savedAt: '2026-10-23T00:00:00Z' }] });
  assert.equal(saved.created, 1);
  await client('read', { base: saved.base, recordId: saved.articles[0].recordId, status: '已读' });
  assert.equal((await client('sync', { items: [] })).articles[0].read, true);
  assert.match((await client('csv')).csv, /Signed capture/);
  await call('preferences', { provider: 'database', language: 'zh', reminderTime: '07:15', timeZone: 'Asia/Shanghai' });
  assert.equal((await (await call('health', { provider: 'database' })).json()).configuration.reminderTime, '07:15');
  assert.equal((await call('health', { provider: 'other' })).status, 400);
  await assert.rejects(createHost({ ...config, connector: { ...feishu, storageProvider: 'unsupported' } }), /database library/);
  await assert.rejects(createHost({ ...config, connections: { feishu } }), /database library/);
  assert.equal((await host.handleRequest(new Request(config.baseUrl + 'events/feishu', { method: 'POST' }))).status, 404);
  const eventCredentials = { encryptKey: 'test-key', verificationToken: 'test-token' };
  const inboxHost = await createHost({ ...config, extensionId: '', feishuInbox: {
    enabled: true, allowedChatIds: ['oc_test'], allowedOpenIds: ['ou_test'],
  } }, { getEventCredentials: () => eventCredentials });
  t.after(() => inboxHost.close());
  const iv = randomBytes(16), key = createHash('sha256').update(eventCredentials.encryptKey).digest();
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([iv, cipher.update(JSON.stringify({ type: 'url_verification', token: eventCredentials.verificationToken, challenge: 'test-challenge' })), cipher.final()]);
  const callback = () => new Request(config.baseUrl + 'events/feishu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ encrypt: encrypted.toString('base64') }) });
  assert.deepEqual(await (await inboxHost.handleRequest(callback())).json(), { challenge: 'test-challenge' });
  assert.equal((await inboxHost.handleRequest(new Request('https://other.example.com/readflow/events/feishu', callback()))).status, 400);
  assert.equal((await inboxHost.handleRequest(new Request(config.baseUrl + 'events/feishu?extra=1', callback()))).status, 400);
  assert.deepEqual(await inboxHost.inbox.processPending(), { ok: true, processed: 0, created: 0 });
  const server = createNodeServer({ ...host, baseUrl: config.baseUrl }); assert.equal(server.listening, false); assert.equal(server.address(), null);
});
