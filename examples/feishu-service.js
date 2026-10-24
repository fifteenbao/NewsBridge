// Optional Feishu outputs. Never used by library health/capture or automatic export.
import { SafeError, readJsonResponse } from '../src/lib/security.js';
import { DiagnosticError } from '../src/lib/diagnostics.js';
import { inspectArticleFields, inspectCaptureFields, normalizeArticle } from '../connector/lib/bitable.js';

export function createFeishuService({ config = {}, getCredentials, fetchImpl = fetch }) {
  const target = config.export;
  if (target && (!/^[A-Za-z0-9]+$/.test(target.baseToken || '') || !/^tbl[A-Za-z0-9]+$/.test(target.articleTableId || ''))) throw new SafeError('Invalid Feishu export target.');
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
  async function list(path) {
    const records = [], seen = new Set(); let token;
    do {
      const { data } = await api('GET', path, null, 'export.list', { page_size: '100', ...(token ? { page_token: token } : {}) });
      const items = data?.items ?? (data?.has_more === false || data?.total === 0 ? [] : null);
      if (!Array.isArray(items) || records.length + items.length > 10000) throw new DiagnosticError('API_RESPONSE', 'export.list');
      records.push(...items);
      if (!data.has_more) return records;
      token = data.page_token;
      if (typeof token !== 'string' || !token || seen.has(token) || seen.size >= 100) throw new DiagnosticError('API_RESPONSE', 'export.list');
      seen.add(token);
    } while (true);
  }
  return {
    exportAvailable: !!target,
    exportUrl: target ? `https://my.feishu.cn/base/${target.baseToken}?table=${target.articleTableId}` : '',
    async send(chatId, type, content, uuid) {
      if (!chats.has(chatId) || !['post', 'interactive'].includes(type) || !/^[a-f0-9-]{36}$/.test(uuid)) throw new SafeError('Message target or request is not authorized.');
      return api('POST', '/open-apis/im/v1/messages', { receive_id: chatId, msg_type: type, content: JSON.stringify(content), uuid }, 'messages.send', { receive_id_type: 'chat_id' });
    },
    async exportArticles(articles) {
      if (!target) throw new SafeError('Configure a Feishu export destination on the service first.');
      const path = `/open-apis/bitable/v1/apps/${target.baseToken}/tables/${target.articleTableId}`;
      const fields = await list(path + '/fields');
      const schema = inspectArticleFields(fields); inspectCaptureFields(fields, ['标签', '备注']);
      const records = await list(path + '/records');
      const byUrl = new Map();
      for (const record of records) { const normalized = normalizeArticle(record); if (!normalized.url) continue;
        if (byUrl.has(normalized.url)) throw new SafeError('Duplicate URLs in the export table. Resolve duplicates before exporting.');
        byUrl.set(normalized.url, record.record_id);
      }
      let created = 0, updated = 0;
      for (const a of articles) {
        const values = { 标题: a.title, 链接: schema.fieldTypes.链接 === 1 ? a.url : { text: a.title, link: a.url }, 内容: a.content,
          类别: schema.fieldTypes.类别 === 4 ? [a.category].filter(Boolean) : a.category, 阅读状态: a.status,
          推荐指数: a.recommendation, 笔记: a.note, 时间: a.savedAt, 标签: a.tags, 备注: a.remark };
        const id = byUrl.get(a.url);
        const result = await api(id ? 'PUT' : 'POST', path + '/records' + (id ? '/' + id : ''), { fields: values }, id ? 'export.update' : 'export.create');
        const writtenId = result.data?.record?.record_id;
        if (!/^rec[A-Za-z0-9]+$/.test(writtenId || '')) throw new DiagnosticError('API_RESPONSE', 'export.write');
        byUrl.set(a.url, writtenId); if (id) updated++; else created++;
      }
      return { created, updated, total: articles.length };
    },
  };
}
