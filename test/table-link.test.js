import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTableUrl } from '../src/lib/table-url.js';
import { createHttpHandler } from '../connector/http.js';
import { createConnectionClient } from '../src/lib/connection.js';
import { createAdapter } from '../examples/adapter.js';
import { fixture } from '../test-support/connector-fixture.js';
import { area } from '../test-support/chrome-mock.js';

// Deliberately use fictional tokens; personal share links never enter fixtures.
const baseLink = 'https://my.feishu.cn/base/baseTest?from=from_copylink';
const wikiLink = 'https://my.feishu.cn/wiki/wikiTest?from=from_copylink';

test('normal share links parse without table= and strip copy/view parameters', () => {
  const base = parseTableUrl(baseLink), wiki = parseTableUrl(wikiLink);
  assert.equal(base.baseToken, 'baseTest'); assert.equal(base.articleTableId, null);
  assert.equal(base.url, 'https://my.feishu.cn/base/baseTest');
  assert.equal(wiki.kind, 'wiki'); assert.equal(wiki.nodeToken, 'wikiTest'); assert.equal(wiki.baseToken, null);
  assert.equal(wiki.url, 'https://my.feishu.cn/wiki/wikiTest');
  assert.equal(parseTableUrl(wikiLink + '&table=tblTest').articleTableId, 'tblTest');
  for (const url of ['https://my.feishu.cn/base/baseTest?table=', 'https://my.feishu.cn/wiki/wikiTest?table=bad', 'https://my.feishu.cn/wiki/wikiTest?table=tblTest&table=tblOther', 'https://docs.google.com/spreadsheets/d/example/edit#gid=0', 'https://my.feishu.cn/docx/docTest', 'https://my.feishu.cn/wiki/wikiTest/more']) assert.throws(() => parseTableUrl(url));
});
test('base-only share link selects the configured table only within its matching base', async () => {
  const f = fixture(), health = await f.runtime.dispatch('health', { tableUrl: baseLink });
  assert.equal(health.resolvedTable.base, 'baseTest/tblTest'); assert.equal(health.resolvedTable.source, 'configured-table');
  await f.runtime.dispatch('preferences', { language: 'en', tableUrl: baseLink });
  for (const link of ['https://my.feishu.cn/base/baseOther', 'https://my.feishu.cn/base/baseTest?table=tblOther']) {
    await assert.rejects(f.runtime.dispatch('preferences', { language: 'zh', tableUrl: link }), /TABLE_MISMATCH/);
  }
  assert.equal((await f.store.load()).preferences.language, 'en'); assert.equal(f.writes.length, 0);
});
test('wiki resolver must verify node and object type, matching base and optional table, before saving', async () => {
  const f = fixture(); let calls = 0;
  let node = { nodeToken: 'wikiTest', objType: 'bitable', objToken: 'baseTest' };
  const runtime = f.create({ adapter: { ...f.adapter, resolveWikiNode: async token => { calls++; assert.equal(token, 'wikiTest'); return node; } } });
  const health = await runtime.dispatch('health', { tableUrl: wikiLink });
  assert.equal(health.resolvedTable.source, 'wiki-node'); assert.equal(health.resolvedTable.base, 'baseTest/tblTest');
  await runtime.dispatch('preferences', { language: 'zh', tableUrl: wikiLink });
  assert.equal(calls, 2); assert.equal((await f.store.load()).preferences.language, 'zh');
  node = { ...node, objType: 'docx' }; await assert.rejects(runtime.dispatch('health', { tableUrl: wikiLink }), /LINK_NOT_BITABLE/);
  node = { ...node, objType: 'bitable', objToken: 'baseOther' }; await assert.rejects(runtime.dispatch('preferences', { language: 'en', tableUrl: wikiLink }), /TABLE_MISMATCH/);
  node = { ...node, objToken: 'baseTest', nodeToken: 'wikiOther' }; await assert.rejects(runtime.dispatch('health', { tableUrl: wikiLink }), /LINK_RESPONSE_INVALID/);
  node = { ...node, nodeToken: 'wikiTest' }; await assert.rejects(runtime.dispatch('health', { tableUrl: wikiLink + '&table=tblOther' }), /TABLE_MISMATCH/);
  assert.equal((await f.store.load()).preferences.language, 'zh'); assert.equal(f.writes.length, 0); assert.equal(f.sends.length, 0);
});
test('missing resolver and wiki access errors provide specific safe diagnostics', async () => {
  const f = fixture(); await assert.rejects(f.runtime.dispatch('health', { tableUrl: wikiLink }), /LINK_RESOLVER_UNAVAILABLE/);
  const runtime = f.create({ adapter: { ...f.adapter, resolveWikiNode: async () => {
    throw Object.assign(new Error('private-provider-payload'), { diagnostic: { code: 'API_REJECTED', stage: 'wiki.resolve', providerCode: 131006, httpStatus: 403 } });
  } } });
  await assert.rejects(runtime.dispatch('health', { tableUrl: wikiLink }), error => {
    assert.equal(error.diagnostic.stage, 'health.wiki.resolve'); assert.equal(error.diagnostic.providerCode, 131006);
    assert.doesNotMatch(error.message, /private-provider-payload/); return true;
  });
});
test('authenticated browser round trip resolves share links and rejects inconsistent resolver responses', async () => {
  const f = fixture(), runtime = f.create({ adapter: { ...f.adapter, resolveWikiNode: async token => ({ nodeToken: token, objType: 'bitable', objToken: 'baseTest' }) } });
  const baseUrl = 'https://connection.example.com/readflow/', local = { connectionAccessKey: 't'.repeat(43) };
  const handle = createHttpHandler({ baseUrl, connector: runtime, authenticate: async () => true });
  const call = createConnectionClient({ authentication: 'bearer', baseUrl, storage: area(local), fetchImpl: (url, options) => handle(new Request(url, options)) });
  for (const tableUrl of [baseLink, wikiLink]) assert.equal((await call('health', { tableUrl })).resolvedTable.base, 'baseTest/tblTest');
  const bad = createConnectionClient({ authentication: 'bearer', baseUrl, storage: area(local), fetchImpl: async () => Response.json({ ok: true, protocolVersion: 1, identity: { connectionId: 'test-user', base: 'baseTest/tblTest' }, connected: true, configuration: { storageProvider: 'feishu' }, capabilities: { tableRead: true, tableWrite: true }, resolvedTable: { url: parseTableUrl(wikiLink).url, base: 'baseOther/tblOther', baseToken: 'baseOther', articleTableId: 'tblOther', source: 'wiki-node' } }) });
  await assert.rejects(bad('health', { tableUrl: wikiLink }), /LINK_RESPONSE_INVALID/);
});
test('reference adapter uses the fixed read-only get_node endpoint and current app authorization', async () => {
  const f = fixture(), calls = [];
  const adapter = createAdapter({ config: { ...f.config, connectionId: 'app:cli_test' }, getCredentials: () => ({ appId: 'cli_test', appSecret: 'test-secret' }), fetchImpl: async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    if (String(url).endsWith('/internal')) return Response.json({ code: 0, tenant_access_token: 'test-token' });
    const target = new URL(url); assert.equal(target.origin, 'https://open.feishu.cn'); assert.equal(target.pathname, '/open-apis/wiki/v2/spaces/get_node');
    assert.equal(target.searchParams.get('token'), 'wikiTest'); assert.equal(target.searchParams.size, 1); assert.equal(options.method, 'GET');
    return Response.json({ code: 0, data: { node: { node_token: 'wikiTest', obj_type: 'bitable', obj_token: 'baseTest', title: 'private-title' } } });
  } });
  assert.deepEqual(await adapter.resolveWikiNode('wikiTest'), { nodeToken: 'wikiTest', objType: 'bitable', objToken: 'baseTest' });
  await assert.rejects(adapter.resolveWikiNode('https://untrusted.example.com/wiki/node'), /LINK_RESPONSE_INVALID/);
  assert.equal(calls.length, 2);
});
