import { randomBytes, createHash } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readPrivateJson } from '../helper/config.js';
import { configPath } from './config.js';
const path = configPath(), config = await readPrivateJson(path, 16384);
const key = randomBytes(32).toString('base64url');
async function replace(target, content) {
  const tmp = target + '.' + randomBytes(8).toString('hex') + '.tmp';
  let file;
  try {
    file = await open(tmp, 'wx', 0o600); await file.writeFile(content); await file.sync(); await file.close(); file = null;
    await rename(tmp, target);
  } finally { await file?.close(); await unlink(tmp).catch(() => {}); }
}
// Keep the new plaintext key recoverable before committing its hash.
await replace(join(dirname(path), 'browser-token.txt'), key + '\n');
config.apiTokenHash = createHash('sha256').update(key).digest('hex');
await replace(path, JSON.stringify(config, null, 2) + '\n');
process.stdout.write('Service key rotated. Restart the API, then update Chrome from browser-token.txt.\n');
