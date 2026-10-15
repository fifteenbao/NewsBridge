// Single-host POSIX reference. Use a shared database/lock for multiple machines.
import { constants } from 'node:fs';
import { open, mkdir, lstat, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { DiagnosticError } from '../src/lib/diagnostics.js';

export async function createFileState({ stateDir, authentication = 'bearer' }) {
  if (typeof stateDir !== 'string' || !stateDir) throw new Error('stateDir is required.');
  const dir = resolve(stateDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  function privateFile(stat, directory = false) {
    if (!(directory ? stat.isDirectory() : stat.isFile()) || stat.mode & 0o077 ||
        (process.getuid && stat.uid !== process.getuid()) || (!directory && stat.nlink !== 1)) throw new Error('Private state ownership or permissions are invalid.');
  }
  privateFile(await lstat(dir), true);
  async function read(name) {
    const file = await open(join(dir, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat(); privateFile(stat);
      if (stat.size > 32 * 1024 * 1024) throw new Error('State is too large.');
      return await file.readFile('utf8');
    } finally { await file.close(); }
  }
  async function syncDir() { const file = await open(dir, constants.O_RDONLY); try { await file.sync(); } finally { await file.close(); } }
  async function create(name, value) {
    const file = await open(join(dir, name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
    await syncDir();
  }
  async function exclusive(work) {
    let lock;
    try { lock = await open(join(dir, 'state.lock'), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new DiagnosticError('LOCK_BUSY', 'lock'); throw error; }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      await lock.sync();
      return await work();
    } finally { await lock.close(); await unlink(join(dir, 'state.lock')); }
  }
  async function accessKey() {
    const key = (await read('access.key')).trim();
    if (!/^[A-Za-z0-9_-]{32,512}$/.test(key)) throw new Error('Invalid access.key; correct it before starting.');
    return key;
  }
  const store = {
    async load() { return JSON.parse(await read('state.json')); },
    async save(value) {
      const text = JSON.stringify(value);
      if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error('State is too large.');
      const name = `.state-${randomUUID()}.tmp`;
      try { await create(name, text); await rename(join(dir, name), join(dir, 'state.json')); await syncDir(); }
      finally { await unlink(join(dir, name)).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    },
  };
  return { store, exclusive,
    async audit() {
      privateFile(await lstat(dir), true);
      await read('state.json'); if (authentication !== 'paired') await accessKey();
      const state = await store.load();
      if (state.version !== 1 || !state.scopes || typeof state.scopes !== 'object' || Array.isArray(state.scopes)) throw new Error('Invalid state.');
      return { ok: true, directory: '0700 or stricter', files: '0600 or stricter', owner: 'current uid', hardLinks: 1, probeCleanupRequired: !!state.probe };
    },
    checkAccessKey: async () => { await accessKey(); },
    // Explicit initialization only. Restarting must never erase receipts or rotate the key.
    initialize: () => exclusive(async () => {
      for (const [name, value] of [['state.json', JSON.stringify({ version: 1, scopes: {} })], ...(authentication === 'paired' ? [] : [['access.key', randomBytes(32).toString('base64url')]])]) {
        try { await create(name, value); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        await read(name);
      }
      if (authentication !== 'paired') await accessKey();
      const state = await store.load();
      if (state.version !== 1 || !state.scopes || typeof state.scopes !== 'object' || Array.isArray(state.scopes)) throw new Error('Invalid existing state; preserve it for diagnosis.');
    }),
    async authenticate(request) {
      const key = await accessKey();
      const supplied = Buffer.from(request.headers.get('Authorization') || '');
      const expected = Buffer.from(`Bearer ${key}`);
      return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    },
  };
}
