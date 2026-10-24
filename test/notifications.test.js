import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadingService } from '../connector/lib/notifications.js';
import { buildReadingMessage } from '../connector/lib/messages.js';

const today = { deliveryDate: '2026-10-12' };
const config = { baseToken: 'base123', articleTableId: 'tblArticles', schema: 'briefing',
  connectionId: 'test-user', notifications: { chatId: 'oc_reading123', mentionOpenId: 'ou_reader123' } };
const article = index => ({ recordId: `rec${index}`, title: `Article ${index}`, url: `https://example.com/${index}`,
  savedAt: Date.UTC(2026, 0, index + 1), read: false, topicIds: [], content: 'A summary', note: 'A personal note' });
function fixture(count, { snapshots, stateStore, clock } = {}) {
  const articles = Array.from({ length: count }, (_, i) => article(i));
  let state = { version: 1, scopes: {} }, reads = 0, fail = false;
  const sent = [];
  const store = stateStore || { load: async () => structuredClone(state), save: async value => { state = structuredClone(value); } };
  const knowledge = { sync: async () => ({ created: 0, bindings: [], topics: [],
    articles: structuredClone(snapshots?.[Math.min(reads++, snapshots.length - 1)] || articles) }) };
  const request = async (method, path, { data, params }) => {
    sent.push({ method, path, data, params });
    if (fail) { fail = false; throw new Error('Network response lost'); }
    return { data: { message_id: `om_${sent.length}` } };
  };
  const create = () => createReadingService({ config, knowledge, store, request, ...(clock ? { now: clock } : {}) });
  return { service: create(), create, sent, articles, getState: () => state, failNext: () => { fail = true; } };
}

test('one or four unread items send at the scheduled run without marking read', async () => {
  assert.equal((await fixture(1).service.sync(today)).notifications.deliveries.length, 1);
  assert.equal((await fixture(4).service.sync(today)).notifications.deliveries.length, 1);
  const f = fixture(5);
  const result = await f.service.sync(today);
  assert.equal(result.notifications.deliveries.length, 1);
  assert.equal(f.sent[0].data.receive_id, config.notifications.chatId);
  assert.equal(f.sent[0].path, '/open-apis/im/v1/messages');
  assert.deepEqual(f.sent[0].params, { receive_id_type: 'chat_id' });
  assert.equal(f.sent[0].data.msg_type, 'post');
  const post = JSON.parse(f.sent[0].data.content);
  assert.equal(post.en_us.content[0][0].user_id, 'ou_reader123');
  assert.match(JSON.stringify(post), /A personal note/);
  assert.equal(result.articles.every(a => !a.read), true);
  await f.service.sync(today);
  assert.equal(f.sent.length, 1);
});

test('large daily reminders split into messages including the remainder without duplicates', async () => {
  const f = fixture(21);
  const results = await Promise.all([f.service.sync(today), f.service.sync(today)]);
  assert.equal(f.sent.length, 2);
  assert.equal(results[0].notifications.deliveries.length, 2);
  assert.equal(results[1].notifications.deliveries.length, 0);
  const urls = f.sent.flatMap(s => JSON.parse(s.data.content).en_us.content.flatMap(row => row.filter(e => e.tag === 'a').map(e => e.href)));
  assert.equal(new Set(urls).size, 21);
});

test('fresh Feishu status and deleted links are checked immediately before sending', async () => {
  const initial = Array.from({ length: 5 }, (_, i) => article(i));
  const updated = initial.map((a, i) => i === 0 ? { ...a, read: true } : a);
  const f = fixture(5, { snapshots: [initial, updated] });
  await f.service.sync(today);
  assert.equal(f.sent.length, 1);
  assert.equal(JSON.stringify(f.sent[0].data).includes('https://example.com/0'), false);
  const noLink = initial.map((a, i) => i === 0 ? { ...a, url: '' } : a);
  const g = fixture(5, { snapshots: [initial, noLink] });
  await g.service.sync(today);
  assert.equal(g.sent.length, 1);
  assert.equal(JSON.stringify(g.sent[0].data).includes('https://example.com/0'), false);
});

test('failed sends preserve pending batch and retry UUID across service restart', async () => {
  const f = fixture(5); f.failNext();
  const failed = await f.service.sync(today);
  assert.match(failed.notifications.error, /operation failed/);
  assert.deepEqual(failed.notifications.sent, {});
  const uuid = f.sent[0].data.uuid;
  const recovered = await f.create().sync(today);
  assert.equal(f.sent[1].data.uuid, uuid);
  assert.equal(recovered.notifications.deliveries.length, 1);
  assert.equal(Object.keys(recovered.notifications.sent).length, 5);
});

test('uncertain send beyond Feishu deduplication window pauses automatic retries', async () => {
  let time = Date.UTC(2026, 9, 12);
  const f = fixture(5, { clock: () => time }); f.failNext();
  await f.service.sync(today); time += 60 * 60 * 1000;
  const retry = await f.create().sync(today);
  assert.match(retry.notifications.error, /one hour/);
  assert.equal(f.sent.length, 1);
});

test('status change on an uncertain batch does not send stale material', async () => {
  const f = fixture(5); f.failNext(); await f.service.sync(today);
  f.articles[0].read = true;
  const result = await f.service.sync(today);
  assert.match(result.notifications.error, /changed status/);
  assert.equal(f.sent.length, 1);
});

test('changed URLs on an uncertain batch pause its immutable retry', async () => {
  const f = fixture(5); f.failNext(); await f.service.sync(today);
  f.articles[0].url = 'https://example.com/replacement';
  const result = await f.service.sync(today);
  assert.match(result.notifications.error, /changed status or links/);
  assert.equal(f.sent.length, 1);
});

test('missing target is sync-only, invalid targets fail without sending', async () => {
  const knowledge = { sync: async () => ({ articles: [], topics: [], bindings: [] }) };
  const fail = async () => { throw new Error('should never send'); };
  const store = { load: fail, save: fail };
  const syncOnly = createReadingService({ config: { ...config, notifications: undefined }, knowledge, store, request: fail });
  assert.equal((await syncOnly.sync()).notifications.configured, false);
  const invalid = createReadingService({ config: { ...config, notifications: { chatId: 'not-a-session' } }, knowledge, store, request: fail });
  assert.match((await invalid.sync()).notifications.error, /chat_id/);
});

test('language and message content stay bounded; links are structured data', () => {
  const post = buildReadingMessage([{ ...article(0), content: 'a'.repeat(4000), note: 'b'.repeat(4000) }], 'zh');
  assert.match(post.zh_cn.title, /1 条/);
  assert.equal(post.zh_cn.content[0][1].tag, 'a');
  assert.ok(JSON.stringify(post).length < 1500);
});


test('manual sync never sends; still-unread items are reminded again the following day', async () => {
  const f = fixture(3);
  await f.service.sync();
  assert.equal(f.sent.length, 0);
  await f.service.sync(today);
  await f.create().sync(today);
  assert.equal(f.sent.length, 1);
  f.articles[0].read = true;
  await f.create().sync({ deliveryDate: '2026-10-13' });
  assert.equal(f.sent.length, 2);
  const post = JSON.parse(f.sent[1].data.content);
  const links = post.en_us.content.flatMap(row => row.filter(entry => entry.tag === 'a').map(entry => entry.href));
  assert.deepEqual(links, ['https://example.com/1', 'https://example.com/2']);
});

test('an empty daily run sends nothing and late additions wait until tomorrow', async () => {
  const f = fixture(0);
  await f.service.sync(today);
  f.articles.push(article(0));
  await f.create().sync(today);
  assert.equal(f.sent.length, 0);
  await f.create().sync({ deliveryDate: '2026-10-13' });
  assert.equal(f.sent.length, 1);
});

test('earlier uncertain deliveries block a new day rather than abandoning their UUID', async () => {
  const f = fixture(1); f.failNext(); await f.service.sync(today);
  const pending = Object.values(f.getState().scopes)[0].pending;
  const result = await f.create().sync({ deliveryDate: '2026-10-13' });
  assert.match(result.notifications.error, /earlier schedule/);
  assert.equal(f.sent.length, 1);
  assert.equal(Object.values(f.getState().scopes)[0].pending.id, pending.id);
});
