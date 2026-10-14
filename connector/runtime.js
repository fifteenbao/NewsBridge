import { createBridge } from './bridge.js';
import { validateConnectorConfig } from './config.js';
import { DiagnosticError, cleanDiagnostic } from '../src/lib/diagnostics.js';
import { SafeError } from '../src/lib/security.js';

export function dueDate(time, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Number(values.hour) >= 10 ? `${values.year}-${values.month}-${values.day}` : null;
}
const fields = {
  health: [], sync: ['items'], read: ['base', 'recordId', 'read'], pending: [],
  resolve: ['uuid', 'outcome'], preferences: ['language', 'table'],
};
export function createConnector({ config: input, adapter, store: inputStore, exclusive, onDiagnostic = () => {}, now = () => Date.now() }) {
  const config = validateConnectorConfig(input);
  if (typeof inputStore?.load !== 'function' || typeof inputStore?.save !== 'function' || typeof exclusive !== 'function') {
    throw new SafeError('Provide durable state storage and a shared exclusive lock.');
  }
  const store = {
    async load() {
      try {
        const state = await inputStore.load();
        if (!state || state.version !== 1 || !state.scopes || typeof state.scopes !== 'object' || Array.isArray(state.scopes)) throw new Error();
        return state;
      } catch { throw new DiagnosticError('STATE_LOAD', 'state.load'); }
    },
    async save(state) { try { await inputStore.save(state); } catch { throw new DiagnosticError('STATE_SAVE', 'state.save'); } },
  };
  const bridge = createBridge({ config, adapter, store, now });
  const identity = { connectionId: config.connectionId, base: `${config.baseToken}/${config.articleTableId}` };
  let queue = Promise.resolve();
  const serial = (stage, work) => {
    const next = queue.then(() => exclusive(work)).catch(async error => {
      const diagnostic = { ...(cleanDiagnostic(error?.diagnostic) || { code: 'OPERATION_FAILED', stage }), reference: crypto.randomUUID() };
      try { await onDiagnostic(diagnostic); } catch { /* Diagnostics must not alter the operation. */ }
      if (error instanceof SafeError && !(error instanceof DiagnosticError)) {
        error.diagnostic = diagnostic; throw error;
      }
      throw new DiagnosticError(diagnostic.code, diagnostic.stage, diagnostic);
    });
    queue = next.catch(() => {});
    return next;
  };
  async function language() {
    const value = (await store.load()).preferences?.language || config.language;
    if (!['en', 'zh'].includes(value)) throw new SafeError('Invalid stored language.');
    return value;
  }
  return {
    dispatch: (action, payload = {}) => serial(Object.hasOwn(fields, action) ? action : 'sync', async () => {
      if (!Object.hasOwn(fields, action) || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
          Object.keys(payload).some(key => key !== 'expectedIdentity' && !fields[action].includes(key))) throw new SafeError('Unsupported connection action or payload.');
      if (action === 'preferences') {
        if (!['en', 'zh'].includes(payload.language)) throw new SafeError('Invalid message language.');
        if (payload.table !== undefined && payload.table !== identity.base) throw new DiagnosticError('TABLE_MISMATCH', 'preferences');
        await bridge('health', payload);
        const state = await store.load(); state.preferences = { language: payload.language }; await store.save(state);
        return { ok: true, protocolVersion: 1, identity };
      }
      const result = await bridge(action, { ...payload, deliveryDate: null, language: await language() });
      if (action === 'health') {
        result.capabilities = { tableRead: true, tableWrite: true, messages: adapter.capabilities.messages === true };
        result.configuration = { ...result.configuration, timeZone: config.timeZone, language: await language(),
          remindersEnabled: config.remindersEnabled, reminderOwner: 'external' };
      }
      return { ...result, identity, protocolVersion: 1 };
    }),
    daily: () => serial('daily', async () => {
      if (!config.remindersEnabled) return { ok: true, skipped: true };
      const date = dueDate(now(), config.timeZone);
      if (!date) return { ok: true, skipped: true };
      const result = await bridge('sync', { items: [], deliveryDate: date, language: await language() });
      if (result.notifications?.error) {
        const d = cleanDiagnostic(result.notifications.diagnostic);
        if (d) throw new DiagnosticError(d.code, d.stage, d);
        throw new SafeError(result.notifications.error);
      }
      return { ok: true, date, deliveries: result.notifications?.deliveries.length || 0 };
    }),
  };
}
