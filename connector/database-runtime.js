import { SafeError } from '../src/lib/security.js';
import { libraryCsv } from './lib/csv.js';

const allowed = { health: [], sync: ['items'], read: ['base', 'recordId', 'status', 'read'], preferences: ['language', 'remindersEnabled', 'reminderTime', 'timeZone'], pending: [], resolve: ['uuid', 'outcome'], csv: [] };
export function createDatabaseConnector({ library, config = {}, feishu, store, exclusive, now = () => Date.now() }) {
  const identity = library.identity;
  let queue = Promise.resolve();
  const serial = work => { const next = queue.then(() => exclusive(work)); queue = next.catch(() => {}); return next; };
  const scopeKey = JSON.stringify([identity.connectionId, library.libraryId, 'library', config.remindersEnabled ? config.chatId : undefined]);
  const prefs = async () => ({ language: (await store.load()).preferences?.language || config.language || 'zh', remindersEnabled: false });
  const envelope = result => ({ ...result, ok: true, protocolVersion: 1, identity });
  return {
    dispatch: (action, payload = {}) => serial(async () => {
      if (!Object.hasOwn(allowed, action) || !payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(k => !['provider', 'expectedIdentity', ...allowed[action]].includes(k))) throw new SafeError('Unsupported database operation.');
      if (payload.provider !== undefined && payload.provider !== 'database') throw new SafeError('ReadFlow uses its database as the source of truth.');
      if (payload.expectedIdentity && (payload.expectedIdentity.connectionId !== identity.connectionId || payload.expectedIdentity.base !== identity.base)) throw new SafeError('Library identity changed. Disconnect before associating another library.');
      if (action === 'health') return envelope({ connected: true, schema: { valid: true, checkedFields: 7 }, capabilities: { tableRead: true, tableWrite: true, database: true, csv: true },
        configuration: { storageProvider: 'database', libraryName: 'ReadFlow', remindersAvailable: false, ...await prefs() } });
      if (action === 'sync') return envelope({ enabled: true, base: identity.base, ...library.sync(payload.items || []) });
      if (action === 'read') {
        if (payload.base !== identity.base) throw new SafeError('Library identity changed.');
        const article = library.setStatus(payload.recordId, payload.status ?? (payload.read === true ? '已读' : payload.read === false ? '待阅读' : ''));
        return envelope({ readAt: article.readAt ?? null });
      }
      if (action === 'preferences') {
        if (!['en', 'zh'].includes(payload.language) || payload.remindersEnabled !== undefined && typeof payload.remindersEnabled !== 'boolean') throw new SafeError('Invalid preferences.');
        if (payload.remindersEnabled) throw new SafeError('Daily reading reminders are currently unavailable.');
        const state = await store.load();
        state.preferences = { language: payload.language, remindersEnabled: false };
        await store.save(state); return envelope({});
      }
      if (action === 'csv') return envelope({ csv: libraryCsv(library.list()), filename: 'readflow.csv', count: library.list().length });
      const state = await store.load(), scope = state.scopes[scopeKey];
      if (action === 'pending') return envelope({ pending: scope?.pending || null });
      if (!scope?.pending || scope.pending.id !== payload.uuid || !['sent', 'not-sent'].includes(payload.outcome)) throw new SafeError('The pending delivery changed.');
      if (payload.outcome === 'sent') for (const id of scope.pending.recordIds) { scope.sent[id] = new Date(now()).toISOString(); if (scope.daily?.date === scope.pending.deliveryDate) scope.daily.sent[id] = scope.sent[id]; }
      scope.pending = null; await store.save(state); return envelope({});
    }),
    // Old scheduler invocations cannot send after upgrading the service.
    daily: async () => ({ ok: true, skipped: true, reason: 'Daily reminders removed.' }),
  };
}
