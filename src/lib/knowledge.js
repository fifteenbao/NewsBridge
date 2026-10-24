import { isSafeArticleUrl } from './security.js';
import { callConnection } from './connection.js';
export const callKnowledge = (action, payload) => callConnection(action, payload);

// Reconcile remote fields while retaining unacknowledged explicit capture edits.
export function mergeKnowledge(items, result) {
  const bindings = new Map(result.bindings.map(b => [b.id, b.recordId]));
  const records = new Map(result.articles.map(a => [a.recordId, a]));
  const topics = new Map(result.topics.map(t => [t.id, t]));
  const sent = result.notifications?.sent || {};
  const acknowledgements = new Map((result.metadataBindings || []).map(binding => [binding.id, binding.editId]));
  const merged = items.map(item => {
    const record = records.get(bindings.get(item.id));
    if (!record) {
      if (item.feishuBase === result.base && item.feishuRecordId) return { ...item, feishuDeleted: true };
      return item;
    }
    const pending = item.metadataUpdate && acknowledgements.get(item.id) !== item.metadataUpdate.id ? item.metadataUpdate : undefined;
    return { ...item, metadataUpdate: pending, tags: record.tags || [], remark: record.remark || '', ...pending?.fields,
      title: record.title || item.title, url: record.url,
      read: record.read, status: record.status, feishuRecordId: record.recordId, feishuBase: result.base,
      notifiedAt: sent[record.recordId] || null,
      feishuDeleted: false, content: record.content, category: record.category, recommendation: record.recommendation,
      note: record.note, topics: record.topicIds.map(id => topics.get(id)).filter(Boolean) };
  });
  const known = new Set(merged.filter(it => it.feishuBase === result.base).map(it => it.feishuRecordId));
  for (const record of result.articles) {
    if (known.has(record.recordId) || !isSafeArticleUrl(record.url)) continue;
    merged.push({ id: `feishu:${result.base}/${record.recordId}`, title: record.title || record.url, url: record.url,
      savedAt: new Date(Number.isFinite(record.savedAt) ? record.savedAt : Date.now()).toISOString(),
      read: record.read, status: record.status, notifiedAt: sent[record.recordId] || null, feishuRecordId: record.recordId, feishuBase: result.base,
      feishuDeleted: false, content: record.content, category: record.category, recommendation: record.recommendation,
      note: record.note, tags: record.tags || [], remark: record.remark || '', topics: record.topicIds.map(id => topics.get(id)).filter(Boolean) });
  }
  return merged;
}
