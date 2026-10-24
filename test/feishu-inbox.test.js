import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { createFeishuInbox, extractArticleLinks } from '../examples/feishu-inbox.js';
import { fixture } from '../test-support/connector-fixture.js';

const credentials = { encryptKey: 'test-event-encryption', verificationToken: 'test-verification-token' };
const time = Date.UTC(2026, 9, 21, 2);
const event = () => ({ schema: '2.0', header: { event_id: 'event-1', event_type: 'im.message.receive_v1', app_id: 'cli_Test', token: credentials.verificationToken },
  event: { sender: { sender_type: 'user', sender_id: { open_id: 'ou_test' } }, message: { message_id: 'om_test', chat_id: 'oc_test', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: 'Read https://example.com/new' }) } } });
function signed(value, options = {}) {
  const iv = randomBytes(16), key = createHash('sha256').update(credentials.encryptKey).digest();
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final()]).toString('base64');
  const body = JSON.stringify({ encrypt: encrypted });
  const timestamp = String((options.time ?? time) / 1000), nonce = 'test-nonce';
  const signature = createHash('sha256').update(timestamp + nonce + credentials.encryptKey + body).digest('hex');
  return new Request('https://connection.example.com/readflow/events/feishu', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Lark-Request-Timestamp': timestamp, 'X-Lark-Request-Nonce': nonce,
    'X-Lark-Signature': options.signature ?? signature,
  }, body });
}
function setup(overrides = {}) {
  const f = fixture({ remindersEnabled: false }); f.setIdentity('app:cli_Test');
  const config = { ...f.config, connectionId: 'app:cli_Test' };
  const settings = { config, adapter: f.adapter, store: f.store, exclusive: f.exclusive,
    inboxConfig: { enabled: true, allowedChatIds: ['oc_test'], allowedOpenIds: ['ou_test'] },
    getEventCredentials: () => credentials, now: () => time, ...overrides };
  return { ...f, config, settings, inbox: createFeishuInbox(settings) };
}

test('encrypted callbacks verify challenge without a table write, and normal events require a fresh signature', async () => {
  const f = setup();
  const response = await f.inbox.handleRequest(signed({ type: 'url_verification', token: credentials.verificationToken, challenge: 'test-challenge' }));
  assert.deepEqual(await response.json(), { challenge: 'test-challenge' }); assert.equal(f.writes.length, 0);
  assert.equal((await f.inbox.handleRequest(signed(event(), { signature: '0'.repeat(64) }))).status, 401);
  assert.equal((await f.inbox.handleRequest(signed(event(), { time: time - 301000 }))).status, 401);
  const wrong = event(); wrong.header.token = 'wrong';
  assert.equal((await f.inbox.handleRequest(signed(wrong))).status, 401);
  const plaintext = new Request('https://connection.example.com/readflow/events/feishu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event()) });
  assert.equal((await f.inbox.handleRequest(plaintext)).status, 401);
  assert.equal((await f.store.load()).feishuInbox, undefined);
});

test('only allowed human direct-message senders and chats enter the durable inbox', async () => {
  const f = setup();
  for (const mutate of [
    e => { e.event.sender.sender_type = 'app'; },
    e => { e.event.sender.sender_id.open_id = 'ou_other'; },
    e => { e.event.message.chat_id = 'oc_other'; },
    e => { e.event.message.chat_type = 'group'; },
    e => { e.event.message.message_type = 'post'; },
    e => { e.header.event_type = 'other'; },
  ]) {
    const value = event(); mutate(value); assert.equal((await f.inbox.handleRequest(signed(value))).status, 200);
  }
  assert.equal((await f.store.load()).feishuInbox, undefined);
  const wrongApp = event(); wrongApp.header.app_id = 'cli_Other';
  assert.equal((await f.inbox.handleRequest(signed(wrongApp))).status, 403);
  assert.throws(() => setup({ inboxConfig: { enabled: true, allowedChatIds: [], allowedOpenIds: [] } }));
});

test('durable acknowledgement, message-id retry deduplication, URL deduplication across Chrome and Feishu, and browser status sync', async () => {
  const f = setup(); const first = event();
  assert.equal((await f.inbox.handleRequest(signed(first))).status, 200);
  assert.equal(f.writes.length, 0); // No slow provider work before acknowledgement.
  const retry = event(); retry.header.event_id = 'another-event-id';
  await f.inbox.handleRequest(signed(retry));
  assert.equal(Object.keys((await f.store.load()).feishuInbox.messages).length, 1);
  await f.create({ config: f.config }).dispatch('sync', { items: [{ id: 'chrome-id', title: 'Chrome title', url: 'https://example.com/new', savedAt: new Date(time).toISOString() }] });
  const result = await f.inbox.processPending();
  assert.deepEqual(result, { ok: true, processed: 1, created: 0 });
  const recreated = createFeishuInbox(f.settings); // Simulates restart with same durable store.
  assert.deepEqual(await recreated.processPending(), { ok: true, processed: 0, created: 0 });
  const second = event(); second.event.message.message_id = 'om_second'; second.event.message.content = JSON.stringify({ text: 'https://example.com/second' });
  await recreated.handleRequest(signed(second));
  assert.equal((await recreated.processPending()).created, 1);
  const runtime = f.create({ config: f.config });
  const snapshot = await runtime.dispatch('sync', { items: [] });
  const saved = snapshot.articles.find(a => a.url === 'https://example.com/second'); assert.equal(saved.status, '待阅读');
  await runtime.dispatch('read', { base: snapshot.base, recordId: saved.recordId, status: '跳过' });
  assert.equal((await runtime.dispatch('sync')).articles.find(a => a.recordId === saved.recordId).status, '跳过');
  assert.equal(f.sends.length, 0);
});

test('failed persistence is not acknowledged; failed provider writes stay pending; crash-after-create retries do not duplicate records', async () => {
  const f = setup(); const originalSave = f.store.save; let fail = true;
  f.store.save = async value => { if (fail) throw new Error('private payload'); return originalSave(value); };
  assert.equal((await f.inbox.handleRequest(signed(event()))).status, 503);
  fail = false; assert.equal((await f.inbox.handleRequest(signed(event()))).status, 200);
  let failProvider = true; const request = f.adapter.request;
  f.adapter.request = async (...args) => { if (failProvider) throw new Error('private provider payload'); return request(...args); };
  await assert.rejects(f.inbox.processPending());
  assert.equal(Object.values((await f.store.load()).feishuInbox.messages)[0].status, 'pending');
  failProvider = false; fail = true;
  await assert.rejects(f.inbox.processPending()); // Record created, recorded marker not persisted.
  assert.equal(f.records.filter(r => r.fields.链接?.link === 'https://example.com/new').length, 1);
  fail = false; assert.equal((await f.inbox.processPending()).created, 0);
  assert.equal(f.records.filter(r => r.fields.链接?.link === 'https://example.com/new').length, 1);
});

test('bounded safe-link extraction never fetches content; non-links and credential-bearing/local URLs are ignored', async () => {
  assert.deepEqual(extractArticleLinks('see <https://example.com/a> https://example.com/a https://example.com/b。'), ['https://example.com/a', 'https://example.com/b']);
  assert.deepEqual(extractArticleLinks('[source](https://example.com/a) https://example.com/item_(a)'), ['https://example.com/a', 'https://example.com/item_(a)']);
  assert.deepEqual(extractArticleLinks('https://127.0.0.1/ https://user:secret@example.com/ https://example.com/?token=secret https://localhost/'), []);
  assert.throws(() => extractArticleLinks(Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`).join(' ')));
  const f = setup(); const value = event(); value.event.message.content = JSON.stringify({ text: 'ordinary conversation' });
  await f.inbox.handleRequest(signed(value)); assert.equal((await f.store.load()).feishuInbox, undefined);
  const tooLarge = new Request('https://connection.example.com/readflow/events/feishu', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '65537' }, body: '{}' });
  assert.equal((await f.inbox.handleRequest(tooLarge)).status, 413);
});

test('changed destination cannot silently drain the previous inbox into another table', async () => {
  const f = setup(); await f.inbox.handleRequest(signed(event()));
  const other = createFeishuInbox({ ...f.settings, config: { ...f.config, articleTableId: 'tblOther' } });
  await assert.rejects(other.processPending(), /scope changed/); assert.equal(f.writes.length, 0);
});

test('database intake confirms only after capture; lost receipt retries keep the UUID and skip recapture', async () => {
  let captures = 0, failed = true; const receipts = [];
  const f = setup({ capture: async () => { captures++; return { created: 1 }; },
    sendReceipt: async (...args) => { receipts.push(args); if (failed) throw new Error('Unknown delivery'); } });
  await f.inbox.handleRequest(signed(event())); assert.equal(captures, 0); assert.equal(receipts.length, 0);
  await assert.rejects(f.inbox.processPending()); assert.equal(captures, 1);
  failed = false; await f.inbox.processPending();
  assert.equal(captures, 1); assert.equal(receipts.length, 2); assert.equal(receipts[0][1], receipts[1][1]);
  assert.equal(receipts[0][0], 'oc_test'); assert.equal((await f.inbox.receipts()).length, 0);
});

test('reading card callbacks require signed event, allowed sender/chat and a persisted issued-card binding', async () => {
  const applied = [];
  const f = setup({ capture: async () => ({ created: 0 }), applyAction: async (...args) => applied.push(args) });
  const state = await f.store.load(); state.scopes.cards = { target: { chatId: 'oc_test' }, cards: { om_card: { requestId: 'request1', recordIds: ['recItem'] } } }; await f.store.save(state);
  const card = () => ({ schema: '2.0', header: { ...event().header, event_type: 'card.action.trigger' }, event: {
    operator: { open_id: 'ou_test' }, context: { open_chat_id: 'oc_test', open_message_id: 'om_card' },
    action: { value: { action: 'read', recordId: 'recItem', requestId: 'request1' } },
  } });
  assert.equal((await f.inbox.handleRequest(signed(card()))).status, 200); assert.equal(applied.length, 1);
  const wrongUser = card(); wrongUser.event.operator.open_id = 'ou_other'; assert.equal((await f.inbox.handleRequest(signed(wrongUser))).status, 403);
  const wrongRecord = card(); wrongRecord.event.action.value.recordId = 'recOther'; assert.equal((await f.inbox.handleRequest(signed(wrongRecord))).status, 503);
  const wrongMessage = card(); wrongMessage.event.context.open_message_id = 'om_other'; assert.equal((await f.inbox.handleRequest(signed(wrongMessage))).status, 503);
  assert.equal(applied.length, 1);
});
