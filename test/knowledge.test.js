import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeService, ARTICLE_FIELDS, LEGACY_ARTICLE_FIELDS, TOPIC_FIELDS, normalizeArticle } from '../connector/lib/bitable.js';
import { mergeKnowledge } from '../src/lib/knowledge.js';
import { eligibleItems } from '../connector/lib/batch.js';
import { buildReadingMessage } from '../connector/lib/messages.js';

const config = { baseToken: 'base123', articleTableId: 'tblArticles', topicTableId: 'tblTopics' };
const capture = { id: 'local1', title: 'Article', url: 'https://example.com/a', savedAt: '2026-10-12T01:00:00Z', read: false };
function fixture(initial = [], fieldsSchema = LEGACY_ARTICLE_FIELDS) {
  const records = structuredClone(initial), calls = [];
  let failCreate = false;
  const request = async (method, path, { data = {}, params = {} } = {}) => {
    calls.push({ method, path, data, params });
    const isArticle = path.includes('tblArticles');
    if (path.endsWith('/fields')) return { data: { items: Object.entries(isArticle ? fieldsSchema : TOPIC_FIELDS).map(([field_name, type]) =>
      ({ field_name, type, property: type === 18 ? { table_id: config.topicTableId } : {} })) } };
    if (method === 'POST') {
      const record = { record_id: `rec${records.length + 1}`, fields: data.fields };
      records.push(record);
      if (failCreate) { failCreate = false; throw new Error('connection lost after server committed'); }
      return { data: { record } };
    }
    // Force two pages to catch false duplicates on later pages.
    if (isArticle && records.length > 1 && !params.page_token) return { data: { items: records.slice(0, 1), has_more: true, page_token: 'next' } };
    return { data: { items: isArticle ? (params.page_token ? records.slice(1) : records) : [
      { record_id: 'recTopic', fields: { 主题: '学习方法', 核心问题: '如何形成知识？', 阶段结论: '主动回顾', 下一步: '尝试一次' } },
    ] } };
  };
  return { service: createKnowledgeService(request), records, calls, loseNextResponse: () => { failCreate = true; } };
}

test('new capture creates once; retries preserve Feishu edits and match all pages', async () => {
  const f = fixture([{ record_id: 'recOld', fields: { 收藏ID: 'old' } }]);
  const first = await f.service.sync({ config, items: [capture] });
  assert.equal(first.created, 1);
  f.records[1].fields.我的理解 = '我的笔记';
  f.records[1].fields.阅读状态 = '已沉淀';
  const again = await f.service.sync({ config, items: [capture] });
  assert.equal(again.created, 0);
  assert.equal(again.articles[1].note, '我的笔记');
  assert.equal(again.articles[1].read, true);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
});

test('lost create response is recovered by capture ID without duplicate writes', async () => {
  const f = fixture(); f.loseNextResponse();
  await assert.rejects(f.service.sync({ config, items: [capture] }), /connection lost/);
  assert.equal((await f.service.sync({ config, items: [capture] })).created, 0);
  assert.equal(f.records.length, 1);
});

test('parallel sync calls are serialized and URL deduplication works', async () => {
  const f = fixture();
  await Promise.all([f.service.sync({ config, items: [capture] }), f.service.sync({ config, items: [{ ...capture, id: 'other' }] })]);
  assert.equal(f.records.length, 1);
});

test('records deleted in Feishu are not resurrected or notified', async () => {
  const f = fixture();
  const items = [{ ...capture, feishuRecordId: 'recGone', feishuBase: 'base123/tblArticles' }];
  const result = { ...await f.service.sync({ config, items }), base: 'base123/tblArticles' };
  assert.equal(result.created, 0);
  assert.equal(eligibleItems(mergeKnowledge(items, result)).length, 0);
});

test('schema/config/capture errors fail before writes', async () => {
  const f = fixture();
  await assert.rejects(f.service.sync({ config: { ...config, baseToken: '../x' }, items: [capture] }));
  await assert.rejects(f.service.sync({ config, items: [{ ...capture, url: 'javascript:alert(1)' }] }));
  const service = createKnowledgeService(async () => ({ data: { items: [] } }));
  await assert.rejects(service.sync({ config, items: [capture] }), /字段/);
  assert.equal(f.calls.length, 0);
});

test('invalid pagination stops without writing from a partial snapshot', async () => {
  let writes = 0;
  const service = createKnowledgeService(async method => {
    if (method === 'POST') writes++;
    return { data: { items: [], has_more: true, page_token: 'same' } };
  });
  await assert.rejects(service.sync({ config, items: [capture] }), /分页/);
  assert.equal(writes, 0);
});

test('rich text notes survive sync and appear in the message', () => {
  const article = normalizeArticle({ record_id: 'recA', fields: {
    标题: [{ text: '测试' }], 阅读状态: '已读', 主题: [{ record_ids: ['recTopic'] }], 我的理解: [{ text: '结论' }],
  } });
  const [merged] = mergeKnowledge([capture], { base: 'base123/tblArticles', bindings: [{ id: capture.id, recordId: 'recA' }],
    articles: [article], topics: [{ id: 'recTopic', name: '学习', question: '怎样回顾？', synthesis: '关联材料', next: '实践' }] });
  assert.equal(merged.read, true);
  assert.equal(eligibleItems([merged]).length, 0);
  const message = JSON.stringify(buildReadingMessage([{ ...merged, url: 'https://example.com/a' }], 'zh'));
  assert.match(message, /笔记: 结论/);
});

test('Feishu-only linked articles enter the local list once; text notes stay in Feishu', () => {
  const result = { base: 'base123/tblArticles', bindings: [], topics: [], articles: [
    { recordId: 'recRemote', title: '手机收藏', url: 'https://example.com/remote', read: false, topicIds: [], savedAt: 1791766800000 },
    { recordId: 'recNote', title: '纯笔记', url: '', read: false, topicIds: [] },
  ] };
  const first = mergeKnowledge([], result);
  assert.equal(first.length, 1);
  assert.equal(eligibleItems(first).length, 1);
  const repeated = mergeKnowledge(first, { ...result, bindings: [{ id: first[0].id, recordId: 'recRemote' }] });
  assert.equal(repeated.length, 1);
});

test('eight-column tables work without topics or capture IDs and preserve Feishu notes', async () => {
  const f = fixture([], ARTICLE_FIELDS);
  const single = { baseToken: 'base123', articleTableId: 'tblArticles', schema: 'briefing' };
  await f.service.sync({ config: single, items: [capture] });
  assert.equal('收藏ID' in f.records[0].fields, false);
  f.records[0].fields.内容 = 'Updated summary';
  f.records[0].fields.笔记 = 'My analysis';
  f.records[0].fields.推荐指数 = 5;
  f.records[0].fields.阅读状态 = '已沉淀';
  const again = await f.service.sync({ config: single, items: [capture] });
  assert.equal(again.created, 0);
  assert.equal(again.articles[0].content, 'Updated summary');
  assert.equal(again.articles[0].note, 'My analysis');
  assert.equal(again.articles[0].recommendation, 5);
  assert.equal(again.articles[0].read, true);
  assert.deepEqual(again.topics, []);
  assert.ok(f.calls.every(call => !call.path.includes('tblTopics')));
});

test('text links and multi-select categories use the correct Feishu field types', async () => {
  const f = fixture([], { ...ARTICLE_FIELDS, 链接: 1, 类别: 4 });
  const result = await f.service.sync({ config: { baseToken: 'base123', articleTableId: 'tblArticles' }, items: [capture] });
  assert.equal(f.records[0].fields.链接, capture.url);
  assert.deepEqual(f.records[0].fields.类别, ['待分类']);
  assert.equal(result.articles[0].url, capture.url);
});

test('linked records follow edited URLs and removed links stop eligibility', async () => {
  const f = fixture([{ record_id: 'recLinked', fields: { 标题: 'Edited', 链接: { link: 'https://example.com/new' }, 阅读状态: '待阅读' } }], ARTICLE_FIELDS);
  const linked = { ...capture, feishuRecordId: 'recLinked', feishuBase: 'base123/tblArticles' };
  const single = { baseToken: 'base123', articleTableId: 'tblArticles' };
  const result = { ...await f.service.sync({ config: single, items: [linked] }), base: linked.feishuBase };
  assert.equal(result.created, 0);
  assert.equal(mergeKnowledge([linked], result)[0].url, 'https://example.com/new');
  f.records[0].fields.链接 = null;
  const removed = { ...await f.service.sync({ config: single, items: [linked] }), base: linked.feishuBase };
  assert.equal(removed.created, 0);
  assert.equal(eligibleItems(mergeKnowledge([linked], removed)).length, 0);
  const next = await f.service.sync({ config: single, items: mergeKnowledge([linked], removed) });
  assert.equal(next.created, 0);
  assert.equal(next.articles[0].url, '');
});

test('notification receipt and read state are independent after sync', () => {
  const record = normalizeArticle({ record_id: 'recA', fields: { 标题: 'A', 链接: { link: capture.url }, 阅读状态: '待阅读' } });
  const [merged] = mergeKnowledge([capture], { base: 'base123/tblArticles', bindings: [{ id: capture.id, recordId: record.recordId }],
    articles: [record], topics: [], notifications: { sent: { recA: '2026-10-12T10:00:00Z' } } });
  assert.equal(merged.read, false);
  assert.ok(merged.notifiedAt);
  assert.equal(eligibleItems([merged]).length, 0);
});

test('database read timestamps survive snapshot merge and explicit clearing', () => {
  const source = { recordId: 'recTime', title: 'Read timestamp', url: capture.url, read: true, status: '已读', readAt: 1791766800000, savedAt: 1791700000000, topicIds: [] };
  const response = { base: 'db/library', bindings: [{ id: capture.id, recordId: source.recordId }], topics: [], articles: [source] };
  assert.equal(mergeKnowledge([capture], response)[0].readAt, source.readAt);
  assert.equal(mergeKnowledge([], response)[0].readAt, source.readAt);
  const cleared = mergeKnowledge([{ ...capture, readAt: source.readAt }], { ...response, articles: [{ ...source, readAt: null, status: '待阅读', read: false }] });
  assert.equal(cleared[0].readAt, null);
});
