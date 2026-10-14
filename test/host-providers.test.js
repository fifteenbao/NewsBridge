import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createHost } from '../examples/host.js';
import { createFileState } from '../examples/file-state.js';
import { createNodeServer } from '../examples/serve.mjs';
import { ARTICLE_FIELDS } from '../src/lib/bitable.js';

test('dual-profile reference host routes only configured providers, verifies credentials and separates preferences', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'newsbridge-providers-'));
  const original = { fetch: globalThis.fetch, file: process.env.GOOGLE_SERVICE_ACCOUNT_FILE };
  t.after(async () => { globalThis.fetch = original.fetch; if (original.file === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE; else process.env.GOOGLE_SERVICE_ACCOUNT_FILE = original.file; await rm(dir, { recursive: true, force: true }); });
  const email = 'test@example-project.iam.gserviceaccount.com';
  const credentials = join(dir, 'google.json');
  await writeFile(credentials, JSON.stringify({ client_email: email, private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 });
  process.env.GOOGLE_SERVICE_ACCOUNT_FILE = credentials;
  const feishu = { storageProvider: 'feishu', connectionId: 'app:cli_Test', baseToken: 'baseTest', articleTableId: 'tblTest', remindersEnabled: false };
  const google = { storageProvider: 'google', connectionId: 'google:' + email, baseToken: 'sheet_Test', articleTableId: '0', remindersEnabled: false };
  const config = { baseUrl: 'https://connection.example.com/newsbridge/', extensionId: 'a'.repeat(32), stateDir: join(dir, 'state'), connector: feishu, connections: { feishu, google } };
  const state = await createFileState(config); await state.initialize();
  globalThis.fetch = async (url, options) => {
    let body;
    if (String(url) === 'https://oauth2.googleapis.com/token') body = { access_token: 'test_google_token', expires_in: 3600 };
    else if (String(url).includes(':getByDataFilter')) body = { sheets: [{ properties: { sheetId: 0, gridProperties: { rowCount: 1000 } }, data: [{ rowData: [{ values: Object.keys(ARTICLE_FIELDS).map(stringValue => ({ effectiveValue: { stringValue } })) }] }] }] };
    else if (String(url).includes('developerMetadata:search')) body = {};
    else if (String(url).includes('/auth/')) body = { code: 0, tenant_access_token: 'test_feishu_token' };
    else if (String(url).includes('/fields')) body = { code: 0, data: { items: Object.entries(ARTICLE_FIELDS).map(([field_name, type]) => ({ field_name, type })) } };
    else throw new Error('Unexpected provider request');
    assert.equal(options.redirect, 'error'); return new Response(JSON.stringify(body));
  };
  const host = await createHost(config, { getCredentials: () => ({ appId: 'cli_Test', appSecret: 'test_secret' }), onDiagnostic: () => {} });
  const key = (await readFile(join(config.stateDir, 'access.key'), 'utf8')).trim();
  const call = (action, data) => host.handleRequest(new Request(config.baseUrl + 'v1/' + action, { method: 'POST', headers: { Origin: 'chrome-extension://' + config.extensionId, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }));
  for (const provider of ['feishu', 'google']) {
    const response = await call('health', { provider }); assert.equal(response.status, 200); assert.equal((await response.json()).configuration.storageProvider, provider);
  }
  await call('preferences', { provider: 'feishu', language: 'zh', reminderTime: '07:15', timeZone: 'Asia/Shanghai' });
  await call('preferences', { provider: 'google', language: 'en', reminderTime: '09:30', timeZone: 'Europe/London' });
  assert.equal((await (await call('health', { provider: 'feishu' })).json()).configuration.reminderTime, '07:15');
  assert.equal((await (await call('health', { provider: 'google' })).json()).configuration.reminderTime, '09:30');
  assert.equal((await call('health', { provider: 'other' })).status, 400);
  const deny = await call('health', { provider: 'google', expectedIdentity: { connectionId: feishu.connectionId, base: 'baseTest/tblTest' } }); assert.equal(deny.status, 400);
  await chmod(credentials, 0o644);
  await assert.rejects(host.hosts.google.adapter.getIdentity(), e => e.diagnostic.code === 'AUTH_VERIFY');
  const server = createNodeServer({ ...host, baseUrl: config.baseUrl }); assert.equal(server.listening, false); assert.equal(server.address(), null);
});
