import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openLibrary } from '../examples/database.js';
import { createFileState } from '../examples/file-state.js';
import { createHost } from '../examples/host.js';
import { createDatabaseConnector } from '../connector/database-runtime.js';
import { createFeishuService } from '../examples/feishu-service.js';
import { libraryCsv } from '../connector/lib/csv.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'readflow-db-'));
  const persistence = await createFileState({ stateDir: dir, authentication: 'paired' }); await persistence.initialize();
  const library = await openLibrary(dir, { initialize: true });
  t.after(async () => { try { library.close(); } catch {} await rm(dir, { recursive: true, force: true }); });
  return { dir, library, persistence };
}
const item = (extra = {}) => ({ id: randomUUID(), title: 'An article', url: 'https://example.com/article', savedAt: '2026-10-22T00:00:00Z', ...extra });

test('SQLite is the sole source: atomic capture, dedupe, edit replay, read state and restart persistence', async t => {
  const { dir, library } = await fixture(t);
  const capture = item({ metadataUpdate: { id: randomUUID(), fields: { tags: ['AI'], remark: 'First' } } });
  const result = library.sync([capture]); assert.equal(result.created, 1);
  const id = result.articles[0].recordId;
  library.setStatus(id, '已读');
  library.sync([item({ metadataUpdate: { id: randomUUID(), fields: { remark: 'Newer' } } })]);
  library.sync([capture]); // Lost response retry cannot overwrite newer edits.
  assert.equal(library.get(id).remark, 'Newer'); assert.equal(library.get(id).read, true);
  assert.equal(library.sync([item()]).created, 0);
  assert.throws(() => library.sync([item({ url: 'https://example.com/new' }), item({ url: 'javascript:bad' })]));
  assert.equal(library.list().length, 1);
  const another = await openLibrary(dir); assert.equal(another.get(id).remark, 'Newer'); assert.deepEqual(another.identity, library.identity); another.close();
  library.setStatus(id, '待阅读'); library.applyAction('event1', id, 'later', 1000); library.applyAction('event1', id, 'later', 5000);
  assert.equal(library.get(id).snoozedUntil, 86401000);
  library.applyAction('event2', id, 'skip'); assert.equal(library.get(id).status, '跳过');
});

test('database host needs no Feishu credentials; authenticated library identity cannot be replaced', async t => {
  const { dir } = await fixture(t);
  const host = await createHost({ stateDir: dir, baseUrl: 'https://connection.example.com/readflow/', extensionId: '', connector: { storageProvider: 'database', remindersEnabled: false } }, { getCredentials: () => assert.fail('must not authorize Feishu') });
  t.after(() => host.close());
  const health = await host.connector.dispatch('health', { provider: 'database' });
  assert.equal(health.configuration.storageProvider, 'database'); assert.equal(Object.hasOwn(health.capabilities, 'export'), false);
  const result = await host.connector.dispatch('sync', { items: [item()] }); assert.equal(result.created, 1);
  await assert.rejects(host.connector.dispatch('sync', { items: [], expectedIdentity: { connectionId: 'db:wrong', base: 'other/library' } }));
  await assert.rejects(host.connector.dispatch('export'), /Unsupported database operation/);
  const retired = await host.handleRequest(new Request('https://connection.example.com/readflow/v1/export', { method: 'POST' }));
  assert.equal(retired.status, 404);
  const csv = await host.connector.dispatch('csv'); assert.equal(csv.count, 1); assert.match(csv.csv, /An article/);
  assert.equal((await host.connector.daily()).skipped, true);
});

test('CSV protects spreadsheet formulas, quotes newlines, and exports seven useful columns', () => {
  const csv = libraryCsv([{ title: '=1+1', url: 'https://example.com/', tags: ['AI'], remark: 'line 1\n"line 2"', savedAt: 0 }]);
  assert.ok(csv.startsWith('\uFEFF')); assert.match(csv, /"'=1\+1"/); assert.match(csv, /line 1\n""line 2""/);
  assert.equal(csv.split('\r\n')[0].split(',').length, 7);
});

test('database refuses unsafe filesystem permissions', async t => {
  const { dir } = await fixture(t); await chmod(join(dir, 'readflow.sqlite'), 0o644);
  await assert.rejects(openLibrary(dir), /private/);
});

test('daily reminders use database preferences and persist actionable-card receipts without table calls', async t => {
  const { library, persistence } = await fixture(t);
  const sends = []; const now = Date.UTC(2026, 9, 22, 2, 1);
  const feishu = { send: async (chat, type, content, uuid) => { sends.push({ chat, type, content, uuid }); return { code: 0, data: { message_id: 'om_card1' } }; } };
  const connector = createDatabaseConnector({ library, config: { remindersEnabled: true, interactive: true, chatId: 'oc_test' }, feishu, store: library.store, exclusive: persistence.exclusive, now: () => now });
  await connector.dispatch('sync', { items: [item()] });
  assert.equal((await connector.daily()).skipped, true); // Available is not enabled.
  await connector.dispatch('preferences', { language: 'zh', remindersEnabled: true });
  assert.equal((await connector.daily()).deliveries, 1); assert.equal(sends[0].type, 'interactive');
  assert.equal(sends[0].content.elements[1].actions[2].value.action, 'later');
  const state = await library.store.load(), scope = Object.values(state.scopes)[0];
  assert.deepEqual(scope.cards.om_card1.recordIds, [library.list()[0].recordId]);
  assert.equal(scope.cards.om_card1.requestId, sends[0].uuid);
  await connector.daily(); assert.equal(sends.length, 1);
  assert.equal(library.list()[0].read, false);
});

test('legacy note and remark consolidate once without discarding distinct text or old content', async t => {
  const { dir, library } = await fixture(t);
  const article = library.sync([item()]).articles[0];
  library.close();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(dir, 'readflow.sqlite'));
  db.prepare('UPDATE articles SET data=? WHERE id=?').run(JSON.stringify({ ...article, remark: 'Capture reason', note: 'Reading insight', content: 'Retained old content' }), article.recordId);
  db.close();
  for (let i = 0; i < 2; i++) {
    const reopened = await openLibrary(dir);
    const saved = reopened.get(article.recordId);
    assert.equal(saved.remark, 'Capture reason\n\nReading insight');
    assert.equal(Object.hasOwn(saved, 'note'), false);
    assert.equal(saved.content, 'Retained old content');
    assert.match(libraryCsv([saved]), /Reading insight/);
    reopened.close();
  }
});


test('Feishu service exposes messages only; stale table configuration fails clearly', async t => {
  const { dir } = await fixture(t);
  const config = { stateDir: dir, baseUrl: 'https://connection.example.com/readflow/', extensionId: '', connector: { storageProvider: 'database', remindersEnabled: false } };
  await assert.rejects(createHost({ ...config, feishu: { export: { baseToken: 'baseTest', articleTableId: 'tblTest' } } }), /no longer supported/);
  let called = false;
  const service = createFeishuService({ config: {}, getCredentials: () => { called = true; } });
  assert.deepEqual(Object.keys(service), ['send']);
  await assert.rejects(service.send('oc_unlisted', 'post', {}, randomUUID()));
  assert.equal(called, false);
});
