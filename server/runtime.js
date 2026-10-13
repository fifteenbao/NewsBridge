import { createHelperBridge } from '../helper/bridge.js';
import { createCliRunner } from '../helper/cli.js';
import { createJournal, withJournalLock } from '../helper/journal.js';
import { SafeError } from '../src/lib/security.js';

export function dueDate(time, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Number(values.hour) >= 10 ? `${values.year}-${values.month}-${values.day}` : null;
}
export function createServerRuntime({ config, run = createCliRunner(config), store = createJournal(config.journalPath),
  exclusive = work => withJournalLock(config.lockPath, work), now = () => Date.now() }) {
  const bridge = createHelperBridge({ config, run, store, now });
  async function language() {
    const value = (await store.load()).preferences?.language || config.language;
    if (!['en', 'zh'].includes(value)) throw new SafeError('Invalid stored message language.');
    return value;
  }
  return {
    dispatch: (action, payload = {}) => exclusive(async () => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || 'deliveryDate' in payload || 'legacyJournal' in payload) throw new SafeError('Browser requests cannot trigger or import daily deliveries.');
      if (action === 'preferences') {
        if (!['en', 'zh'].includes(payload.language) || Object.keys(payload).some(key => !['language', 'expectedIdentity'].includes(key))) throw new SafeError('Invalid message language.');
        await bridge('health', payload);
        const state = await store.load(); state.preferences = { language: payload.language }; await store.save(state);
        return { ok: true };
      }
      const result = await bridge(action, { ...payload, deliveryDate: null, language: await language() });
      if (action === 'health') result.configuration = { ...result.configuration, timeZone: config.timeZone, language: await language(), reminderOwner: 'server' };
      return result;
    }),
    daily: async () => {
      const date = dueDate(now(), config.timeZone);
      if (!date) return { ok: true, skipped: true };
      return exclusive(async () => {
        const result = await bridge('sync', { items: [], deliveryDate: date, language: await language() });
        if (result.notifications?.error) throw new SafeError(result.notifications.error);
        return { ok: true, date, deliveries: result.notifications?.deliveries.length || 0 };
      });
    },
  };
}
