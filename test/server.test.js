import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHttpHandler } from '../server/http.js';
import { validateServerConfig } from '../server/config.js';
import { createServerRuntime, dueDate } from '../server/runtime.js';
import { ARTICLE_FIELDS } from '../src/lib/bitable.js';
import { callServer } from '../src/lib/server-bridge.js';
import { setSettings } from '../src/lib/storage.js';
import { area } from '../test-support/chrome-mock.js';

const key = 't'.repeat(43);
const config = validateServerConfig({ publicOrigin: 'https://newsbridge.example.com', extensionId: 'a'.repeat(32),
  apiTokenHash: createHash('sha256').update(key).digest('hex'), appId: 'cli_test', accountId: 'ou_test',
  larkCliPath: '/mock/lark-cli', cliWorkspace: '/mock/workspace', baseToken: 'baseTest', articleTableId: 'tblTest',
  chatId: 'oc_test', stateDir: '/mock/state', port: 8787, timeZone: 'Asia/Shanghai', language: 'en' });
async function http(handler, { method = 'POST', path = '/v1/health', headers = {}, body = {} } = {}) {
  const req = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  Object.assign(req, { method, url: path, headers: { host: 'newsbridge.example.com', 'x-forwarded-proto': 'https',
    origin: `chrome-extension://${config.extensionId}`, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...headers } });
  let result;
  const res = { writeHead: (status, values) => { result = { status, headers: values }; }, end: bytes => { result.body = JSON.parse(bytes); } };
  await handler(req, res); return result;
}
function fixture() {
  let time = Date.UTC(2026, 9, 13, 1), journal = { version: 1, scopes: {} };
  const records = [{ record_id: 'recOne', fields: { 标题: 'One', 链接: 'https://example.com/1', 阅读状态: '待阅读' } }], sends = [], writes = [];
  const run = async (method, path, { data } = {}) => {
    if (path.endsWith('user_info')) return { code: 0, data: { open_id: 'ou_test' } };
    if (path.endsWith('/fields')) return { data: { items: Object.entries(ARTICLE_FIELDS).map(([field_name, type]) => ({ field_name, type })) } };
    if (path.endsWith('/messages')) { sends.push(data); return { data: { message_id: `om_${sends.length}` } }; }
    if (method !== 'GET') { writes.push(data); return { data: {} }; }
    return { data: { items: records } };
  };
  const store = { load: async () => structuredClone(journal), save: async state => { journal = structuredClone(state); } };
  const runtime = createServerRuntime({ config, run, store, exclusive: work => work(), now: () => time });
  return { runtime, sends, writes, records, store, setTime: value => { time = value; } };
}

test('server enforces HTTPS proxy, exact origin, bearer key, methods and JSON before dispatch', async () => {
  let calls = 0;
  const handler = createHttpHandler({ config, dispatch: async () => { calls++; return { ok: true }; } });
  assert.equal((await http(handler)).status, 200);
  assert.equal(calls, 1);
  for (const [options, status] of [
    [{ headers: { 'x-forwarded-proto': 'http' } }, 400], [{ headers: { host: 'evil.example' } }, 400],
    [{ headers: { origin: 'https://evil.example' } }, 403], [{ headers: { authorization: '' } }, 401],
    [{ headers: { authorization: `Bearer ${'b'.repeat(43)}` } }, 401], [{ method: 'GET' }, 405],
    [{ path: '/v1/health?token=anything' }, 404], [{ path: '/v1/exec' }, 404],
    [{ headers: { 'content-type': 'text/plain' } }, 415], [{ headers: { 'content-encoding': 'gzip' } }, 415],
  ]) assert.equal((await http(handler, options)).status, status);
  assert.equal(calls, 1);
});
test('CORS preflight permits only the configured extension, POST and fixed headers', async () => {
  const handler = createHttpHandler({ config, dispatch: () => assert.fail('preflight dispatch') });
  const valid = { method: 'OPTIONS', headers: { authorization: '', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } };
  const result = await http(handler, valid);
  assert.equal(result.status, 204);
  assert.equal(result.headers['Access-Control-Allow-Origin'], `chrome-extension://${config.extensionId}`);
  assert.equal((await http(handler, { ...valid, headers: { ...valid.headers, origin: 'chrome-extension://untrusted' } })).status, 403);
  assert.equal((await http(handler, { ...valid, headers: { ...valid.headers, 'access-control-request-headers': 'x-api-url' } })).status, 403);
});
test('malformed and oversized requests and reflected internal errors do not disclose data', async () => {
  let calls = 0;
  const handler = createHttpHandler({ config, maxBytes: 50, dispatch: async () => { calls++; throw new Error('private-token'); } });
  for (const body of ['broken-private-token', 'x'.repeat(51), '[]']) assert.equal((await http(handler, { body })).status, 400);
  assert.equal(calls, 0);
  const failure = await http(handler);
  assert.equal(failure.status, 400);
  assert.equal(JSON.stringify(failure).includes('private-token'), false);
});
test('server bounds concurrent request processing', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const handler = createHttpHandler({ config, dispatch: async () => { await pending; return { ok: true }; } });
  const first = http(handler), second = http(handler);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await http(handler)).status, 429);
  release(); await Promise.all([first, second]);
});
test('API sync cannot trigger daily deliveries; only server clock starts reminders at Shanghai 10:00', async () => {
  const f = fixture();
  await f.runtime.dispatch('sync', { items: [] }); assert.equal(f.sends.length, 0);
  await assert.rejects(f.runtime.dispatch('sync', { deliveryDate: '2026-10-13' }), /cannot trigger/);
  assert.equal((await f.runtime.daily()).skipped, true);
  f.setTime(Date.UTC(2026, 9, 13, 2)); await f.runtime.daily();
  assert.equal(f.sends.length, 1);
  await f.runtime.daily(); await f.runtime.dispatch('sync', {}); assert.equal(f.sends.length, 1);
  assert.equal(f.records[0].fields.阅读状态, '待阅读');
  f.setTime(Date.UTC(2026, 9, 14, 2)); await f.runtime.daily(); assert.equal(f.sends.length, 2);
});
test('server date and catch-up use configured timezone even when the execution host differs', () => {
  assert.equal(dueDate(Date.UTC(2026, 9, 13, 1, 59), 'Asia/Shanghai'), null);
  assert.equal(dueDate(Date.UTC(2026, 9, 13, 2), 'Asia/Shanghai'), '2026-10-13');
  assert.equal(dueDate(Date.UTC(2026, 9, 13, 15, 59), 'Asia/Shanghai'), '2026-10-13');
  assert.equal(dueDate(Date.UTC(2026, 9, 13, 16), 'Asia/Shanghai'), null);
});
test('message preferences persist on server and account mismatch blocks changes', async () => {
  const f = fixture();
  await assert.rejects(f.runtime.dispatch('preferences', { language: 'zh', expectedIdentity: { appId: 'cli_other' } }), /differs/);
  await assert.rejects(f.runtime.dispatch('preferences', { language: 'zh', chatId: 'oc_other' }), /Invalid/);
  await f.runtime.dispatch('preferences', { language: 'zh' });
  f.setTime(Date.UTC(2026, 9, 13, 2)); await f.runtime.daily();
  assert.ok(JSON.parse(f.sends[0].content).zh_cn);
  assert.equal((await f.runtime.dispatch('health')).configuration.reminderOwner, 'server');
});
test('browser connects only to its fixed HTTPS origin with no cookies or redirects', async t => {
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, original));
  const local = { serverAccessKey: key };
  globalThis.chrome = { storage: { local: area(local) } };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://newsbridge.example.com/v1/health'); assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, `Bearer ${key}`);
    return Response.json({ ok: true, identity: { appId: 'cli_test', openId: 'ou_test' } });
  };
  await callServer('health'); assert.equal(local.collectionIdentity.openId, 'ou_test');
  await assert.rejects(callServer('exec'), /Unsupported/);
  globalThis.fetch = async () => Response.json({ msg: 'private-token' }, { status: 401 });
  await assert.rejects(callServer('health'), error => !error.message.includes('private-token'));
});
test('failed key replacement preserves the previous browser key; settings response never returns the key', async t => {
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, original));
  const local = { serverAccessKey: key };
  globalThis.chrome = { storage: { local: area(local) } };
  globalThis.fetch = async () => Response.json({}, { status: 401 });
  await assert.rejects(setSettings({ language: 'zh', serverAccessKey: 'b'.repeat(43) }));
  assert.equal(local.serverAccessKey, key);
  globalThis.fetch = async () => Response.json({ ok: true });
  assert.deepEqual(await setSettings({ language: 'zh', serverAccessKey: 'b'.repeat(43) }), { language: 'zh' });
});
test('private initialization generates a matching key hash and refuses to overwrite config', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'newsbridge-init-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'server.config.json');
  const exec = promisify(execFile), script = new URL('../server/init-config.js', import.meta.url);
  const options = { env: { ...process.env, NEWSBRIDGE_CONFIG: path } };
  const result = await exec(process.execPath, [script.pathname], options);
  const secret = (await readFile(join(dir, 'browser-token.txt'), 'utf8')).trim();
  assert.equal(secret.length, 43);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).apiTokenHash, createHash('sha256').update(secret).digest('hex'));
  assert.equal(result.stdout.includes(secret), false);
  await assert.rejects(exec(process.execPath, [script.pathname], options));
});

test('personal template initialization preserves deployment IDs and rotation keeps the configuration private', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'newsbridge-private-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'server.config.json'), template = join(dir, 'template.json');
  const personal = { ...config, publicOrigin: 'https://personal.example.com', accountId: 'ou_personal' };
  await writeFile(template, JSON.stringify(personal), { mode: 0o600 });
  const exec = promisify(execFile), options = { env: { ...process.env, NEWSBRIDGE_CONFIG: path } };
  const init = new URL('../server/init-config.js', import.meta.url).pathname;
  const first = await exec(process.execPath, [init, '--template', template], options);
  const oldKey = (await readFile(join(dir, 'browser-token.txt'), 'utf8')).trim();
  const before = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(before.publicOrigin, personal.publicOrigin);
  assert.equal(before.accountId, personal.accountId);
  const rotated = await exec(process.execPath, [new URL('../server/rotate-key.js', import.meta.url).pathname], options);
  const newKey = (await readFile(join(dir, 'browser-token.txt'), 'utf8')).trim();
  assert.notEqual(newKey, oldKey);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { ...before, apiTokenHash: createHash('sha256').update(newKey).digest('hex') });
  for (const file of [path, join(dir, 'browser-token.txt')]) assert.equal((await stat(file)).mode & 0o777, 0o600);
  for (const output of [first.stdout, first.stderr, rotated.stdout, rotated.stderr]) {
    assert.equal(output.includes(oldKey) || output.includes(newKey) || output.includes(personal.publicOrigin), false);
  }
});
