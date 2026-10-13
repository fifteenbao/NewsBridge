import { open, constants } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { SafeError } from '../src/lib/security.js';
import { validateConfig } from '../src/lib/bitable.js';

export function validateHelperConfig(input) {
  if (!input || typeof input !== 'object') throw new SafeError('Configure the private server config.');
  validateConfig(input);
  if (!/^[a-p]{32}$/.test(input.extensionId || '') || !/^cli_[A-Za-z0-9]{1,128}$/.test(input.appId || '') ||
      !/^ou_[A-Za-z0-9]{1,128}$/.test(input.accountId || '') || !isAbsolute(input.larkCliPath || '') || !isAbsolute(input.cliWorkspace || '') ||
      input.chatId && !/^oc_[A-Za-z0-9]{1,128}$/.test(input.chatId)) throw new SafeError('Invalid service IDs, CLI path or workspace. Check the setup guide.');
  return { extensionId: input.extensionId, appId: input.appId, accountId: input.accountId,
    baseToken: input.baseToken, articleTableId: input.articleTableId, chatId: input.chatId || '',
    larkCliPath: input.larkCliPath, cliWorkspace: input.cliWorkspace, schema: 'briefing',
    ...(input.chatId ? { notifications: { chatId: input.chatId } } : {}) };
}
export async function readPrivateJson(path, maxBytes = 20 * 1024 * 1024) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes || typeof process.getuid === 'function' &&
        (stat.uid !== process.getuid() || stat.mode & 0o077)) throw new SafeError('The helper data file must be a private regular file owned by your account (chmod 600).');
    return JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
}
