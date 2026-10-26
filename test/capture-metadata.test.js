import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCaptureMetadata, metadataUpdate } from '../src/lib/capture-metadata.js';
import { validateFeishuOperation } from '../connector/lib/api-policy.js';
import { addItem } from '../src/lib/storage.js';
import { mergeKnowledge } from '../src/lib/knowledge.js';
import { createAdapter } from '../examples/adapter.js';
import { ARTICLE_FIELDS } from '../connector/lib/bitable.js';
import { fixture } from '../test-support/connector-fixture.js';
import { area } from '../test-support/chrome-mock.js';

const capture = () => ({ id: 'capture-one', url: 'https://example.com/article', title: 'Article', savedAt: '2026-10-21T00:00:00Z', read: false,
  metadataUpdate: { id: crypto.randomUUID(), fields: { tags: ['AI', 'Research'], remark: 'What evidence supports this?' } } });

test('metadata validates at the trust boundary, deduplicates normalized tags and preserves remark whitespace', () => {
  assert.deepEqual(normalizeCaptureMetadata({ tags: [' AI ', 'AI', '研究'], remark: 'First\nSecond' }), { tags: ['AI', '研究'], remark: 'First\nSecond' });
  for (const value of [{ tags: 'AI' }, { tags: [''] }, { tags: ['x'.repeat(51)] }, { tags: ['line\nbreak'] }, { remark: 'x'.repeat(2001) }, { remark: '\u0000' }, { note: 'wrong field' }, null]) assert.throws(() => normalizeCaptureMetadata(value));
  assert.throws(() => metadataUpdate({ id: 'bad', fields: { tags: ['AI'] } }));
});

test('new captures create the two columns as values and retries deduplicate without overwriting notes or reading state', async () => {
  const f = fixture({ captureMetadata: true }), item = capture();
  const first = await f.runtime.dispatch('sync', { items: [item] });
  const record = f.records.find(record => record.fields.链接?.link === item.url);
  assert.deepEqual(record.fields.标签, ['AI', 'Research']); assert.equal(record.fields.备注, item.metadataUpdate.fields.remark);
  let local = mergeKnowledge([item], first); assert.equal(local[0].metadataUpdate, undefined);
  record.fields.笔记 = 'Personal understanding'; record.fields.阅读状态 = '跳过'; record.fields.标签 = ['Changed in Feishu']; record.fields.备注 = 'Remote remark';
  const again = await f.runtime.dispatch('sync', { items: local });
  assert.equal(again.created, 0); assert.equal(f.writes.length, 1);
  local = mergeKnowledge(local, again);
  assert.deepEqual(local[0].tags, ['Changed in Feishu']); assert.equal(local[0].remark, 'Remote remark');
  assert.equal(local[0].note, 'Personal understanding'); assert.equal(local[0].status, '跳过');
  assert.ok(first.captureMetadata.tagOptions.includes('AI'));
});

test('explicit edits update existing records by URL and clearing a field does not touch unrelated columns', async () => {
  const f = fixture({ captureMetadata: true }), item = capture();
  f.records[0].fields = { 标题: 'Existing title', 链接: item.url, 标签: ['Existing'], 备注: 'Old', 笔记: 'Keep understanding', 阅读状态: '已读' };
  const result = await f.runtime.dispatch('sync', { items: [item] });
  assert.equal(result.created, 0); assert.equal(f.records.length, 1);
  assert.equal(f.records[0].fields.标题, 'Existing title'); assert.equal(f.records[0].fields.笔记, 'Keep understanding'); assert.equal(f.records[0].fields.阅读状态, '已读');
  const local = mergeKnowledge([item], result);
  const edit = { ...local[0], metadataUpdate: { id: crypto.randomUUID(), fields: { remark: '' } } };
  await f.runtime.dispatch('sync', { items: [edit] });
  assert.equal(f.records[0].fields.备注, ''); assert.deepEqual(f.records[0].fields.标签, ['AI', 'Research']);
  assert.deepEqual(f.writes.at(-1).fields, { 备注: '' });
  await f.runtime.dispatch('sync', { items: [{ ...edit, metadataUpdate: { id: crypto.randomUUID(), fields: { tags: [] } } }] });
  assert.deepEqual(f.records[0].fields.标签, []);
});

test('missing or mistyped fields fail before any write and do not lose local pending edits', async () => {
  const f = fixture(), item = capture();
  await assert.rejects(f.runtime.dispatch('sync', { items: [{ id: 'plain', url: 'https://example.com/plain', savedAt: item.savedAt }, item] }), error => {
    assert.equal(error.diagnostic.code, 'SCHEMA_INVALID');
    assert.deepEqual(error.diagnostic.fields.map(field => field.name), ['标签', '备注']); return true;
  });
  assert.equal(f.writes.length, 0); assert.ok(item.metadataUpdate);
  await f.runtime.dispatch('sync', { items: [{ id: 'plain', url: 'https://example.com/plain', savedAt: item.savedAt }] });
  assert.equal(f.writes.length, 1); // Old tables still support metadata-free capture.
  const typed = fixture({ captureMetadata: true }), request = typed.adapter.request;
  typed.adapter.request = async (...args) => {
    const result = await request(...args);
    if (args[1].endsWith('/fields')) result.data.items.find(field => field.field_name === '标签').type = 3;
    return result;
  };
  await assert.rejects(typed.runtime.dispatch('sync', { items: [item] }), error => error.diagnostic.fields[0].name === '标签' && error.diagnostic.fields[0].actual === 3);
  assert.equal(typed.writes.length, 0);
});

test('a lost create response preserves metadata and recovers the same record without a second create', async () => {
  const f = fixture({ captureMetadata: true }), item = capture(), request = f.adapter.request;
  let fail = true;
  f.adapter.request = async (...args) => {
    const result = await request(...args);
    if (fail && args[0] === 'POST' && args[1].endsWith('/records')) { fail = false; throw new Error('connection lost after commit'); }
    return result;
  };
  await assert.rejects(f.runtime.dispatch('sync', { items: [item] }));
  const recovered = await f.runtime.dispatch('sync', { items: [item] });
  assert.equal(recovered.created, 0); assert.equal(f.writes.length, 1);
  assert.deepEqual(recovered.metadataBindings, [{ id: item.id, editId: item.metadataUpdate.id }]);
  assert.deepEqual(mergeKnowledge([item], recovered)[0].tags, ['AI', 'Research']);
});

test('local offline edits persist, reopen correctly and only matching acknowledgements clear them', async t => {
  const before = globalThis.chrome; t.after(() => { globalThis.chrome = before; });
  const values = { items: [] }; globalThis.chrome = { storage: { local: area(values) } };
  const first = await addItem({ url: 'https://example.com/a', title: 'A', metadata: { tags: ['AI'], remark: 'Question' } });
  const second = await addItem({ url: first.url, title: 'A', metadata: { remark: 'New question' } });
  assert.equal(values.items.length, 1); assert.equal(first.id, second.id); assert.deepEqual(second.metadataUpdate.fields, { tags: ['AI'], remark: 'New question' });
  const snapshot = { base: 'baseTest/tblTest', bindings: [{ id: first.id, recordId: 'recOne' }], metadataBindings: [{ id: first.id, editId: first.metadataUpdate.id }],
    articles: [{ recordId: 'recOne', url: first.url, title: 'A', tags: ['Server'], remark: 'Server', read: false, topicIds: [] }], topics: [] };
  const merged = mergeKnowledge([second], snapshot)[0];
  assert.equal(merged.metadataUpdate.id, second.metadataUpdate.id); assert.deepEqual(merged.tags, ['AI']); assert.equal(merged.remark, 'New question');
});

test('metadata API permissions allow only bounded tags/remark patches, never note/title/status combinations', () => {
  const config = fixture().config, path = `/open-apis/bitable/v1/apps/${config.baseToken}/tables/${config.articleTableId}/records/recOne`;
  const call = fields => validateFeishuOperation(config, 'PUT', path, { data: { fields } });
  assert.doesNotThrow(() => call({ 标签: ['AI'], 备注: 'Review question' }));
  for (const fields of [{ 笔记: 'overwrite' }, { 标题: 'overwrite' }, { 标签: ['AI'], 阅读状态: '已读' }, { 标签: 'not an array' }, { 备注: 1 }, {}]) assert.throws(() => call(fields));
});

test('operator field setup adds only missing capture columns and is safe to run again', async () => {
  const config = { ...fixture().config, connectionId: 'app:cli_Test' };
  const fields = Object.entries(ARTICLE_FIELDS).map(([field_name, type]) => ({ field_name, type })), writes = [];
  const adapter = createAdapter({ config, getCredentials: () => ({ appId: 'cli_Test', appSecret: 'test-secret' }), fetchImpl: async (url, options) => {
    if (String(url).endsWith('/internal')) return Response.json({ code: 0, tenant_access_token: 'test-token' });
    assert.equal(new URL(url).pathname, `/open-apis/bitable/v1/apps/${config.baseToken}/tables/${config.articleTableId}/fields`);
    if (options.method === 'GET') return Response.json({ code: 0, data: { items: fields } });
    assert.equal(options.method, 'POST'); const field = JSON.parse(options.body); writes.push(field); fields.push(field);
    return Response.json({ code: 0, data: { field } });
  } });
  assert.equal((await adapter.ensureCaptureFields()).created, 2);
  assert.deepEqual(writes, [{ field_name: '标签', type: 4 }, { field_name: '备注', type: 1 }]);
  assert.equal((await adapter.ensureCaptureFields()).created, 0);
  fields.find(field => field.field_name === '标签').type = 3;
  await assert.rejects(adapter.ensureCaptureFields(), /SCHEMA_INVALID/); assert.equal(writes.length, 2);
});

test('tag counts are unrestricted while individual values remain validated', () => {
  const tags = Array.from({ length: 250 }, (_, i) => 'Tag ' + i);
  assert.deepEqual(normalizeCaptureMetadata({ tags }).tags, tags);
});
