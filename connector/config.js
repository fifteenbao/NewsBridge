import { SafeError } from '../src/lib/security.js';
import { validateConfig } from '../src/lib/bitable.js';

export function validateConnectorConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SafeError('Configure the connection.');
  validateConfig(input);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.connectionId || '') ||
      input.chatId && !/^oc_[A-Za-z0-9]{1,128}$/.test(input.chatId) ||
      typeof input.remindersEnabled !== 'boolean' ||
      input.remindersEnabled && !input.chatId) throw new SafeError('Invalid connection identity or reminder configuration.');
  const timeZone = input.timeZone || 'Asia/Shanghai', language = input.language || 'en';
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new SafeError('Invalid reminder timezone.'); }
  if (typeof timeZone !== 'string' || !['en', 'zh'].includes(language)) throw new SafeError('Invalid timezone or language.');
  return Object.freeze({ connectionId: input.connectionId, baseToken: input.baseToken, articleTableId: input.articleTableId,
    chatId: input.chatId || '', schema: 'briefing', timeZone, language, remindersEnabled: input.remindersEnabled,
    ...(input.remindersEnabled ? { notifications: { chatId: input.chatId } } : {}) });
}
