import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createGoogleAdapter } from '../examples/google-adapter.js';
import { createConnector, dueDate } from '../connector/runtime.js';
import { createConnectionClient } from '../src/lib/connection.js';
import { parseTableUrl } from '../src/lib/table-url.js';
import { area } from '../test-support/chrome-mock.js';
import { collectionArchiveKey } from '../src/lib/endpoint.js';
import { disconnectCollection } from '../src/lib/storage.js';
import { writeProbe } from '../examples/write-probe.js';
const email = 'test@example-project.iam.gserviceaccount.com';
const config = { storageProvider: 'google', connectionId: 'google:' + email, baseToken: 'sheet_Test-1', articleTableId: '0', remindersEnabled: false };
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' });
function fixture(initial = [], overrides = {}) {
  const rows = structuredClone(initial), metadata = new Map(), requests = []; let onSearch, next = 1, state = { version: 1, scopes: {} };
  const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  const adapter = createGoogleAdapter({ config: overrides.config || config, messageAdapter: overrides.messageAdapter, getCredentials: () => ({ client_email: email, private_key: privateKey }), fetchImpl: async (url, options) => {
    requests.push({ url: String(url), ...options });
    if (String(url) === 'https://oauth2.googleapis.com/token') return response({ access_token: 'test_token', expires_in: 3600 });
    const body = JSON.parse(options.body);
    if (String(url).includes(':getByDataFilter')) return response({ sheets: [{ properties: { sheetId: 0, gridProperties: { rowCount: 1000 } }, data: [{ rowData: rows.map(row => ({ values: row.map(v => ({ effectiveValue: typeof v === 'number' ? { numberValue: v } : { stringValue: v } })) })) }] }] });
    if (String(url).endsWith('/developerMetadata:search')) { if (onSearch) onSearch(); return response({ matchedDeveloperMetadata: [...metadata].map(([metadataId, startIndex]) => ({ developerMetadata: { metadataId, location: { dimensionRange: { sheetId: 0, dimension: 'ROWS', startIndex, endIndex: startIndex + 1 } } } })) }); }
    if (String(url).endsWith('/values:batchGetByDataFilter')) return response({ valueRanges: body.dataFilters.map(filter => ({ dataFilters: [filter], valueRange: { values: [rows[metadata.get(filter.developerMetadataLookup.metadataId)] || []] } })) });
    if (String(url).endsWith('/values:batchUpdateByDataFilter')) {
      const d = body.data[0], row = metadata.get(d.dataFilter.developerMetadataLookup.metadataId);
      if (row === undefined) return response({ totalUpdatedRows: 0 });
      d.values[0].forEach((v, i) => { if (v !== null) rows[row][i] = v; }); return response({ totalUpdatedRows: 1 });
    }
    assert.ok(String(url).endsWith(':batchUpdate'));
    const replies = body.requests.map(op => {
      if (op.insertDimension) { rows.splice(1, 0, []); for (const [id, index] of metadata) metadata.set(id, index + 1); }
      if (op.updateCells) rows[op.updateCells.start.rowIndex] = op.updateCells.rows[0].values.map(v => v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue);
      if (op.createDeveloperMetadata) { const id = next++; metadata.set(id, op.createDeveloperMetadata.developerMetadata.location.dimensionRange.startIndex); return { createDeveloperMetadata: { developerMetadata: { metadataId: id } } }; }
      if (op.deleteDeveloperMetadata) metadata.delete(op.deleteDeveloperMetadata.dataFilter.developerMetadataLookup.metadataId);
      return {};
    }); return response({ replies });
  } });
  const store = { load: async () => structuredClone(state), save: async nextState => { state = structuredClone(nextState); } }, exclusive = async fn => fn();
  const connector = createConnector({ config: overrides.config || config, adapter, store, exclusive, ...(overrides.now ? { now: overrides.now } : {}) });
  return { adapter, connector, rows, metadata, requests, store, exclusive, setOnSearch: fn => { onSearch = fn; } };
}
test('Google setup, empty sync, literal capture, durable row identity, edits and skip round trip', async () => {
  const f = fixture();
  await f.adapter.prepare();
  assert.equal(f.rows[0].length, 8);
  assert.deepEqual((await f.connector.dispatch('sync')).articles, []);
  const input = [{ id: 'capture', title: '=IMPORTXML("unsafe")', url: 'https://example.com/article', savedAt: '2026-10-14T00:00:00Z' }];
  const first = await f.connector.dispatch('sync', { items: input });
  assert.equal(first.created, 1); assert.match(first.bindings[0].recordId, /^rec\d+$/);
  assert.equal((await f.connector.dispatch('sync', { items: input })).created, 0);
  const id = first.bindings[0].recordId;
  // Move the record and its developer metadata together, as whole-row sorting does.
  f.rows.splice(1, 0, []); f.metadata.set(Number(id.slice(3)), 2); f.rows[2][6] = 'User note';
  await f.connector.dispatch('read', { base: 'sheet_Test-1/0', recordId: id, status: '跳过' });
  assert.equal(f.rows[2][4], '跳过'); assert.equal(f.rows[2][6], 'User note');
  const result = await f.connector.dispatch('sync'); assert.equal(result.articles[0].read, true);
  const write = f.requests.find(r => r.body?.includes('IMPORTXML'));
  assert.match(write.body, /stringValue/); assert.doesNotMatch(write.body, /formulaValue/);
  await assert.rejects(f.adapter.request('GET', '/open-apis/bitable/v1/apps/other/tables/0/records'), /configured table/);
});
test('Google explicit prepare adopts imported rows; probe clears only its temporary record', async () => {
  const headers = ['标题','链接','内容','类别','阅读状态','推荐指数','笔记','时间'];
  const f = fixture([headers, ['Existing','https://example.com/existing','','待分类','待阅读',3,'Keep me', '2026-10-14T00:00:00Z']]);
  await assert.rejects(f.connector.dispatch('sync'), e => e.diagnostic?.stage === 'sync.records.list');
  await f.adapter.prepare();
  assert.equal((await f.connector.dispatch('sync')).articles.length, 1);
  await writeProbe({ ...f, config });
  assert.equal((await f.connector.dispatch('sync')).articles.length, 1); assert.equal(f.rows.find(r => r[0] === 'Existing')[6], 'Keep me');
});
test('Google share links, provider mismatch and account binding fail closed', async () => {
  assert.equal(parseTableUrl('https://docs.google.com/spreadsheets/d/sheet_Test-1/edit?usp=sharing#gid=0').base, 'sheet_Test-1/0');
  assert.equal(parseTableUrl('https://docs.google.com/spreadsheets/d/sheet/edit?gid=0#gid=0').articleTableId, '0');
  assert.throws(() => parseTableUrl('https://docs.google.com/spreadsheets/d/sheet/edit?gid=0#gid=1'));
  assert.throws(() => parseTableUrl('https://docs.google.com/spreadsheets/d/sheet/edit#gid=9999999999'));
  const f = fixture(); await f.adapter.prepare();
  await assert.rejects(f.connector.dispatch('health', { tableUrl: 'https://my.feishu.cn/base/other' }), e => e.diagnostic.code === 'TABLE_MISMATCH');
  const health = await f.connector.dispatch('health', { tableUrl: 'https://docs.google.com/spreadsheets/d/sheet_Test-1/edit#gid=0' });
  assert.equal(health.configuration.storageProvider, 'google'); assert.equal(health.resolvedTable.base, 'sheet_Test-1/0');
  const wrong = createGoogleAdapter({ config, getCredentials: () => ({ client_email: 'other@example-project.iam.gserviceaccount.com', private_key: privateKey }), fetchImpl: async () => { throw new Error('must not request'); } });
  await assert.rejects(wrong.getIdentity(), e => e.diagnostic.code === 'AUTH_VERIFY');
});
test('custom schedule persists across runtime restart and rejects impossible values before save', async () => {
  const f = fixture(); await f.adapter.prepare();
  await f.connector.dispatch('preferences', { language: 'en', reminderTime: '08:45', timeZone: 'Europe/London' });
  const runtime = createConnector({ config, adapter: f.adapter, store: f.store, exclusive: f.exclusive });
  const health = await runtime.dispatch('health'); assert.equal(health.configuration.reminderTime, '08:45'); assert.equal(health.configuration.timeZone, 'Europe/London');
  assert.equal(dueDate(Date.UTC(2026, 9, 14, 7, 44), 'Europe/London', '08:45'), null);
  assert.equal(dueDate(Date.UTC(2026, 9, 14, 7, 45), 'Europe/London', '08:45'), '2026-10-14');
  await assert.rejects(runtime.dispatch('preferences', { language: 'en', reminderTime: '24:00' }));
  await assert.rejects(runtime.dispatch('preferences', { language: 'en', timeZone: 'Invalid/Zone' }));
});
test('disconnect archives data, clears keys, switches provider and restores only matching collection', async t => {
  const before = globalThis.chrome; t.after(() => { globalThis.chrome = before; });
  const old = { connectionId: 'app:cli_Test', base: 'baseTest/tblTest' }, values = { items: [{ id: 'old', url: 'https://example.com/a' }], collectionIdentity: old, connectionEndpoint: 'https://connection.example.com/newsbridge/', connectionAccessKey: 't'.repeat(43) };
  const storage = area(values); globalThis.chrome = { storage: { local: storage } };
  await disconnectCollection(); assert.deepEqual(values.items, []); assert.equal(values.connectionAccessKey, '');
  assert.equal(values.collectionArchives[collectionArchiveKey(old, 'https://connection.example.com/newsbridge/')][0].id, 'old');
  const identity = { connectionId: config.connectionId, base: 'sheet_Test-1/0' };
  const client = createConnectionClient({ authentication: 'bearer', baseUrl: 'https://connection.example.com/newsbridge/', storage, fetchImpl: async (_url, request) => {
    assert.equal(JSON.parse(request.body).provider, 'google');
    return new Response(JSON.stringify({ ok: true, protocolVersion: 1, identity, connected: true, capabilities: { tableRead: true, tableWrite: true }, configuration: { storageProvider: 'google' } }));
  } });
  await client('health', {}, { accessKey: 't'.repeat(43), provider: 'google' }); assert.deepEqual(values.items, []);
  await disconnectCollection();
  const restore = createConnectionClient({ authentication: 'bearer', baseUrl: 'https://connection.example.com/newsbridge/', storage, fetchImpl: async () => new Response(JSON.stringify({ ok: true, protocolVersion: 1, identity: old, connected: true, capabilities: { tableRead: true, tableWrite: true } })) });
  await restore('health', {}, { accessKey: 't'.repeat(43), provider: 'feishu' }); assert.equal(values.items[0].id, 'old');
});

test('Google reminders use separately verified Feishu identity and skip read or skipped rows', async () => {
  const sends = [], messaging = { capabilities: { messages: true }, getIdentity: async () => ({ connectionId: 'app:cli_Test' }), request: async (_method, path, { data }) => {
    assert.equal(path, '/open-apis/im/v1/messages'); assert.equal(data.receive_id, 'oc_test'); sends.push(data); return { code: 0, data: { message_id: 'om_test' } };
  } };
  const input = { ...config, remindersEnabled: true, chatId: 'oc_test', messageConnectionId: 'app:cli_Test', reminderTime: '08:45' };
  const f = fixture([], { config: input, messageAdapter: messaging, now: () => Date.UTC(2026, 9, 14, 0, 45) });
  await f.adapter.prepare();
  const items = ['unread','read','skip'].map((name, i) => ({ id: name, title: name, url: 'https://example.com/' + name, savedAt: '2026-10-14T00:00:00Z', read: i !== 0, status: ['待阅读','已读','跳过'][i] }));
  await f.connector.dispatch('sync', { items }); assert.equal(sends.length, 0);
  await f.connector.daily(); assert.equal(sends.length, 1); assert.match(sends[0].content, /example.com\/unread/); assert.doesNotMatch(sends[0].content, /example.com\/(?:read|skip)/);
  await f.connector.daily(); assert.equal(sends.length, 1);
  const wrong = fixture([], { config: input, messageAdapter: { ...messaging, getIdentity: async () => ({ connectionId: 'app:cli_Other' }) } });
  await assert.rejects(wrong.adapter.getIdentity(), e => e.diagnostic.code === 'AUTH_VERIFY');
});

test('Google content is read by metadata identity when rows move between snapshot requests', async () => {
  const f = fixture(); await f.adapter.prepare();
  const items = ['first','second'].map(id => ({ id, title: id, url: 'https://example.com/' + id, savedAt: '2026-10-14T00:00:00Z' }));
  const initial = await f.connector.dispatch('sync', { items });
  let calls = 0;
  f.setOnSearch(() => {
    if (++calls !== 2) return; // Records snapshot: values read, metadata not yet returned.
    [f.rows[1], f.rows[2]] = [f.rows[2], f.rows[1]];
    for (const [id, row] of f.metadata) f.metadata.set(id, row === 1 ? 2 : 1);
    f.setOnSearch(null);
  });
  const snapshot = await f.connector.dispatch('sync');
  for (const binding of initial.bindings) assert.equal(snapshot.articles.find(a => a.recordId === binding.recordId).url, 'https://example.com/' + binding.id);
});
