import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeArticleUrl, safeErrorMessage, readJsonResponse } from '../src/lib/security.js';
import { validateFeishuOperation } from '../src/lib/api-policy.js';
import { normalizeArticle, textOf, createKnowledgeService } from '../src/lib/bitable.js';
import { buildReadingMessage } from '../src/lib/messages.js';
import { createReadingService } from '../src/lib/notifications.js';

test('credential URLs, OAuth callbacks, unsafe schemes, and control characters never enter messages', () => {
  const bad = ['javascript:alert(1)', 'data:text/html,test', 'https://user:secret@example.com/path',
    'https://example.com/?access_token=private', 'https://example.com/?%61ccess_token=private',
    'https://example.com/#refresh_token=private', 'https://example.com/?code=private&state=abc',
    'https://example.com/?X-Amz-Signature=private', 'https://example.com/\npath',
    'http://localhost:8888/settings', 'http://127.1/private', 'http://2130706433/private',
    'http://0x7f000001/private', 'http://192.168.1.1/', 'http://10.0.0.1/', 'http://[::1]/', 'https://device.local/'];
  for (const url of bad) {
    assert.equal(isSafeArticleUrl(url), false);
    assert.throws(() => buildReadingMessage([{ title: 'Untrusted', url }]), /Unsafe/);
  }
  assert.equal(isSafeArticleUrl('https://example.com/article?q=learning#section'), true);
});

test('unknown reading states are excluded and malformed text values do not crash sync', () => {
  for (const status of ['', '勿推送', '未知状态']) {
    const record = normalizeArticle({ record_id: 'recTest', fields: { 阅读状态: status, 链接: 'https://example.com/' } });
    assert.equal(record.read, true);
  }
  assert.equal(normalizeArticle({ record_id: 'recTest', fields: { 阅读状态: '待阅读' } }).read, false);
  assert.equal(textOf([null, {}, { text: 'safe' }]), 'safe');
  assert.throws(() => normalizeArticle({ record_id: '__proto__', fields: {} }), /record ID/);
});

test('API scope guards reject other tables, recipients, fields and unsafe links', () => {
  const config = { baseToken: 'baseTest', articleTableId: 'tblTest', chatId: 'oc_test' };
  const validate = (method, path, options) => validateFeishuOperation(config, method, path, options);
  assert.throws(() => validate('GET', '/open-apis/bitable/v1/apps/baseOther/tables/tblTest/records'), /configured table/);
  assert.throws(() => validate('GET', '/open-apis/bitable/v1/apps/baseTest/tables/tblTest/records', { params: { token: 'test-secret' } }), /query/);
  assert.throws(() => validate('PUT', '/open-apis/bitable/v1/apps/baseTest/tables/tblTest/records/recTest', { data: { fields: { 笔记: 'injected' } } }), /reading-status/);
  assert.throws(() => validate('POST', '/open-apis/bitable/v1/apps/baseTest/tables/tblTest/records', { data: { fields: { 未授权字段: 'value' } } }), /fields/);
  const data = { receive_id: 'oc_other', msg_type: 'post', uuid: crypto.randomUUID(),
    content: JSON.stringify({ en_us: { title: 'Test', content: [[{ tag: 'a', text: 'Click', href: 'javascript:alert(1)' }]] } }) };
  assert.throws(() => validate('POST', '/open-apis/im/v1/messages', { params: { receive_id_type: 'chat_id' }, data }), /configured conversation/);
  data.receive_id = 'oc_test';
  assert.throws(() => validate('POST', '/open-apis/im/v1/messages', { params: { receive_id_type: 'chat_id' }, data }), /unsafe/);
});

test('unexpected errors and malformed response bodies withhold reflected credentials', async () => {
  assert.equal(safeErrorMessage(new Error('Bearer private-token')), 'The operation failed. Retry or check your connection and permissions.');
  await assert.rejects(readJsonResponse(new Response('private-reflected-token'), 5), /too large/);
  await assert.rejects(readJsonResponse(new Response('private-reflected-token')), error => !error.message.includes('private-reflected-token'));
});

test('malformed delivery receipts keep the original retry request pending', async () => {
  let journal = { version: 1, scopes: {} };
  const articles = [{ recordId: 'recTest', title: 'Test', url: 'https://example.com/', read: false }];
  const service = createReadingService({ config: { baseToken: 'baseTest', articleTableId: 'tblTest', notifications: { chatId: 'oc_test' } },
    knowledge: { sync: async () => ({ articles, bindings: [], topics: [] }) }, request: async () => ({ code: 0, data: { message_id: {} } }),
    store: { load: async () => structuredClone(journal), save: async value => { journal = structuredClone(value); } } });
  const result = await service.sync({ deliveryDate: '2026-10-13' });
  assert.match(result.notifications.error, /did not confirm/);
  assert.ok(Object.values(journal.scopes)[0].pending);
  assert.deepEqual(Object.values(journal.scopes)[0].sent, {});
});

test('unbounded pagination stops before any external write', async () => {
  let pages = 0, writes = 0;
  const service = createKnowledgeService(async method => {
    if (method !== 'GET') writes++;
    return { data: { items: [], has_more: true, page_token: `page${pages++}` } };
  });
  await assert.rejects(service.sync({ config: { baseToken: 'baseTest', articleTableId: 'tblTest' } }), /pagination/);
  assert.equal(writes, 0);
});
