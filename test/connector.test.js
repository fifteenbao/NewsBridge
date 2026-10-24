import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../test-support/connector-fixture.js';
import { dueDate } from '../connector/runtime.js';
import { createAdapterClient } from '../connector/client.js';
import { createConnectionClient } from '../src/lib/connection.js';
import { area } from '../test-support/chrome-mock.js';
import { createHttpHandler } from '../connector/http.js';
const origin = 'https://connection.example.com', extensionId = 'a'.repeat(32), key = 't'.repeat(43);
const request = ({ method = 'POST', path = '/v1/health', body = '{}', headers = {} } = {}) => new Request(origin + path, {
  method, headers: { Origin: `chrome-extension://${extensionId}`, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
  ...(['GET', 'HEAD'].includes(method) ? {} : { body }),
});
const handlerFor = (f, options = {}) => createHttpHandler({ baseUrl: origin, extensionId, connector: f.runtime,
  authenticate: async req => req.headers.get('Authorization') === `Bearer ${key}`, ...options });

test('portable connector rejects missing capabilities, persistence or lock', () => {
  const f = fixture();
  assert.throws(() => f.create({ store: null }), /durable/);
  assert.throws(() => f.create({ exclusive: null }), /lock/);
  assert.throws(() => f.create({ adapter: { ...f.adapter, capabilities: { tableRead: true } } }), /capabilities/);
  assert.throws(() => f.create({ adapter: { ...f.adapter, capabilities: { tableRead: true, tableWrite: true } } }), /capabilities/);
  const syncOnly = fixture({ remindersEnabled: false });
  assert.doesNotThrow(() => syncOnly.create({ adapter: { ...syncOnly.adapter, capabilities: { tableRead: true, tableWrite: true } } }));
});
test('identity, table, field and unsupported action checks block writes', async () => {
  const f = fixture(), identity = (await f.runtime.dispatch('health')).identity;
  await assert.rejects(f.runtime.dispatch('sync', { expectedIdentity: { ...identity, base: 'other/table' } }), /differs/);
  f.setIdentity('another-user');
  await assert.rejects(f.runtime.dispatch('sync'), /identity/);
  f.setIdentity('test-user');
  await assert.rejects(f.runtime.dispatch('exec', {}), /Unsupported/);
  await assert.rejects(f.runtime.dispatch('sync', { deliveryDate: '2026-10-13' }), /Unsupported/);
  await assert.rejects(f.runtime.dispatch('read', { base: 'other/table', recordId: 'recInitial', read: true }), /configured table/);
  const client = createAdapterClient(f.config, f.adapter);
  await assert.rejects(client.request('PUT', '/open-apis/bitable/v1/apps/baseTest/tables/tblTest/records/recInitial', { data: { fields: { 笔记: 'overwrite' } } }), /reading-status/);
  assert.equal(f.writes.length, 0);
});
test('scheduler owns 10:00 reminders; concurrent instances share receipts across restarts', async () => {
  const f = fixture();
  await f.runtime.dispatch('sync'); assert.equal(f.sends.length, 0);
  assert.equal((await f.runtime.daily()).skipped, true);
  f.setTime(Date.UTC(2026, 9, 13, 2));
  await Promise.all([f.runtime.daily(), f.create().daily()]);
  assert.equal(f.sends.length, 1);
  assert.equal(f.records[0].fields.阅读状态, '待阅读');
  await f.create().daily(); assert.equal(f.sends.length, 1);
  f.setTime(Date.UTC(2026, 9, 14, 2)); await f.create().daily(); assert.equal(f.sends.length, 2);
  const disabled = fixture({ remindersEnabled: false }); disabled.setTime(Date.UTC(2026, 9, 13, 3));
  assert.equal((await disabled.runtime.daily()).skipped, true); assert.equal(disabled.sends.length, 0);
});
test('timezone and daylight-saving boundaries use local calendar dates', () => {
  assert.equal(dueDate(Date.UTC(2026, 9, 13, 1, 59), 'Asia/Shanghai'), null);
  assert.equal(dueDate(Date.UTC(2026, 9, 13, 2), 'Asia/Shanghai'), '2026-10-13');
  assert.equal(dueDate(Date.UTC(2026, 9, 13, 16), 'Asia/Shanghai'), null);
  assert.equal(dueDate(Date.UTC(2026, 2, 7, 15), 'America/New_York'), '2026-03-07');
  assert.equal(dueDate(Date.UTC(2026, 2, 8, 13, 59), 'America/New_York'), null);
  assert.equal(dueDate(Date.UTC(2026, 2, 8, 14), 'America/New_York'), '2026-03-08');
});
test('adapter failures hide raw errors and language preferences persist', async () => {
  const f = fixture();
  await f.runtime.dispatch('preferences', { language: 'zh' });
  assert.equal((await f.create().dispatch('health')).configuration.language, 'zh');
  const bad = f.create({ adapter: { ...f.adapter, request: async () => { throw new Error('private-token'); } } });
  await assert.rejects(bad.dispatch('sync'), error => !error.message.includes('private-token'));
});
test('Fetch handler validates auth, exact origin, verbs, routes, body and CORS', async () => {
  const f = fixture(), handle = handlerFor(f);
  assert.equal((await handle(request())).status, 200);
  for (const [options, status] of [
    [{ headers: { Authorization: '' } }, 401], [{ headers: { Authorization: `Bearer ${'b'.repeat(43)}` } }, 401],
    [{ headers: { Origin: 'https://untrusted.example' } }, 403], [{ method: 'GET' }, 405],
    [{ path: '/v1/daily' }, 404], [{ path: '/v1/health?secret=anything' }, 400],
    [{ headers: { 'Content-Type': 'text/plain' } }, 415], [{ headers: { 'Content-Encoding': 'gzip' } }, 415],
    [{ body: 'invalid' }, 400], [{ body: '[]' }, 400],
  ]) assert.equal((await handle(request(options))).status, status);
  const preflight = await handle(request({ method: 'OPTIONS', headers: { Authorization: '', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } }));
  assert.equal(preflight.status, 204); assert.equal(await preflight.text(), '');
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), `chrome-extension://${extensionId}`);
  assert.equal((await handlerFor(f, { maxBytes: 16 })(request({ body: JSON.stringify({ large: 'x'.repeat(17) }) }))).status, 400);
  assert.equal((await handle(new Request('http://connection.example.com/v1/health'))).status, 400);
});
test('HTTP adapter bounds active operations and withholds unexpected errors', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const handle = handlerFor(fixture(), { connector: { dispatch: async () => { await waiting; throw new Error('private-token'); } } });
  const first = handle(request()), second = handle(request());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await handle(request())).status, 429);
  release();
  for (const response of await Promise.all([first, second])) assert.equal((await response.text()).includes('private-token'), false);
});
test('offline browser performs no network calls; linked updates fail rather than pretend to sync', async () => {
  const call = createConnectionClient({ authentication: 'bearer', baseUrl: '', storage: area({}), fetchImpl: () => assert.fail('offline network') });
  assert.equal((await call('sync')).enabled, false);
  assert.equal((await call('health')).connected, false);
  await assert.rejects(call('read'), /Configure/);
});
test('browser-to-handler round trip verifies capabilities and pins identity before syncing', async () => {
  const f = fixture(), handle = handlerFor(f), local = { connectionAccessKey: key };
  const call = createConnectionClient({ authentication: 'bearer', baseUrl: origin, storage: area(local), fetchImpl: async (url, options) => {
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    return handle(new Request(url, options));
  } });
  await call('health'); assert.equal(local.collectionIdentity.connectionId, 'test-user');
  assert.equal((await call('sync')).articles.length, 1);
  await call('read', { base: 'baseTest/tblTest', recordId: 'recInitial', read: true });
  assert.equal(f.records[0].fields.阅读状态, '已读');
  const corrupted = createConnectionClient({ authentication: 'bearer', baseUrl: origin, storage: area(local), fetchImpl: async () => Response.json({ ok: true, protocolVersion: 1, identity: { connectionId: 'other', base: 'baseTest/tblTest' } }) });
  await assert.rejects(corrupted('health'), /differs/);
  const invalid = createConnectionClient({ authentication: 'bearer', baseUrl: origin, storage: area(local), fetchImpl: async () => Response.json({ ok: true, protocolVersion: 1, identity: local.collectionIdentity, enabled: true, base: 'baseTest/tblTest', articles: [null], bindings: [], topics: [] }) });
  await assert.rejects(invalid('sync'), /snapshot/);
  local.connectionBaseUrl = 'https://previous.example.com';
  await assert.rejects(call('health'), /Disconnect.*connection address/);
});

test('base-path connection reaches only its mounted routes and refuses key reuse on another path', async () => {
  const f = fixture(), local = { connectionAccessKey: key, connectionBaseUrl: origin + '/readflow/' };
  const handle = handlerFor(f, { baseUrl: origin + '/readflow/' });
  const urls = [];
  const call = createConnectionClient({ authentication: 'bearer', baseUrl: origin + '/readflow', storage: area(local), fetchImpl: async (url, options) => {
    urls.push(url); return handle(new Request(url, options));
  } });
  await call('health'); await call('sync');
  assert.deepEqual(urls, [origin + '/readflow/v1/health', origin + '/readflow/v1/sync']);
  for (const path of ['/v1/health', '/readflow-other/v1/health', '/readflow//v1/health', '/readflow/v1/health/']) {
    assert.equal((await handle(request({ path }))).status, 404);
  }
  assert.equal((await handle(request({ path: '/readflow/v1/health', headers: { Authorization: '' } }))).status, 401);
  const changedPath = createConnectionClient({ authentication: 'bearer', baseUrl: origin + '/another/', storage: area(local), fetchImpl: () => assert.fail('key must not cross base paths') });
  await assert.rejects(changedPath('health'), /Disconnect.*connection address/);
});

test('saved custom reminder time governs sends and survives connector restart', async () => {
  const f = fixture();
  await f.runtime.dispatch('preferences', { language: 'en', reminderTime: '11:35', timeZone: 'Asia/Shanghai' });
  f.setTime(Date.UTC(2026, 9, 13, 3, 34)); assert.equal((await f.create().daily()).skipped, true);
  f.setTime(Date.UTC(2026, 9, 13, 3, 35)); await f.create().daily(); assert.equal(f.sends.length, 1);
  await f.runtime.dispatch('preferences', { language: 'en', reminderTime: '09:00' });
  await f.create().daily(); assert.equal(f.sends.length, 1);
  f.setTime(Date.UTC(2026, 9, 14, 1)); await f.create().daily(); assert.equal(f.sends.length, 2);
});
