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
    const call = createConnectionClient({ authentication: 'bearer', baseUrl, storage: area({ connectionAccessKey: key }), fetchImpl: (url, options) => handle(new Request(url, options)) });
    await assert.rejects(call(action), error => {
      assert.match(error.message, action === 'sync' ? /API_REJECTED; sync.fields; provider=1254015/ : /STATE_LOAD; pending.state.load/);
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
  for (const url of ['http://workspace.feishu.cn/base/baseTest?table=tblTest', 'https://feishu.cn.evil.com/base/baseTest?table=tblTest', 'https://workspace.feishu.cn/base/baseTest?table=', 'https://workspace.feishu.cn/base/baseTest?table=tblTest&table=tblOther']) assert.throws(() => parseTableUrl(url));
});
test('pasted table mismatch does not modify preferences or write records', async () => {
  const f = fixture();
  await assert.rejects(f.runtime.dispatch('preferences', { language: 'zh', table: 'baseOther/tblOther' }), /TABLE_MISMATCH/);
  assert.equal((await f.store.load()).preferences, undefined); assert.equal(f.writes.length, 0);
  await f.runtime.dispatch('preferences', { language: 'zh', table: 'baseTest/tblTest' });
  assert.equal((await f.runtime.dispatch('health')).configuration.language, 'zh');
});

test('empty Feishu record lists support omitted items but reject incomplete nonempty pages', async () => {
  for (const data of [{ items: [] }, { has_more: false, total: 0 }, { has_more: false }, { total: 0 }]) {
    const f = fixture(), request = f.adapter.request;
    const runtime = f.create({ adapter: { ...f.adapter, request: (method, path, options) => path.endsWith('/records') && method === 'GET' ? { code: 0, data: { ...data } } : request(method, path, options) } });
    const result = await runtime.dispatch('sync', { items: [] });
    assert.equal(result.ok, true); assert.deepEqual(result.articles, []);
  }
  const f = fixture(), request = f.adapter.request;
  for (const data of [{ has_more: true }, { has_more: false, total: 1 }, {}]) {
    const runtime = f.create({ adapter: { ...f.adapter, request: (method, path, options) => path.endsWith('/records') ? { code: 0, data } : request(method, path, options) } });
    await assert.rejects(runtime.dispatch('sync'), error => error.diagnostic.stage === 'sync.records.list' && error.diagnostic.code === 'API_RESPONSE');
  }
});
test('plain adapter error diagnostics survive wrapping with operation-qualified stage', async () => {
  const f = fixture(), logs = [];
  const runtime = f.create({ onDiagnostic: d => logs.push(d), adapter: { ...f.adapter, request: async () => {
    throw Object.assign(new Error('private-token'), { diagnostic: { code: 'API_REJECTED', stage: 'records.list', providerCode: 1254030, httpStatus: 403 } });
  } } });
  await assert.rejects(runtime.dispatch('sync'), error => error.diagnostic.stage === 'sync.records.list' && error.diagnostic.providerCode === 1254030);
  assert.equal(logs[0].httpStatus, 403); assert.doesNotMatch(JSON.stringify(logs), /private-token/);
});
test('reminder preference is durable, actually stops delivery, and cannot provision an unavailable scheduler', async () => {
  const f = fixture(); f.setTime(Date.UTC(2026, 9, 13, 3));
  await f.runtime.dispatch('preferences', { language: 'en', remindersEnabled: false });
  assert.equal((await f.create().dispatch('health')).configuration.remindersEnabled, false);
  assert.equal((await f.create().daily()).skipped, true); assert.equal(f.sends.length, 0);
  await f.runtime.dispatch('preferences', { language: 'zh' });
  assert.equal((await f.create().daily()).skipped, true);
  await f.runtime.dispatch('preferences', { language: 'en', remindersEnabled: true });
  await f.create().daily(); assert.equal(f.sends.length, 1);
  const unavailable = fixture({ remindersEnabled: false });
  await assert.rejects(unavailable.runtime.dispatch('preferences', { language: 'en', remindersEnabled: true }), /REMINDERS_UNAVAILABLE/);
});
test('client distinguishes invalid key from unregistered extension without reflecting response text', async () => {
  for (const [status, code] of [[401, 'KEY_INVALID'], [403, 'ORIGIN_DENIED']]) {
    const call = createConnectionClient({ authentication: 'bearer', baseUrl, storage: area({ connectionAccessKey: key }), fetchImpl: async () => Response.json({ error: 'private-token' }, { status }) });
    await assert.rejects(call('health'), error => error.message.includes(code) && !error.message.includes('private-token'));
  }
});
test('explicit probe reads back URL/text encoding then deletes only its new record; uncertain cleanup blocks retry', async () => {
  const { writeProbe } = await import('../examples/write-probe.js');
  const { ARTICLE_FIELDS } = await import('../src/lib/bitable.js');
  for (const linkType of [1, 15]) {
    for (const failure of ['', 'read', 'delete']) {
      const f = fixture(), methods = []; let saved;
      const config = { ...f.config, connectionId: 'app:cli_test' };
      const adapter = createAdapter({ config, getCredentials: () => ({ appId: 'cli_test', appSecret: 'test-secret' }), fetchImpl: async (url, options) => {
        const path = new URL(url).pathname;
        if (path.endsWith('/internal')) return Response.json({ code: 0, tenant_access_token: 'test-token' });
        if (path.endsWith('/fields')) return Response.json({ code: 0, data: { items: Object.entries(ARTICLE_FIELDS).map(([field_name, type]) => ({ field_name, type: field_name === '链接' ? linkType : type })) } });
        methods.push(options.method);
        if (options.method === 'POST') { saved = JSON.parse(options.body).fields; return Response.json({ code: 0, data: { record: { record_id: 'recProbe' } } }); }
        assert.ok(path.endsWith('/records/recProbe'));
        if (options.method === 'DELETE') return Response.json(failure === 'delete' ? { code: 403, msg: 'private-token' } : { code: 0, data: { record_id: 'recProbe', deleted: true } });
        return Response.json({ code: 0, data: { record: { fields: { ...saved, 标题: [{ text: saved.标题 }], 内容: [{ text: saved.内容 }], 笔记: [{ text: saved.笔记 }], 链接: failure === 'read' ? 'https://example.com/wrong' : saved.链接 } } } });
      } });
      const run = () => writeProbe({ adapter, config, store: f.store, exclusive: f.exclusive });
      if (failure) await assert.rejects(run(), new RegExp(failure === 'delete' ? 'PROBE_CLEANUP' : 'PROBE_FAILED'));
      else assert.deepEqual(await run(), { ok: true, roundTrip: true, deleted: true });
      assert.deepEqual(methods, ['POST', 'GET', 'DELETE']);
      assert.equal(!!(await f.store.load()).probe, failure === 'delete');
      if (failure === 'delete') { await assert.rejects(run(), /PROBE_CLEANUP/); assert.equal(methods.length, 3); }
    }
  }
});
test('reference CLI supports explicit env file and state audit; private files reject broad permissions/hard links', async t => {
  const { chmod, link, unlink } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'newsbridge-audit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'host.json'), envFile = join(dir, 'host.env');
  await writeFile(file, JSON.stringify({ stateDir: './state' }), { mode: 0o600 });
  await writeFile(envFile, 'NEWSBRIDGE_TEST_VALUE=loaded\n', { mode: 0o600 });
  const cli = new URL('../examples/run.mjs', import.meta.url).pathname;
  const init = await exec(process.execPath, [cli, 'init', file, '--env', envFile]);
  assert.equal(JSON.parse(init.stdout.split('\n')[0]).ok, true);
  assert.match(init.stdout, /check .*--write/);
  const audit = await exec(process.execPath, [cli, 'audit', file]); assert.equal(JSON.parse(audit.stdout).hardLinks, 1);
  const state = await createFileState({ stateDir: join(dir, 'state'), authentication: 'paired' });
  await chmod(join(dir, 'state/state.json'), 0o644); await assert.rejects(state.audit());
  await chmod(join(dir, 'state/state.json'), 0o600);
  await link(join(dir, 'state/state.json'), join(dir, 'extra-link')); await assert.rejects(state.audit());
  await unlink(join(dir, 'extra-link')); assert.equal((await state.audit()).ok, true);
});

test('first capture into a zero-record table succeeds without a seed record', async () => {
  const f = fixture(); f.records.splice(0);
  const request = f.adapter.request;
  const runtime = f.create({ adapter: { ...f.adapter, request: (method, path, options) => method === 'GET' && path.endsWith('/records') && !f.records.length ? { code: 0, data: { has_more: false, total: 0 } } : request(method, path, options) } });
  const items = [{ id: 'first', title: 'First', url: 'https://example.com/first', savedAt: '2026-10-14T00:00:00Z', read: false }];
  assert.equal((await runtime.dispatch('sync', { items })).created, 1);
  assert.equal((await runtime.dispatch('sync', { items })).created, 0);
  assert.equal(f.records.length, 1);
});
