import { randomBytes, createHash } from 'node:crypto';
import { readFile, open, mkdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { configPath } from './config.js';
// Never print the key. Initialization refuses existing configuration/key files.
const path = configPath(), keyPath = join(dirname(path), 'browser-token.txt');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--template')) throw new Error('Usage: node server/init-config.js [--template /path/to/private/template.json]');
const value = JSON.parse(await readFile(args[1] || new URL('./server.config.example.json', import.meta.url), 'utf8'));
const key = randomBytes(32).toString('base64url');
value.apiTokenHash = createHash('sha256').update(key).digest('hex');
await mkdir(dirname(path), { recursive: true, mode: 0o700 });
const token = await open(keyPath, 'wx', 0o600);
await token.writeFile(key + '\n'); await token.close();
try {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
} catch (error) { await unlink(keyPath); throw new Error('Configuration already exists or is unavailable; it was not overwritten.'); }
process.stdout.write('Private config and browser-token.txt created. Complete config IDs before starting services.\n');
