import { SafeError } from '../src/lib/security.js';
import { dueDate } from '../src/lib/reminder-schedule.js';
import { validateSchedule } from '../src/lib/reminder-schedule.js';
import { createReadingService } from './lib/notifications.js';
import { libraryCsv } from './lib/csv.js';

const allowed = { health: [], sync: ['items'], read: ['base', 'recordId', 'status', 'read'], preferences: ['language', 'remindersEnabled', 'reminderTime', 'timeZone'], pending: [], resolve: ['uuid', 'outcome'], export: [], csv: [] };
export function createDatabaseConnector({ library, config = {}, feishu, store, exclusive, now = () => Date.now() }) {
  const identity = library.identity;
  const timing = validateSchedule(config.reminderTime || '10:00', config.timeZone || 'Asia/Shanghai');
  if (typeof config.remindersEnabled !== 'boolean' || config.remindersEnabled && !config.chatId) throw new SafeError('Configure reminder availability.');
  const messageConfig = { connectionId: identity.connectionId, baseToken: library.libraryId, articleTableId: 'library',
    ...(config.remindersEnabled ? { notifications: { chatId: config.chatId, interactive: config.interactive === true } } : {}) };
  const reading = createReadingService({ config: messageConfig, store, now,
    knowledge: { sync: async ({ items }) => { const result = library.sync(items); if (!items.length) result.articles = result.articles.filter(a => !a.snoozedUntil || a.snoozedUntil <= now()); return result; } },
    request: async (_method, _path, { data }) => feishu.send(data.receive_id, data.msg_type, JSON.parse(data.content), data.uuid),
  });
  let queue = Promise.resolve();
  const serial = work => { const next = queue.then(() => exclusive(work)); queue = next.catch(() => {}); return next; };
  const scopeKey = JSON.stringify([identity.connectionId, library.libraryId, 'library', config.remindersEnabled ? config.chatId : undefined]);
  const prefs = async () => ({ ...timing, language: config.language === 'zh' ? 'zh' : 'en', remindersEnabled: false, ...(await store.load()).preferences });
  const envelope = result => ({ ...result, ok: true, protocolVersion: 1, identity });
  return {
    dispatch: (action, payload = {}) => serial(async () => {
      if (!Object.hasOwn(allowed, action) || !payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(k => !['provider', 'expectedIdentity', ...allowed[action]].includes(k))) throw new SafeError('Unsupported database operation.');
      if (payload.provider !== undefined && payload.provider !== 'database') throw new SafeError('ReadFlow uses its database as the source of truth.');
      if (payload.expectedIdentity && (payload.expectedIdentity.connectionId !== identity.connectionId || payload.expectedIdentity.base !== identity.base)) throw new SafeError('Library identity changed. Disconnect before associating another library.');
      if (action === 'health') return envelope({ connected: true, schema: { valid: true, checkedFields: 10 }, capabilities: { tableRead: true, tableWrite: true, database: true, export: feishu.exportAvailable, csv: true },
        configuration: { storageProvider: 'database', libraryName: 'ReadFlow', exportUrl: feishu.exportUrl, exportAvailable: feishu.exportAvailable, chatId: config.chatId || '', remindersAvailable: config.remindersEnabled, ...await prefs() } });
      if (action === 'sync') return envelope({ enabled: true, base: identity.base, ...library.sync(payload.items || []) });
      if (action === 'read') {
        if (payload.base !== identity.base) throw new SafeError('Library identity changed.');
        library.setStatus(payload.recordId, payload.status ?? (payload.read === true ? '已读' : payload.read === false ? '待阅读' : ''));
        return envelope({});
      }
      if (action === 'preferences') {
        if (!['en', 'zh'].includes(payload.language) || payload.remindersEnabled !== undefined && typeof payload.remindersEnabled !== 'boolean') throw new SafeError('Invalid preferences.');
        if (payload.remindersEnabled && !config.remindersEnabled) throw new SafeError('Configure the service scheduler and Feishu messages before enabling reminders.');
        const state = await store.load(), previous = await prefs();
        state.preferences = { ...previous, ...validateSchedule(payload.reminderTime ?? previous.reminderTime, payload.timeZone ?? previous.timeZone), language: payload.language,
          ...(payload.remindersEnabled !== undefined ? { remindersEnabled: payload.remindersEnabled } : {}) };
        await store.save(state); return envelope({});
      }
      if (action === 'export') {
        // An explicit authenticated request is the only path to Bitable writes.
        const result = await feishu.exportArticles(library.list());
        const state = await store.load(); state.lastExport = { ...result, at: new Date(now()).toISOString() }; await store.save(state);
        return envelope(state.lastExport);
      }
      if (action === 'csv') return envelope({ csv: libraryCsv(library.list()), filename: 'readflow.csv', count: library.list().length });
      const state = await store.load(), scope = state.scopes[scopeKey];
      if (action === 'pending') return envelope({ pending: scope?.pending || null });
      if (!scope?.pending || scope.pending.id !== payload.uuid || !['sent', 'not-sent'].includes(payload.outcome)) throw new SafeError('The pending delivery changed.');
      if (payload.outcome === 'sent') for (const id of scope.pending.recordIds) { scope.sent[id] = new Date(now()).toISOString(); if (scope.daily?.date === scope.pending.deliveryDate) scope.daily.sent[id] = scope.sent[id]; }
      scope.pending = null; await store.save(state); return envelope({});
    }),
    daily: () => serial(async () => {
      const preferences = await prefs();
      if (!config.remindersEnabled || !preferences.remindersEnabled) return { ok: true, skipped: true };
      const date = dueDate(now(), preferences.timeZone, preferences.reminderTime);
      if (!date) return { ok: true, skipped: true };
      const result = await reading.sync({ items: [], language: preferences.language, deliveryDate: date });
      if (result.notifications?.error) throw new SafeError(result.notifications.error);
      return { ok: true, date, deliveries: result.notifications?.deliveries.length || 0 };
    }),
  };
}
