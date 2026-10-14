import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fixture } from '../test-support/connector-fixture.js';
import { createAdapter } from '../examples/adapter.js';
import { createFileState } from '../examples/file-state.js';
import { createHttpHandler } from '../connector/http.js';
import { createConnectionClient } from '../src/lib/connection.js';
import { parseTableUrl } from '../src/lib/table-url.js';
import { area } from '../test-support/chrome-mock.js';
const exec = promisify(execFile);
const baseUrl = 'https://connection.example.com/newsbridge/';
const key = 't'.repeat(43);

test('sync/pending failures reach browser and diagnostic callback without raw secrets', async () => {
  for (const action of ['sync', 'pending']) {
    const f = fixture(), logs = [];
    const runtime = f.create({ onDiagnostic: d => logs.push(d), ...(action === 'pending' ? {
      store: { load: async () => { throw new Error('private-token'); }, save: async () => {} },
    } : { adapter: { ...f.adapter, request: async () => ({ code: 1254015, msg: 'private-token' }) } }) });
    const handle = createHttpHandler({ baseUrl, authenticate: async () => true, connector: runtime });
    const call = createConnectionClient({ baseUrl, storage: area({ connectionAccessKey: key }), fetchImpl: (url, options) => handle(new Request(url, options)) });
    await assert.rejects(call(action), error => {
      assert.match(error.message, action === 'sync' ? /API_REJECTED; fields; provider=1254015/ : /STATE_LOAD; state.load/);
      assert.match(error.message, /ref=/); assert.doesNotMatch(error.message, /private-token/); return true;
    });
    assert.equal(logs.length, 1); assert.doesNotMatch(JSON.stringify(logs), /private-token/);
  }
});
test('health preflight reports all incompatible fields without external writes', async () => {
  const f = fixture();
  const runtime = f.create({ adapter: { ...f.adapter, request: async () => ({ code: 0, data: { items: [{ field_name: '标题', type: 2 }] } }) } });
  await assert.rejects(runtime.dispatch('health'), error => {
    assert.equal(error.diagnostic.code, 'SCHEMA_INVALID'); assert.equal(error.diagnostic.fields.length, 8);
    assert.match(error.message, /标题: expected 1, actual 2/); return true;
  });
  assert.equal(f.writes.length, 0);
});
test('unregistered extension permits authenticated no-Origin checks but denies browser and preflight', async () => {
  const f = fixture();
  const handle = createHttpHandler({ baseUrl, connector: f.runtime, authenticate: async () => true });
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  assert.equal((await handle(new Request(baseUrl + 'v1/health', { method: 'POST', headers, body: '{}' }))).status, 200);
  assert.equal((await handle(new Request(baseUrl + 'v1/health', { method: 'POST', headers: { ...headers, Origin: 'chrome-extension://' + 'a'.repeat(32) }, body: '{}' }))).status, 403);
  assert.equal((await handle(new Request(baseUrl + 'v1/health', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } }))).status, 403);
  assert.equal((await handle(new Request(baseUrl + 'v1/health', { method: 'POST', body: '{}' }))).status, 401);
  assert.throws(() => createHttpHandler({ baseUrl, extensionId: 'invalid', authenticate: async () => true, connector: f.runtime }));
});
test('reference adapter obtains current credentials at call time and binds token to verified app', async () => {
  let credentials, seen = [];
  const config = { ...fixture().config, connectionId: 'app:cli_test' };
  const adapter = createAdapter({ config, getCredentials: () => credentials, fetchImpl: async (url, options) => {
    seen.push([String(url), options]);
    if (String(url).endsWith('/internal')) return Response.json({ code: 0, tenant_access_token: 'test-issued-token' });
    assert.equal(options.headers.Authorization, 'Bearer test-issued-token');
    return Response.json({ code: 0, data: { items: [] } });
  } });
  await assert.rejects(adapter.getIdentity(), /AUTH_VERIFY/);
  credentials = { appId: 'cli_test', appSecret: 'test-first-secret' };
  assert.equal((await adapter.getIdentity()).connectionId, 'app:cli_test');
  credentials = { ...credentials, appSecret: 'test-rotated-secret' };
  await adapter.request('GET', '/open-apis/bitable/v1/apps/baseTest/tables/tblTest/fields', { params: { page_size: 100 } });
  assert.equal(JSON.parse(seen.at(-2)[1].body).app_secret, 'test-rotated-secret');
  assert.match(seen.at(-1)[0], /page_size=100/);
  credentials = { ...credentials, appId: 'cli_other' };
  await assert.rejects(adapter.request('GET', '/open-apis/bitable/v1/apps/baseTest/tables/tblTest/fields'), /AUTH_VERIFY/);
  assert.match(seen.at(-1)[0], /internal$/);
});
test('reference adapter preserves numeric HTTP/provider diagnostics and never reflects payload', async () => {
  const adapter = createAdapter({ config: { ...fixture().config, connectionId: 'app:cli_test' },
    getCredentials: () => ({ appId: 'cli_test', appSecret: 'test-secret' }),
    fetchImpl: async () => Response.json({ code: 99991663, msg: 'private-token' }, { status: 403 }) });
  await assert.rejects(adapter.getIdentity(), error => {
    assert.equal(error.diagnostic.httpStatus, 403); assert.equal(error.diagnostic.providerCode, 99991663);
    assert.doesNotMatch(error.message, /private-token/); return true;
  });
});
test('file state survives restart; lock excludes another OS process; init never replaces key or receipts', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'newsbridge-state-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const state = await createFileState({ stateDir: dir }); await state.initialize();
  const oldKey = await readFile(join(dir, 'access.key'), 'utf8');
  const data = { version: 1, scopes: { saved: { sent: {} } } };
  await state.exclusive(() => state.store.save(data));
  const restarted = await createFileState({ stateDir: dir }); await restarted.initialize();
  assert.deepEqual(await restarted.store.load(), data);
  assert.equal(await readFile(join(dir, 'access.key'), 'utf8'), oldKey);
  assert.equal((await stat(join(dir, 'state.json'))).mode & 0o777, 0o600);
  const module = new URL('../examples/file-state.js', import.meta.url).href;
  const script = `import { createFileState } from ${JSON.stringify(module)}; const s = await createFileState({stateDir: process.argv[1]}); try { await s.exclusive(async () => console.log('entered')); } catch(e) { console.log(e.diagnostic?.code); }`;
  await state.exclusive(async () => {
    const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', script, dir]);
    assert.equal(stdout.trim(), 'LOCK_BUSY');
  });
  assert.equal((await exec(process.execPath, ['--input-type=module', '-e', script, dir])).stdout.trim(), 'entered');
  await assert.rejects(state.exclusive(async () => { throw new Error('work failed'); }), /work failed/);
  await restarted.exclusive(async () => {});
  await writeFile(join(dir, 'state.lock'), 'simulated crashed owner', { mode: 0o600 });
  await assert.rejects(state.exclusive(async () => assert.fail('stale lock stolen')), /LOCK_BUSY/);
});
test('table link parser accepts direct table links, removes extras and rejects ambiguous destinations', () => {
  const result = parseTableUrl('https://workspace.feishu.cn/base/baseTest?table=tblTest&view=vewTest#anything');
  assert.equal(result.url, 'https://workspace.feishu.cn/base/baseTest?table=tblTest');
  assert.equal(result.base, 'baseTest/tblTest');
  for (const url of ['http://workspace.feishu.cn/base/baseTest?table=tblTest', 'https://feishu.cn.evil.com/base/baseTest?table=tblTest', 'https://workspace.feishu.cn/base/baseTest', 'https://workspace.feishu.cn/wiki/node?table=tblTest', 'https://workspace.feishu.cn/base/baseTest?table=tblTest&table=tblOther']) assert.throws(() => parseTableUrl(url));
});
test('pasted table mismatch does not modify preferences or write records', async () => {
  const f = fixture();
  await assert.rejects(f.runtime.dispatch('preferences', { language: 'zh', table: 'baseOther/tblOther' }), /TABLE_MISMATCH/);
  assert.equal((await f.store.load()).preferences, undefined); assert.equal(f.writes.length, 0);
  await f.runtime.dispatch('preferences', { language: 'zh', table: 'baseTest/tblTest' });
  assert.equal((await f.runtime.dispatch('health')).configuration.language, 'zh');
});
