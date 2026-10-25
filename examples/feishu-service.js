// Optional Feishu messages only. No table or model API operations.
import { SafeError, readJsonResponse } from '../src/lib/security.js';
import { DiagnosticError } from '../src/lib/diagnostics.js';

export function createFeishuService({ config = {}, getCredentials, fetchImpl = fetch }) {
  const chats = new Set([config.chatId, ...(config.allowedChatIds || [])].filter(Boolean));
  if ([...chats].some(id => !/^oc_[A-Za-z0-9]+$/.test(id))) throw new SafeError('Invalid Feishu conversation.');
  async function json(url, options, stage) {
    let response;
    try { response = await fetchImpl(url, { ...options, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000) }); }
    catch { throw new DiagnosticError('API_TRANSPORT', stage); }
    const data = await readJsonResponse(response, 20 * 1024 * 1024);
    if (!response.ok || data.code !== 0) throw new DiagnosticError('API_REJECTED', stage, { httpStatus: response.status, providerCode: data.code });
    return data;
  }
  async function api(method, path, data, stage, params = {}) {
    const credentials = await getCredentials();
    if (!/^cli_[A-Za-z0-9]+$/.test(config.appId || '') || credentials?.appId !== config.appId || typeof credentials.appSecret !== 'string' || !credentials.appSecret) throw new DiagnosticError('AUTH_VERIFY', 'identity');
    const auth = await json('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: credentials.appId, app_secret: credentials.appSecret }) }, 'identity');
    if (!/^[A-Za-z0-9_-]+$/.test(auth.tenant_access_token || '')) throw new DiagnosticError('AUTH_VERIFY', 'identity');
    const url = new URL('https://open.feishu.cn' + path);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return json(url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.tenant_access_token}` }, ...(data ? { body: JSON.stringify(data) } : {}) }, stage);
  }
  return {
    async send(chatId, type, content, uuid) {
      if (!chats.has(chatId) || !['post', 'interactive'].includes(type) || !/^[a-f0-9-]{36}$/.test(uuid)) throw new SafeError('Message target or request is not authorized.');
      return api('POST', '/open-apis/im/v1/messages', { receive_id: chatId, msg_type: type, content: JSON.stringify(content), uuid }, 'messages.send', { receive_id_type: 'chat_id' });
    },
  };
}
