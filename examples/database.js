import { readingNote } from '../src/lib/reading-note.js';
// Single-host SQLite source of truth. No Feishu calls, listeners or timers.
import { DatabaseSync } from 'node:sqlite';
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SafeError, isSafeArticleUrl } from '../src/lib/security.js';
import { metadataUpdate } from '../src/lib/capture-metadata.js';

export async function openLibrary(stateDir, { initialize = false, now = () => Date.now() } = {}) {
  const privateStat = (s, directory = false) => {
    if (!(directory ? s.isDirectory() : s.isFile()) || s.mode & 0o077 || (!directory && s.nlink !== 1) || process.getuid && s.uid !== process.getuid()) throw new SafeError('Database requires private ownership and permissions.');
  };
  privateStat(await lstat(stateDir), true);
  const path = join(stateDir, 'readflow.sqlite');
  if (initialize) {
    try { const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); await file.close(); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  privateStat(await lstat(path));
  for (const suffix of ['-journal', '-wal', '-shm']) {
    try { privateStat(await lstat(path + suffix)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  try {
    if (initialize) db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS edits (id TEXT PRIMARY KEY, article_id TEXT NOT NULL, fields TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runtime_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    `);
    if (initialize) {
      db.prepare('INSERT OR IGNORE INTO metadata VALUES (?, ?)').run('libraryId', randomUUID().replaceAll('-', ''));
      db.prepare('INSERT OR IGNORE INTO runtime_state VALUES (1, ?)').run(JSON.stringify({ version: 1, scopes: {} }));
    }
    const libraryId = db.prepare('SELECT value FROM metadata WHERE key=?').get('libraryId')?.value;
    if (!/^[a-f0-9]{32}$/.test(libraryId || '')) throw new SafeError('Initialize the ReadFlow database before starting.');
    db.exec('CREATE TABLE IF NOT EXISTS reading_events (id INTEGER PRIMARY KEY, article_id TEXT NOT NULL, status TEXT NOT NULL, at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, data TEXT NOT NULL);');
    const identity = { connectionId: `db:${libraryId}`, base: `${libraryId}/library` };
    const list = () => db.prepare('SELECT data FROM articles ORDER BY rowid').all().map(row => JSON.parse(row.data));
    const get = id => { const row = db.prepare('SELECT data FROM articles WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; };
    const put = article => db.prepare('INSERT INTO articles VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(article.recordId, article.url, JSON.stringify(article));
    const transaction = work => { db.exec('BEGIN IMMEDIATE'); try { const value = work(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } };
    // Consolidate old note/remark text atomically; reopening never appends it twice.
    transaction(() => {
      for (const article of list()) {
        if (Object.hasOwn(article, 'note')) {
          article.remark = readingNote(article); delete article.note; put(article);
        }
      }
    });
    const transition = (article, status, time) => {
      if (article.status !== status) {
        db.prepare('INSERT INTO reading_events(article_id,status,at) VALUES (?,?,?)').run(article.recordId, status, time);
        article.readAt = status === '已读' ? time : null;
      }
      article.status = status; article.read = status !== '待阅读'; delete article.snoozedUntil;
    };
    return {
      readingEvents: () => db.prepare('SELECT article_id AS recordId, status, at FROM reading_events ORDER BY id').all(),
      reviews: () => db.prepare('SELECT data FROM reviews ORDER BY rowid DESC').all().map(row => JSON.parse(row.data)),
      saveReview(review) { return transaction(() => {
        const existing = db.prepare('SELECT data FROM reviews WHERE id=?').get(review.id);
        if (existing) { const saved = JSON.parse(existing.data); if (saved.digest !== review.digest || saved.agentId !== review.agentId) throw new SafeError('Review request ID reused.'); return saved; }
        if (db.prepare('SELECT count(*) n FROM reviews').get().n >= 10000) throw new SafeError('Review capacity reached.');
        const saved = { ...review, savedAt: now() }; db.prepare('INSERT INTO reviews VALUES (?,?)').run(saved.id, JSON.stringify(saved)); return saved;
      }); },
      identity, libraryId, list, get, close: () => db.close(),
      store: {
        async load() { return JSON.parse(db.prepare('SELECT data FROM runtime_state WHERE id=1').get().data); },
        async save(value) { const text = JSON.stringify(value); if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new SafeError('State exceeds capacity.'); db.prepare('UPDATE runtime_state SET data=? WHERE id=1').run(text); },
      },
      sync(items = []) {
        if (!Array.isArray(items) || items.length > 5000) throw new SafeError('At most 5000 captures per sync.');
        for (const item of items) {
          if (!item || typeof item.id !== 'string' || item.id.length > 512 || !isSafeArticleUrl(item.url) || !Number.isFinite(Date.parse(item.savedAt)) || typeof item.title !== 'string' || item.title.length > 1000) throw new SafeError('Invalid capture.');
          if (item.metadataUpdate !== undefined) metadataUpdate(item.metadataUpdate);
        }
        return transaction(() => {
          const bindings = [], metadataBindings = []; let created = 0;
          for (const item of items) {
            let article;
            if (item.feishuRecordId && item.feishuBase === identity.base) article = get(item.feishuRecordId);
            else { const row = db.prepare('SELECT data FROM articles WHERE url=?').get(new URL(item.url).href); article = row ? JSON.parse(row.data) : null; }
            if (!article) {
              if (item.feishuRecordId && item.feishuBase === identity.base) continue;
              if (db.prepare('SELECT count(*) n FROM articles').get().n >= 10000) throw new SafeError('Library exceeds the 10000-item limit.');
              article = { recordId: 'rec' + randomUUID().replaceAll('-', ''), captureId: item.id, url: new URL(item.url).href,
                title: item.title || item.url, savedAt: Date.parse(item.savedAt), read: item.status === '跳过' || !!item.read,
                status: item.status === '跳过' ? '跳过' : item.read ? '已读' : '待阅读', readAt: null,
                tags: [], remark: '', topicIds: [] };
              created++;
            }
            if (item.metadataUpdate) {
              const edit = metadataUpdate(item.metadataUpdate), encoded = JSON.stringify(edit.fields);
              const previous = db.prepare('SELECT article_id, fields FROM edits WHERE id=?').get(edit.id);
              if (previous && (previous.article_id !== article.recordId || previous.fields !== encoded)) throw new SafeError('Capture edit identity was reused.');
              if (!previous) {
                Object.assign(article, edit.fields);
                db.prepare('INSERT INTO edits VALUES (?, ?, ?)').run(edit.id, article.recordId, encoded);
              }
              metadataBindings.push({ id: item.id, editId: edit.id });
            }
            put(article); bindings.push({ id: item.id, recordId: article.recordId });
          }
          const articles = list();
          return { created, bindings, metadataBindings, articles, topics: [], captureMetadata: { available: true, tagOptions: [...new Set(articles.flatMap(a => a.tags))] } };
        });
      },
      applyAction(eventId, id, action, time = now()) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId || '') || !['read', 'skip', 'later'].includes(action)) throw new SafeError('Invalid reading action.');
        return transaction(() => {
          if (db.prepare('SELECT id FROM actions WHERE id=?').get(eventId)) return { duplicate: true };
          const article = get(id); if (!article) throw new SafeError('Reading item not found.');
          if (action === 'later') { if (article.read) throw new SafeError('This item is already read or skipped.'); article.snoozedUntil = time + 86400000; }
          else transition(article, action === 'read' ? '已读' : '跳过', time);
          put(article); db.prepare('INSERT INTO actions VALUES (?)').run(eventId); return { duplicate: false };
        });
      },
      setStatus(id, status) {
        if (!['待阅读', '已读', '跳过'].includes(status)) throw new SafeError('Invalid reading status.');
        return transaction(() => { const article = get(id); if (!article) throw new SafeError('Reading item not found.'); transition(article, status, now()); put(article); return article; });
      },
    };
  } catch (error) { db.close(); throw error; }
}
