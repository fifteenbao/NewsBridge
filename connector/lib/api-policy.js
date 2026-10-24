import { SafeError, isSafeArticleUrl } from '../../src/lib/security.js';
import { normalizeCaptureMetadata } from '../../src/lib/capture-metadata.js';
const allowedPath = /^\/open-apis\/(bitable\/v1\/apps\/[A-Za-z0-9_-]+\/tables\/[A-Za-z0-9_-]+\/(fields|records)(\/[A-Za-z0-9_-]+)?|im\/v1\/messages)$/;

function validatePost(content) {
  if (typeof content !== 'string' || content.length > 100000) throw new SafeError('Invalid reading message.');
  let post;
  try { post = JSON.parse(content); } catch { throw new SafeError('Invalid reading message.'); }
  const locales = Object.keys(post || {});
  if (locales.length !== 1 || !['en_us', 'zh_cn'].includes(locales[0])) throw new SafeError('Invalid reading message.');
  const body = post[locales[0]];
  if (typeof body?.title !== 'string' || body.title.length > 300 || !Array.isArray(body.content) || body.content.length > 200) throw new SafeError('Invalid reading message.');
  for (const row of body.content) {
    if (!Array.isArray(row) || row.length > 3) throw new SafeError('Invalid reading message.');
    for (const part of row) {
      if (part?.tag === 'text' && typeof part.text === 'string' && part.text.length <= 1000) continue;
      if (part?.tag === 'a' && typeof part.text === 'string' && part.text.length <= 1000 && isSafeArticleUrl(part.href)) continue;
      if (part?.tag === 'at' && /^ou_[A-Za-z0-9]{1,128}$/.test(part.user_id || '')) continue;
      throw new SafeError('Invalid or unsafe reading message content.');
    }
  }
}

export function validateFeishuOperation(config, method, path, { params, data } = {}) {
  const { baseToken, articleTableId, chatId } = config;
    const validOperation = method === 'GET' && /\/(fields|records)$/.test(path) ||
      method === 'POST' && /\/(records|messages)$/.test(path) || method === 'PUT' && /\/records\/rec[A-Za-z0-9_-]+$/.test(path);
    if (!validOperation || !allowedPath.test(path)) throw new SafeError('Unsupported Feishu operation.');
    if (path.includes('/bitable/') && !path.startsWith(`/open-apis/bitable/v1/apps/${baseToken}/tables/${articleTableId}/`)) {
      throw new SafeError('The API request does not match your configured table.');
    }
    const queryKeys = path.endsWith('/messages') ? ['receive_id_type'] : method === 'GET' ? ['page_size', 'page_token'] : [];
    if (Object.keys(params || {}).some(key => !queryKeys.includes(key)) ||
        (params?.page_token !== undefined && (typeof params.page_token !== 'string' || params.page_token.length > 2048))) throw new SafeError('Unsupported API query parameters.');
    if (method === 'POST' && path.endsWith('/records') && (Object.keys(data || {}).join() !== 'fields' ||
        !data.fields || Object.keys(data.fields).some(key => !['标题', '链接', '内容', '类别', '阅读状态', '推荐指数', '笔记', '时间', '标签', '备注'].includes(key)))) {
      throw new SafeError('Only the configured reading-table fields may be created.');
    }
    if (method === 'PUT') {
      const keys = Object.keys(data?.fields || {});
      const status = keys.length === 1 && keys[0] === '阅读状态' && ['已读', '待阅读', '跳过'].includes(data.fields.阅读状态);
      const capture = keys.length > 0 && keys.every(key => ['标签', '备注'].includes(key));
      if (Object.keys(data || {}).join() !== 'fields' || !status && !capture) throw new SafeError('Only an explicit reading-status or capture-metadata update is allowed.');
    }
    if (data?.fields && (Object.hasOwn(data.fields, '标签') || Object.hasOwn(data.fields, '备注'))) {
      normalizeCaptureMetadata({ ...(Object.hasOwn(data.fields, '标签') ? { tags: data.fields.标签 } : {}), ...(Object.hasOwn(data.fields, '备注') ? { remark: data.fields.备注 } : {}) });
    }
    if (path.endsWith('/messages')) {
      if (!chatId || data?.receive_id !== chatId || data.msg_type !== 'post' || params?.receive_id_type !== 'chat_id' ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(data.uuid || '') ||
          Object.keys(data).some(key => !['receive_id', 'msg_type', 'content', 'uuid'].includes(key))) throw new SafeError('The message does not match your configured conversation.');
      validatePost(data.content);
    }
}
