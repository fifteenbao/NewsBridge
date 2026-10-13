import { SafeError } from '../src/lib/security.js';
import { createKnowledgeService } from '../src/lib/bitable.js';
import { createReadingService } from '../src/lib/notifications.js';
import { validateFeishuOperation } from '../src/lib/api-policy.js';
import { createCliClient } from './cli.js';

const scopeKey = config => JSON.stringify([config.appId, config.accountId, config.baseToken, config.articleTableId, config.chatId || undefined]);
const recordId = id => /^rec[A-Za-z0-9]{1,128}$/.test(id);
function validateReceipts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 10000 ||
      Object.entries(value).some(([id, at]) => !recordId(id) || typeof at !== 'string' || !Number.isFinite(Date.parse(at)))) throw new SafeError('Invalid delivery receipts.');
}
function validateScope(scope, config) {
  validateReceipts(scope.sent);
  if (scope.daily) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scope.daily.date || '') || typeof scope.daily.complete !== 'boolean') throw new SafeError('Invalid daily delivery state.');
    validateReceipts(scope.daily.sent);
  }
  if (scope.pending) {
    const pending = scope.pending;
    if (!Array.isArray(pending.recordIds) || pending.recordIds.length < 1 || pending.recordIds.length > 20 ||
        pending.recordIds.some(id => !recordId(id)) || new Set(pending.recordIds).size !== pending.recordIds.length ||
        !Number.isFinite(pending.createdAt)) throw new SafeError('Invalid pending delivery.');
    validateFeishuOperation(config, 'POST', '/open-apis/im/v1/messages', { params: { receive_id_type: 'chat_id' }, data: {
      receive_id: config.chatId, msg_type: 'post', uuid: pending.id, content: pending.content,
    } });
  }
}
export function createHelperBridge({ config, run, store, now = () => Date.now() }) {
  const client = createCliClient(config, run);
  const key = scopeKey(config);
  const reading = createReadingService({ knowledge: createKnowledgeService(client.request), config, request: client.request, store, now });
  return async (action, payload = {}) => {
    if (!['health', 'sync', 'read', 'pending', 'resolve'].includes(action)) throw new SafeError('Unsupported local operation.');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new SafeError('Invalid helper request.');
    if (payload.expectedIdentity && (payload.expectedIdentity.appId !== config.appId || payload.expectedIdentity.openId !== config.accountId)) {
      throw new SafeError('The helper account/app differs from this collection. Use a separate Chrome profile rather than transferring cached reading data.');
    }
    await client.verifyIdentity();
    if (action === 'health') return { ok: true, connected: true, configuration: {
      baseToken: config.baseToken, articleTableId: config.articleTableId, chatId: config.chatId,
    } };
    const state = await store.load();
    if (state.scopes[key]) validateScope(state.scopes[key], config);
    if (action === 'pending') return { ok: true, pending: state.scopes[key]?.pending || null };
    if (action === 'resolve') {
      const scope = state.scopes[key];
      if (!['sent', 'not-sent'].includes(payload.outcome) || !scope?.pending || scope.pending.id !== payload.uuid) throw new SafeError('The pending request changed. Refresh before resolving it.');
      if (payload.outcome === 'sent') {
        const stamp = new Date(now()).toISOString();
        scope.pending.recordIds.forEach(id => {
          scope.sent[id] = stamp;
          if (scope.daily && scope.daily.date === scope.pending.deliveryDate) scope.daily.sent[id] = stamp;
        });
      }
      scope.pending = null;
      await store.save(state);
      return { ok: true };
    }
    if (action === 'read') {
      if (payload.base !== `${config.baseToken}/${config.articleTableId}` || !recordId(payload.recordId || '') || typeof payload.read !== 'boolean') throw new SafeError('Invalid record or configured table changed. Sync before editing status.');
      await client.request('PUT', `/open-apis/bitable/v1/apps/${config.baseToken}/tables/${config.articleTableId}/records/${payload.recordId}`,
        { data: { fields: { 阅读状态: payload.read ? '已读' : '待阅读' } } });
      return { ok: true };
    }
    // The client supplies captures and reminder date, never recipient/API/CLI paths.
    const result = await reading.sync({ items: payload.items || [], language: payload.language === 'zh' ? 'zh' : 'en',
      deliveryDate: payload.deliveryDate || null });
    return { ok: true, enabled: true, base: `${config.baseToken}/${config.articleTableId}`, ...result,
      identity: { appId: config.appId, openId: config.accountId } };
  };
}
