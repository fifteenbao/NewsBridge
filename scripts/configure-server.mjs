import { readFile, writeFile } from 'node:fs/promises';
import { isSafeArticleUrl } from '../src/lib/security.js';
const origin = process.argv[2];
let url;
try { url = new URL(origin); } catch { throw new Error('Usage: node scripts/configure-server.mjs https://your-server.example'); }
if (process.argv.length !== 3 || url.protocol !== 'https:' || url.origin !== origin || !isSafeArticleUrl(origin) || origin.includes('*')) throw new Error('Supply one exact public HTTPS origin with no path or trailing slash.');
const manifestPath = new URL('../manifest.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.host_permissions = [origin + '/*'];
manifest.content_security_policy.extension_pages = "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; connect-src " + origin + ';';
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
await writeFile(new URL('../src/lib/server-target.js', import.meta.url), '// Update through scripts/configure-server.mjs to keep permissions and CSP aligned.\nexport const SERVER_ORIGIN = ' + JSON.stringify(origin) + ';\n');
process.stdout.write('Exact server origin, Chrome permission and CSP updated. Reload the extension.\n');
