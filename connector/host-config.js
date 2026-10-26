import { SafeError } from '../src/lib/security.js';
import { parseConnectionUrl } from '../src/lib/connection-url.js';
export function validateHostConfig(config) {
  if (!config || typeof config !== 'object' || config.connections || config.connector?.storageProvider !== 'database') throw new SafeError('Use one database library configuration.');
  parseConnectionUrl(config.baseUrl);
  if (typeof config.stateDir !== 'string' || !config.stateDir || config.extensionId && !/^[a-p]{32}$/.test(config.extensionId)) throw new SafeError('Configure private storage and an exact extension ID.');
  const c = config.connector, f = config.feishu || {}, inbox = config.feishuInbox;
  if (f.export != null) throw new SafeError('Bitable export is no longer supported. Remove feishu.export; use CSV instead.');
  if (c.language && !['en', 'zh'].includes(c.language)) throw new SafeError('Invalid interface language.');
  if (inbox?.enabled && !/^cli_[A-Za-z0-9]+$/.test(f.appId || '')) throw new SafeError('Configure the Feishu app for optional outputs.');
  if (inbox?.enabled) {
    for (const [key, pattern] of [['allowedChatIds', /^oc_[A-Za-z0-9]+$/], ['allowedOpenIds', /^ou_[A-Za-z0-9]+$/]]) {
      if (!Array.isArray(inbox[key]) || !inbox[key].length || inbox[key].length > 100 || inbox[key].some(id => typeof id !== 'string' || !pattern.test(id))) throw new SafeError('Configure exact inbox allowlists.');
    }
  }
  return config;
}
