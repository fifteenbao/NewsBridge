import { SafeError, safeErrorMessage, isSafeArticleUrl } from './security.js';
import { nextBatch } from './batch.js';
import { buildReadingMessage } from './messages.js';

export function validateNotifications(config) {
  if (!config) return false;
  if (typeof config.chatId !== 'string' || !/^oc_[A-Za-z0-9]+$/.test(config.chatId)) {
    throw new SafeError('Configure notifications.chatId with the Feishu chat_id of your conversation (oc_...).');
  }
  
  if (config.mentionOpenId && !/^ou_[A-Za-z0-9]+$/.test(config.mentionOpenId)) throw new SafeError('mentionOpenId must be the recipient open_id (ou_...).');
  return true;
}

// Serialize selection and delivery within a service. The background worker also
// serializes separate service instances and dashboard mutations.
export function createReadingService({ knowledge, config, request, store, now = () => Date.now() }) {
  let queue = Promise.resolve();
  const scopeKey = JSON.stringify([config.appId, config.accountId, config.baseToken, config.articleTableId, config.notifications?.chatId]);

  async function run({ items = [], language = 'en', deliveryDate = null } = {}) {
    if (deliveryDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) throw new SafeError('Invalid daily delivery date.');
    let result = await knowledge.sync({ config, items });
    let scope;
    const deliveries = [];
    let notificationError = null;
    let configured = false;
    try {
      configured = validateNotifications(config.notifications);
      if (configured) {
        const state = await store.load();
        scope = state.scopes[scopeKey] ||= { target: { baseToken: config.baseToken,
          tableId: config.articleTableId, chatId: config.notifications.chatId, accountId: config.accountId }, sent: {}, pending: null };
        // Captures and manual sync only update the table. A scheduled run supplies
        // a date; historical receipts do not suppress tomorrow's unread reminder.
        if (!deliveryDate) return { ...result, notifications: { configured, deliveries, sent: scope.sent, error: null } };
        if (scope.pending && scope.pending.deliveryDate !== deliveryDate) {
          throw new SafeError('An unconfirmed send belongs to an earlier schedule. Check the previous message and resolve it in Settings before the daily reminder can continue.');
        }
        if (scope.daily?.date !== deliveryDate) {
          scope.daily = { date: deliveryDate, sent: {}, complete: false };
          await store.save(state);
        }
        if (scope.daily.complete) return { ...result, notifications: { configured, deliveries, sent: scope.sent, error: null } };
        // Re-read before each send: do not forward stale browser status.
        for (;;) {
          const latest = await knowledge.sync({ config, items: [] });
          result.articles = latest.articles;
          result.topics = latest.topics;
          const eligible = latest.articles.map(article => ({ ...article, id: article.recordId,
            savedAt: Number.isFinite(article.savedAt) ? new Date(article.savedAt).toISOString() : '1970-01-01T00:00:00Z',
            notifiedAt: scope.daily.sent[article.recordId] || null }));
          let pending = scope.pending;
          if (pending) {
            // Feishu deduplicates the request UUID for one hour. Beyond that,
            // leave the uncertain delivery for the operator to reconcile.
            if (now() - pending.createdAt >= 60 * 60 * 1000) {
              throw new SafeError('An unconfirmed send is over one hour old. Check the target conversation before resolving delivery journal in Settings; automatic retry is paused.');
            }
            if (pending.recordIds.some(id => !eligible.some(a => a.id === id && !a.read && !a.notifiedAt && isSafeArticleUrl(a.url) &&
                (!pending.links || pending.links[id] === a.url)))) {
              throw new SafeError('The pending batch changed status or links. Check the previous send before resolving delivery journal in Settings.');
            }
          } else {
            const { ready, batch } = nextBatch(eligible);
            if (!ready) {
              scope.daily.complete = true;
              await store.save(state);
              break;
            }
            pending = { id: crypto.randomUUID(), createdAt: now(), recordIds: batch.map(a => a.id),
              deliveryDate,
              links: Object.fromEntries(batch.map(a => [a.id, a.url])),
              content: JSON.stringify(buildReadingMessage(batch, language, config.notifications.mentionOpenId)) };
            scope.pending = pending;
            await store.save(state); // Save the retry key before the external effect.
          }
          const sent = await request('POST', '/open-apis/im/v1/messages', {
            params: { receive_id_type: 'chat_id' }, data: {
              receive_id: config.notifications.chatId, msg_type: 'post', content: pending.content, uuid: pending.id,
            },
          });
          const messageId = sent.data?.message_id;
          if (sent.ok === false || sent.code || !/^om_[A-Za-z0-9]{1,128}$/.test(messageId || '')) throw new SafeError('Feishu did not confirm delivery. The batch remains pending.');
          const stamp = new Date(now()).toISOString();
          pending.recordIds.forEach(id => { scope.sent[id] = stamp; scope.daily.sent[id] = stamp; });
          scope.pending = null;
          await store.save(state);
          deliveries.push({ messageId, recordIds: pending.recordIds });
        }
      }
    } catch (error) { notificationError = safeErrorMessage(error); }
    return { ...result, notifications: { configured, deliveries, sent: scope?.sent || {}, error: notificationError } };
  }

  function enqueue(work) {
    const task = queue.then(work);
    queue = task.catch(() => {});
    return task;
  }
  return { sync: body => enqueue(() => run(body)), exclusive: enqueue };
}
