import { isAbsolute, join } from 'node:path';
import { lstat, mkdir } from 'node:fs/promises';
import { validateHelperConfig, readPrivateJson } from '../helper/config.js';
import { SafeError, isSafeArticleUrl } from '../src/lib/security.js';

export const configPath = () => process.env.NEWSBRIDGE_CONFIG || '/srv/newsbridge/private/server.config.json';
export function validateServerConfig(input) {
  const base = validateHelperConfig(input);
  let url;
  try { url = new URL(input.publicOrigin); } catch { throw new SafeError('Configure a valid public HTTPS origin.'); }
  if (url.protocol !== 'https:' || url.origin !== input.publicOrigin || !isSafeArticleUrl(input.publicOrigin) ||
      !/^[a-f0-9]{64}$/.test(input.apiTokenHash || '') || !isAbsolute(input.stateDir || '') ||
      !Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) throw new SafeError('Invalid server origin, key hash, state directory or port.');
  try { new Intl.DateTimeFormat('en', { timeZone: input.timeZone }); } catch { throw new SafeError('Invalid reminder timezone.'); }
  if (typeof input.timeZone !== 'string' || !['en', 'zh'].includes(input.language)) throw new SafeError('Configure timezone and message language.');
  return { ...base, publicOrigin: input.publicOrigin, apiTokenHash: input.apiTokenHash, stateDir: input.stateDir,
    port: input.port, timeZone: input.timeZone, language: input.language,
    journalPath: join(input.stateDir, 'notification-state.json'), lockPath: join(input.stateDir, 'notification-state.lock') };
}
export async function loadServerConfig() {
  try {
    const config = validateServerConfig(await readPrivateJson(configPath(), 16384));
    await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
    const stat = await lstat(config.stateDir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) throw new SafeError('Server state directory must be private and owned by the service user.');
    return config;
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError('Create a private server config and authorize the configured CLI workspace.');
  }
}
