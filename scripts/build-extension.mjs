import { readFile, writeFile, mkdir, readdir, lstat, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConnectionUrl } from '../src/lib/connection-url.js';

// An allowlist avoids ever packaging private config, credentials or backend code.
export async function buildExtension({ baseUrl = '', outputRoot = new URL('../dist/', import.meta.url) } = {}) {
  const target = baseUrl ? parseConnectionUrl(baseUrl) : null;
  const origin = target?.origin || '';
  baseUrl = target?.baseUrl || '';
  const root = fileURLToPath(new URL('../', import.meta.url));
  const outRoot = outputRoot instanceof URL ? fileURLToPath(outputRoot) : resolve(outputRoot);
  const name = origin ? 'newsbridge-connected' : 'newsbridge';
  const output = join(outRoot, name), entries = [];
  async function add(name) {
    const path = join(root, name), info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('Symlinks are not allowed in extension packages.');
    if (info.isDirectory()) { for (const child of (await readdir(path)).sort()) { if (!child.startsWith('.')) await add(`${name}/${child}`); } return; }
    entries.push({ name, data: await readFile(path) });
  }
  for (const name of ['manifest.json', 'src', 'icons', 'LICENSE']) await add(name);
  const manifest = JSON.parse(entries.find(e => e.name === 'manifest.json').data);
  if (origin) { manifest.host_permissions = [origin + '/*']; delete manifest.optional_host_permissions; } else delete manifest.host_permissions;
  manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages.replace(/connect-src [^;]+;/, `connect-src ${origin || 'https:'};`);
  entries.find(e => e.name === 'manifest.json').data = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  entries.find(e => e.name === 'src/lib/connection-config.js').data = Buffer.from(`export const CONNECTION_BASE_URL = ${JSON.stringify(baseUrl)};\n`);
  if (!/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) throw new Error('Invalid extension version.');
  const versionArchive = join(outRoot, `${name}-V${manifest.version}.zip`);
  // Only a designated generated directory is replaced; never the repository.
  if (output === root || relative(root, outRoot) === '') throw new Error('Choose a build output directory.');
  await mkdir(outRoot, { recursive: true, mode: 0o700 });
  for (const path of [outRoot, output, output + '.zip', versionArchive]) {
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Build output must not be a symlink.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { mode: 0o700 });
  for (const entry of entries) {
    const target = join(output, entry.name);
    await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 });
    await writeFile(target, entry.data, { mode: 0o600 });
  }
  const archiveData = zip(entries);
  await writeFile(output + '.zip', archiveData, { mode: 0o600 });
  await writeFile(versionArchive, archiveData, { mode: 0o600 });
  return { directory: output, archive: output + '.zip', versionArchive, connected: !!origin };
}
// ZIP STORE records: portable packaging without a shell, OS utility or dependency.
function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), crc = crc32(entry.data), header = Buffer.alloc(30), index = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(entry.data.length, 18); header.writeUInt32LE(entry.data.length, 22); header.writeUInt16LE(name.length, 26);
    index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6); index.writeUInt16LE(0x800, 8); index.writeUInt16LE(33, 14);
    index.writeUInt32LE(crc, 16); index.writeUInt32LE(entry.data.length, 20); index.writeUInt32LE(entry.data.length, 24); index.writeUInt16LE(name.length, 28); index.writeUInt32LE(offset, 42);
    local.push(header, name, entry.data); central.push(index, name); offset += header.length + name.length + entry.data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || !['--base-url', '--config'].includes(args[0]))) throw new Error('Usage: npm run build -- [--base-url https://connection.example.com/newsbridge/ | --config /private/endpoint.json]');
  let baseUrl = args[1] || '';
  if (args[0] === '--config') {
    try {
      const config = JSON.parse(await readFile(args[1], 'utf8'));
      if (typeof config.baseUrl !== 'string' || !config.baseUrl) throw new Error();
      baseUrl = config.baseUrl;
    } catch { throw new Error('Private build config must contain a nonempty baseUrl.'); }
  }
  const result = await buildExtension({ baseUrl });
  process.stdout.write(`Extension folder: ${result.directory}\nZIP archive: ${result.archive}\nVersioned ZIP: ${result.versionArchive}\n${result.connected ? 'Private connection build; do not publish.' : 'No endpoint configured; grant one connection host from Settings when needed.'}\n`);
}
