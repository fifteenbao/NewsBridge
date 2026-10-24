// Runnable reference for Feishu custom applications. No credentials at import time.
// Other environments may implement the same contract without using this adapter.
import { validateConnectorConfig } from '../connector/config.js';
import { validateFeishuOperation } from '../connector/lib/api-policy.js';
import { DiagnosticError } from '../src/lib/diagnostics.js';
import { readJsonResponse } from '../src/lib/security.js';
import { CAPTURE_FIELDS } from '../src/lib/capture-metadata.js';
import { inspectArticleFields, inspectCaptureFields } from '../connector/lib/bitable.js';

export function createAdapter({ config: input, getCredentials, fetchImpl = fetch }) {
  const config = validateConnectorConfig(input);
  if (typeof getCredentials !== 'function') throw new TypeError('Provide getCredentials().');
  async function json(url, options, stage) {
    let response;
    try { response = await fetchImpl(url, { ...options, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000) }); }
    catch { throw new DiagnosticError('API_TRANSPORT', stage); }
    let result;
    try { result = await readJsonResponse(response, 20 * 1024 * 1024); }
    catch { throw new DiagnosticError('API_RESPONSE', stage, { httpStatus: response.status }); }
    if (!response.ok || result.code !== 0) throw new DiagnosticError('API_REJECTED', stage, { providerCode: result.code, httpStatus: response.status });
    return result;
  }
  async function authorize() {
    let credentials;
    try { credentials = await getCredentials(); } catch { throw new DiagnosticError('AUTH_VERIFY', 'identity'); }
    const { appId, appSecret } = credentials || {};
    if (!/^cli_[A-Za-z0-9]+$/.test(appId || '') || typeof appSecret !== 'string' || !appSecret || /[\r\n]/.test(appSecret)) throw new DiagnosticError('AUTH_VERIFY', 'identity');
    const result = await json('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    }, 'identity');
    if (typeof result.tenant_access_token !== 'string' || !/^[A-Za-z0-9_-]+$/.test(result.tenant_access_token) || config.connectionId !== `app:${appId}`) throw new DiagnosticError('AUTH_VERIFY', 'identity');
    return { token: result.tenant_access_token, connectionId: `app:${appId}` };
  }
  return {
    capabilities: { tableRead: true, tableWrite: true, messages: true },
    async getIdentity() { return { connectionId: (await authorize()).connectionId }; },
    // Explicit operator-only schema setup; never exposed by the browser router.
    async ensureCaptureFields() {
      const { token } = await authorize();
      const path = `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.baseToken}/tables/${config.articleTableId}/fields`;
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      async function listFields() {
        const fields = [], seen = new Set(); let pageToken;
        do {
          const url = new URL(path); url.searchParams.set('page_size', '100');
          if (pageToken) url.searchParams.set('page_token', pageToken);
          const result = await json(url, { method: 'GET', headers }, 'fields');
          if (!Array.isArray(result.data?.items) || fields.length + result.data.items.length > 10000) throw new DiagnosticError('API_RESPONSE', 'fields');
          fields.push(...result.data.items);
          if (!result.data.has_more) return fields;
          pageToken = result.data.page_token;
          if (typeof pageToken !== 'string' || !pageToken || seen.has(pageToken) || seen.size >= 100) throw new DiagnosticError('API_RESPONSE', 'fields');
          seen.add(pageToken);
        } while (true);
      }
      const fields = await listFields();
      inspectArticleFields(fields); inspectCaptureFields(fields); // Type conflicts stop before any schema write.
      let created = 0;
      for (const [field_name, type] of Object.entries(CAPTURE_FIELDS)) {
        if (fields.some(field => field.field_name === field_name)) continue;
        await json(path, { method: 'POST', headers, body: JSON.stringify({ field_name, type }) }, 'fields');
        created++;
      }
      inspectCaptureFields(await listFields(), Object.keys(CAPTURE_FIELDS));
      return { ok: true, created, fields: CAPTURE_FIELDS };
    },
    async resolveWikiNode(nodeToken) {
      if (!/^[A-Za-z0-9]{1,128}$/.test(nodeToken || '')) throw new DiagnosticError('LINK_RESPONSE_INVALID', 'wiki.resolve');
      const { token } = await authorize();
      const url = new URL('https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node');
      url.searchParams.set('token', nodeToken);
      const result = await json(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } }, 'wiki.resolve');
      const node = result.data?.node;
      return { nodeToken: node?.node_token, objToken: node?.obj_token, objType: node?.obj_type };
    },
    async probeRecord(fields, created, inspect, cleaned) {
      const path = `/open-apis/bitable/v1/apps/${config.baseToken}/tables/${config.articleTableId}/records`;
      validateFeishuOperation(config, 'POST', path, { data: { fields } });
      if (!/^ReadFlow self-test [a-f0-9-]{36}$/.test(fields.标题 || '') || fields.阅读状态 !== '已读') throw new DiagnosticError('PROBE_FAILED', 'records.create');
      const { token } = await authorize();
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const result = await json('https://open.feishu.cn' + path, { method: 'POST', headers, body: JSON.stringify({ fields }) }, 'records.create');
      const id = result.data?.record?.record_id;
      if (!/^rec[A-Za-z0-9]{1,128}$/.test(id || '')) throw new DiagnosticError('PROBE_CLEANUP', 'records.create');
      let failure;
      try {
        await created(id);
        const read = await json(`https://open.feishu.cn${path}/${id}`, { method: 'GET', headers }, 'records.list');
        await inspect(read.data?.record);
      } catch (error) { failure = error; }
      try {
        const removed = await json(`https://open.feishu.cn${path}/${id}`, { method: 'DELETE', headers }, 'records.update');
        if (removed.data?.deleted !== true || removed.data?.record_id !== id) throw new Error();
      } catch (error) { throw new DiagnosticError('PROBE_CLEANUP', 'records.update', error?.diagnostic || {}); }
      await cleaned();
      if (failure) throw failure;
    },
    async request(method, path, options = {}) {
      validateFeishuOperation(config, method, path, options);
      // Credential acquisition and identity check use the same snapshot per request.
      const { token } = await authorize();
      const url = new URL(path, 'https://open.feishu.cn');
      for (const [key, value] of Object.entries(options.params || {})) url.searchParams.set(key, String(value));
      const stage = path.endsWith('/fields') ? 'fields' : path.endsWith('/messages') ? 'messages.send' : method === 'GET' ? 'records.list' : method === 'PUT' ? 'records.update' : 'records.create';
      return json(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(options.data ? { body: JSON.stringify(options.data) } : {}) }, stage);
    },
  };
}
