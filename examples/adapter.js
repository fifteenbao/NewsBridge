// Runnable reference for Feishu custom applications. No credentials at import time.
// Other environments may implement the same contract without using this adapter.
import { validateConnectorConfig } from '../connector/config.js';
import { validateFeishuOperation } from '../src/lib/api-policy.js';
import { DiagnosticError } from '../src/lib/diagnostics.js';
import { readJsonResponse } from '../src/lib/security.js';

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
