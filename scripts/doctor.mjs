import { readFile } from 'node:fs/promises';
import { validateConnectorConfig } from '../connector/config.js';
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--config')) throw new Error('Usage: npm run doctor -- [--config /private/connection.json]');
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22+ is required for development tools.');
JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
if (args[1]) {
  try { validateConnectorConfig(JSON.parse(await readFile(args[1], 'utf8'))); }
  catch { process.stderr.write('Connection configuration is invalid. Check the documented fields; private values are withheld.\n'); process.exitCode = 1; }
}
if (!process.exitCode) process.stdout.write('Local source/configuration checks passed. No connection, credentials, scheduler or live Feishu capabilities were tested.\n');
