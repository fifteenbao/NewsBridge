import { DiagnosticError } from '../src/lib/diagnostics.js';
import { SafeError } from '../src/lib/security.js';
import { createKnowledgeService } from '../src/lib/bitable.js';
import { createReadingService } from '../src/lib/notifications.js';
import { validateFeishuOperation } from '../src/lib/api-policy.js';
import { createAdapterClient } from './client.js';

const scopeKey = config => JSON.stringify([config.connectionId, config.baseToken, config.articleTableId, config.chatId || undefined]);
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
export function createBridge({ config, adapter, store, now = () => Date.now() }) {
  const client = createAdapterClient(config, adapter);
  const key = scopeKey(config);
  const knowledge = createKnowledgeService(client.request);
  const reading = createReadingService({ knowledge, config, request: client.request, store, now });
  return async (action, payload = {}) => {
    if (!['health', 'sync', 'read', 'pending', 'resolve'].includes(action)) throw new SafeError('Unsupported connection operation.');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new SafeError('Invalid connection request.');
    if (payload.expectedIdentity && (payload.expectedIdentity.connectionId !== config.connectionId || payload.expectedIdentity.base !== `${config.baseToken}/${config.articleTableId}`)) {
      throw new SafeError('The connection identity or table differs from this collection. Disconnect the current collection in Settings before associating another account or table.');
    }
    await client.verifyIdentity();
    if (action === 'health') return { ok: true, connected: true, schema: await knowledge.preflight(config), configuration: {
      baseToken: config.baseToken, articleTableId: config.articleTableId, chatId: config.chatId,
    } };
    const state = await store.load();
    try { if (state.scopes[key]) validateScope(state.scopes[key], config); }
    catch { throw new DiagnosticError('STATE_LOAD', 'state.load'); }
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
      const status = payload.status ?? (typeof payload.read === 'boolean' ? payload.read ? '已读' : '待阅读' : null);
      if (payload.status !== undefined && payload.read !== undefined) throw new SafeError('Choose one reading-status representation.');
      if (payload.base !== `${config.baseToken}/${config.articleTableId}` || !recordId(payload.recordId || '') || !['待阅读', '已读', '跳过'].includes(status)) throw new SafeError('Invalid record or configured table changed. Sync before editing status.');
      await client.request('PUT', `/open-apis/bitable/v1/apps/${config.baseToken}/tables/${config.articleTableId}/records/${payload.recordId}`,
        { data: { fields: { 阅读状态: status } } });
      return { ok: true };
    }
    // Only the trusted scheduler supplies a reminder date; browser dispatch strips it.
    const result = await reading.sync({ items: payload.items || [], language: payload.language === 'zh' ? 'zh' : 'en',
      deliveryDate: payload.deliveryDate || null });
    return { ok: true, enabled: true, base: `${config.baseToken}/${config.articleTableId}`, ...result,
      identity: { connectionId: config.connectionId, base: `${config.baseToken}/${config.articleTableId}` } };
  };
}
