import test from 'node:test';
import assert from 'node:assert/strict';
import { initialRoute } from '../src/lib/navigation.js';
import { isUnread, readingStatus } from '../src/lib/reading-state.js';
import { eligibleItems } from '../connector/lib/batch.js';
import { fixture } from '../test-support/connector-fixture.js';

test('unconfigured default opens settings; explicit home/collection/settings remain distinct views', () => {
  assert.equal(initialRoute('', false), 'settings'); assert.equal(initialRoute('', true), 'home');
  assert.equal(initialRoute('#unknown', false), 'settings');
  for (const route of ['home', 'reading-list', 'settings']) assert.equal(initialRoute('#' + route, false), route);
});
test('read and skipped items leave the unread collection and reminder selection without deletion', () => {
  const items = [
    { id: 'unread', read: false, url: 'https://example.com/a' },
    { id: 'read', read: true, status: '已读', url: 'https://example.com/b' },
    { id: 'skip', read: true, status: '跳过', url: 'https://example.com/c' },
    { id: 'inconsistent-skip', read: false, status: '跳过', url: 'https://example.com/d' },
    { id: 'deleted', read: false, feishuDeleted: true, url: 'https://example.com/e' },
  ];
  assert.deepEqual(items.filter(isUnread).map(i => i.id), ['unread']);
  assert.deepEqual(eligibleItems(items).map(i => i.id), ['unread']);
  assert.equal(readingStatus(items[2]), '跳过'); assert.equal(items.length, 5);
});
test('skip synchronizes the Feishu status and can be explicitly restored to unread', async () => {
  const f = fixture();
  await f.runtime.dispatch('read', { base: 'baseTest/tblTest', recordId: 'recInitial', status: '跳过' });
  assert.equal(f.records[0].fields.阅读状态, '跳过');
  const snapshot = await f.runtime.dispatch('sync'); assert.equal(snapshot.articles[0].read, true);
  assert.equal(snapshot.articles[0].status, '跳过');
  await f.runtime.dispatch('read', { base: 'baseTest/tblTest', recordId: 'recInitial', status: '待阅读' });
  assert.equal((await f.runtime.dispatch('sync')).articles[0].read, false);
  await assert.rejects(f.runtime.dispatch('read', { base: 'baseTest/tblTest', recordId: 'recInitial', status: '跳过', read: false }));
  assert.equal(f.records.length, 1);
});
