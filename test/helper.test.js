import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, stat, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateHelperConfig, readPrivateJson } from '../helper/config.js';
import { createCliRunner, createCliClient } from '../helper/cli.js';
import { createHelperBridge } from '../helper/bridge.js';
import { createJournal, withJournalLock } from '../helper/journal.js';

const config = validateHelperConfig({ extensionId: 'a'.repeat(32), appId: 'cli_test', accountId: 'ou_test',
  larkCliPath: '/mock/lark-cli', cliWorkspace: '/mock/workspace', baseToken: 'baseTest', articleTableId: 'tblTest', chatId: 'oc_test' });
const key = JSON.stringify(['cli_test', 'ou_test', 'baseTest', 'tblTest', 'oc_test']);
async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'newsbridge-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function memoryStore() {
  let state = { version: 1, scopes: {} };
  return { load: async () => structuredClone(state), save: async value => { state = structuredClone(value); } };
}

test('CLI runner uses a fixed executable/workspace, no shell, and puts private text only on stdin', async () => {
  let stdin;
  const run = createCliRunner(config, { exec: (executable, args, options, callback) => {
    assert.equal(executable, config.larkCliPath);
    assert.equal(options.cwd, config.cliWorkspace);
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 60000);
    assert.equal(options.env.PATH.split(':')[0], process.execPath.slice(0, process.execPath.lastIndexOf('/')));
    assert.equal(args.includes('private-note'), false);
    assert.deepEqual(args.slice(-2), ['--data', '-']);
    queueMicrotask(() => callback(null, JSON.stringify({ ok: true, identity: 'user', data: { message_id: 'om_test' } })));
    return { stdin: { on() {}, end: value => { stdin = value; } } };
  } });
  assert.equal((await run('POST', '/mock', { data: { note: 'private-note' } })).data.message_id, 'om_test');
  assert.equal(JSON.parse(stdin).note, 'private-note');
  for (const [error, output] of [[new Error('private-token'), 'private-token'], [null, '{private-token'], [null, '{"ok":true,"identity":"bot","data":{}}']]) {
    const failed = createCliRunner(config, { exec: (_file, _args, _options, callback) => {
      queueMicrotask(() => callback(error, output)); return {};
    } });
    await assert.rejects(failed('GET', '/mock'), failure => !failure.message.includes('private-token'));
  }
});

test('account mismatch and disallowed operations stop before writing or running another API path', async () => {
  const calls = [];
  const run = async (method, path) => { calls.push([method, path]); return { data: { open_id: 'ou_other' } }; };
  const client = createCliClient(config, run);
  await assert.rejects(client.request('DELETE', '/open-apis/im/v1/messages'), /Unsupported/);
  assert.equal(calls.length, 0);
  await assert.rejects(client.request('PUT', '/open-apis/bitable/v1/apps/baseTest/tables/tblTest/records/recTest',
    { data: { fields: { 阅读状态: '已读' } } }), /identity/);
  assert.deepEqual(calls, [['GET', '/open-apis/authen/v1/user_info']]);
  const bridge = createHelperBridge({ config, run, store: memoryStore() });
  calls.length = 0;
  await assert.rejects(bridge('sync', { expectedIdentity: { appId: 'cli_other', openId: 'ou_test' } }), /differs/);
  assert.equal(calls.length, 0);
  await assert.rejects(bridge('exec', { command: 'arbitrary' }), /Unsupported/);
});

test('private config and journal reject permissive files, symlinks and corruption', async t => {
  const dir = await directory(t), path = join(dir, 'notification-state.json');
  const journal = createJournal(path);
  assert.deepEqual((await journal.load()).scopes, {});
  await journal.save({ version: 1, scopes: { [key]: { sent: {} } } });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.ok((await journal.load()).scopes[key]);
  await chmod(path, 0o644);
  await assert.rejects(journal.load(), /private/);
  await chmod(path, 0o600);
  const link = join(dir, 'link.json'); await symlink(path, link);
  await assert.rejects(readPrivateJson(link));
  await writeFile(path, 'corrupt');
  await assert.rejects(journal.load(), /invalid/);
  for (const override of [{ extensionId: '*' }, { larkCliPath: 'lark-cli' }, { chatId: 'other' }]) {
    assert.throws(() => validateHelperConfig({ ...config, ...override }), /Invalid/);
  }
});

test('delivery lock blocks concurrent helpers, releases on errors and recovers only old dead locks', async t => {
  const path = join(await directory(t), 'notification-state.lock');
  await withJournalLock(path, async () => {
    await assert.rejects(withJournalLock(path, () => assert.fail('second helper entered')), /busy/);
  });
  await assert.rejects(withJournalLock(path, async () => { throw new Error('test failure'); }), /test failure/);
  await withJournalLock(path, async () => {});
  await writeFile(path, JSON.stringify({ pid: 2147483647, at: Date.now() }), { mode: 0o600 });
  await assert.rejects(withJournalLock(path, async () => {}), /recovering/);
  await writeFile(path, JSON.stringify({ pid: 2147483647, at: Date.now() - 120001 }));
  let recovered = false;
  await withJournalLock(path, async () => { recovered = true; });
  assert.equal(recovered, true);
});

