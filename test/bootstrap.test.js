import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadingTable, tableFields } from '../scripts/create-table.mjs';
import { CAPTURE_FIELDS } from '../src/lib/capture-metadata.js';
import { ARTICLE_FIELDS } from '../connector/lib/bitable.js';

const config = { baseUrl: 'https://connection.example.com/readflow/', extensionId: '', stateDir: './old-state', connector: { storageProvider: 'database', language: 'en', remindersEnabled: false }, feishu: { appId: 'cli_test', export: { baseToken: 'baseExisting', articleTableId: 'tblExisting' } } };
const credentials = () => ({ appId: 'cli_test', appSecret: 'test-secret' });
function provider({ fail = '', nonempty = false } = {}) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method: options.method, path, body });
    if (path.endsWith('/internal')) return Response.json({ code: 0, tenant_access_token: 'test-token' });
    if (fail === 'table' && options.method === 'POST' && path.endsWith('/tables')) return Response.json({ code: 1254030, msg: 'private-provider-payload' });
    if (path === '/open-apis/bitable/v1/apps') return Response.json({ code: 0, data: { app: { app_token: 'baseCreated' } } });
    if (path.endsWith('/tables')) return Response.json({ code: 0, data: { table_id: 'tblCreated' } });
    if (path.endsWith('/fields')) return Response.json({ code: 0, data: { items: Object.entries({ ...ARTICLE_FIELDS, ...CAPTURE_FIELDS }).map(([field_name, type]) => ({ field_name, type })) } });
    if (path.endsWith('/records')) return Response.json({ code: 0, data: nonempty ? { items: [{ record_id: 'recUnexpected', fields: {} }] } : { total: 0, has_more: false } });
    assert.fail('Unexpected endpoint: ' + path);
  } };
}
test('one-command bootstrap creates ten fields and verifies a genuinely new zero-record table', async () => {
  const p = provider(), journal = [];
  const result = await createReadingTable({ config, newBase: true, getCredentials: credentials, fetchImpl: p.fetchImpl, onProgress: value => journal.push(value) });
  assert.equal(result.config.feishu.export.baseToken, 'baseCreated'); assert.equal(result.config.feishu.export.articleTableId, 'tblCreated');
  assert.equal(result.config.connector.remindersEnabled, false); assert.equal(result.config.stateDir, './old-state');
  assert.equal(result.emptyVerified, true); assert.equal(result.records, 0);
  const created = p.calls.find(c => c.path.endsWith('/tables'));
  assert.deepEqual(Object.fromEntries(created.body.table.fields.map(f => [f.field_name, f.type])), { ...ARTICLE_FIELDS, ...CAPTURE_FIELDS });
  assert.equal(created.body.table.fields[0].field_name, '标题');
  assert.ok(tableFields().find(f => f.field_name === '阅读状态').property.options.some(o => o.name === '跳过'));
  assert.equal(p.calls.some(c => c.path.endsWith('/records') && c.method !== 'GET'), false);
  assert.equal(journal.at(-1).stage, 'verified-empty'); assert.equal(config.feishu.export.baseToken, 'baseExisting');
});
test('bootstrap can add a fresh table to an existing base and retains recovery metadata on failure', async () => {
  const p = provider(), journal = [];
  await createReadingTable({ config, getCredentials: credentials, fetchImpl: p.fetchImpl });
  assert.equal(p.calls.some(c => c.path === '/open-apis/bitable/v1/apps'), false);
  assert.ok(p.calls.some(c => c.path === '/open-apis/bitable/v1/apps/baseExisting/tables'));
  const failed = provider({ fail: 'table' });
  await assert.rejects(createReadingTable({ config, newBase: true, getCredentials: credentials, fetchImpl: failed.fetchImpl, onProgress: value => journal.push(value) }), error => error.diagnostic.code === 'API_REJECTED' && !error.message.includes('private-provider-payload'));
  assert.equal(journal.at(-1).stage, 'table-create-requested'); assert.equal(journal.at(-1).baseToken, 'baseCreated');
});
test('bootstrap rejects mismatched app identity and unexpected records without deleting anything', async () => {
  const p = provider();
  await assert.rejects(createReadingTable({ config: { ...config, feishu: { ...config.feishu, appId: 'cli_other' } }, newBase: true, getCredentials: credentials, fetchImpl: p.fetchImpl }), /AUTH_VERIFY/);
  assert.equal(p.calls.length, 1);
  const nonempty = provider({ nonempty: true });
  await assert.rejects(createReadingTable({ config, getCredentials: credentials, fetchImpl: nonempty.fetchImpl }), /not empty/);
  assert.equal(nonempty.calls.some(c => c.method === 'DELETE'), false);
});
