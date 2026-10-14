import { isSafeArticleUrl, SafeError } from './security.js';
// notifiedAt represents delivery for the current daily run during selection.
export function eligibleItems(items) {
  return items.filter(item => !item.read && item.status !== '跳过' && !item.notifiedAt && !item.feishuDeleted && isSafeArticleUrl(item.url))
    .sort((a, b) => new Date(a.savedAt) - new Date(b.savedAt));
}
export const MAX_ITEMS_PER_MESSAGE = 20;
export function nextBatch(items) {
  const eligible = eligibleItems(items);
  return { ready: eligible.length > 0, batch: eligible.slice(0, MAX_ITEMS_PER_MESSAGE) };
}
