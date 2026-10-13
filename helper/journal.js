import { open, rename, unlink, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { SafeError } from '../src/lib/security.js';
import { readPrivateJson } from './config.js';

export const JOURNAL_PATH = new URL('./notification-state.json', import.meta.url);
export function createJournal(path = JOURNAL_PATH) {
  return {
    async load() {
      try {
        const state = await readPrivateJson(path);
        if (state.version !== 1 || !state.scopes || typeof state.scopes !== 'object' || Array.isArray(state.scopes)) throw new Error();
        return state;
      } catch (error) {
        if (error.code === 'ENOENT') return { version: 1, scopes: {}, importedScopes: {} };
        throw new SafeError('The delivery journal is invalid or not private. Preserve it and resolve the file error before retrying.');
      }
    },
    async save(state) {
      const target = path;
      const temporary = new URL(`./notification-state.${randomUUID()}.tmp`, path instanceof URL ? path : pathToFileURL(path));
      const bytes = Buffer.from(JSON.stringify(state));
      if (bytes.length > 20 * 1024 * 1024) throw new SafeError('The delivery journal exceeded its size limit.');
      let file;
      try {
        file = await open(temporary, 'wx', 0o600);
        await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
        await rename(temporary, target);
        const directory = await open(dirname(target instanceof URL ? fileURLToPath(target) : target), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      } finally { await file?.close(); await unlink(temporary).catch(() => {}); }
    },
  };
}
// Native calls may run in separate processes. A dead process's lock is retained
// for two minutes so a bounded 60-second CLI child can finish after abrupt exit.
export async function withJournalLock(path, work, now = () => Date.now()) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let file;
  try { file = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw new SafeError('Cannot acquire the helper delivery lock.');
    let reclaimer;
    try { reclaimer = await open(path + '.reclaim', 'wx', 0o600); }
    catch { throw new SafeError('The helper is busy recovering a lock. Retry later.'); }
    try {
      // Re-read while holding the reclaim guard, so a contender cannot remove a
      // fresh lock another process acquired after the original stale check.
      const lock = await readPrivateJson(path, 2048).catch(() => null);
      if (!lock || !Number.isInteger(lock.pid) || !Number.isFinite(lock.at)) throw new SafeError('Invalid helper lock; inspect it before retrying.');
      let alive = true;
      try { process.kill(lock.pid, 0); } catch (error) { alive = error.code !== 'ESRCH'; }
      if (alive || now() - lock.at < 120000) throw new SafeError('The helper is busy or recovering from an interrupted call. Retry later.');
      const stale = path + '.' + randomUUID() + '.stale';
      await rename(path, stale); await unlink(stale);
      try { file = await open(path, 'wx', 0o600); } catch { throw new SafeError('The helper is busy. Retry later.'); }
    } finally { await reclaimer.close(); await unlink(path + '.reclaim').catch(() => {}); }

  }
  const stamp = JSON.stringify({ pid: process.pid, at: now() });
  await file.writeFile(stamp); await file.close();
  const heartbeat = setInterval(async () => {
    let handle;
    try { handle = await open(path, 'r+'); await handle.writeFile(JSON.stringify({ pid: process.pid, at: now() })); } catch {}
    finally { await handle?.close().catch(() => {}); }
  }, 15000);
  heartbeat.unref();
  try { return await work(); }
  finally { clearInterval(heartbeat); await unlink(path).catch(() => {}); }
}
