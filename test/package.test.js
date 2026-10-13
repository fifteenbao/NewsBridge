import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildExtension } from '../scripts/build-extension.mjs';
import { area, event } from '../test-support/chrome-mock.js';

test('extension archives contain only installable assets, default offline and private exact-origin builds', async t => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'newsbridge-package-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const source = await readFile(new URL('../manifest.json', import.meta.url), 'utf8');
  const offline = await buildExtension({ outputRoot });
  const manifest = JSON.parse(await readFile(join(offline.directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.host_permissions, undefined);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none';/);
  assert.deepEqual((await readdir(offline.directory)).sort(), ['LICENSE', 'icons', 'manifest.json', 'src']);
  const zip = await readFile(offline.archive), names = []; let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const bytes = zip.readUInt32LE(offset + 18), size = zip.readUInt16LE(offset + 26);
    names.push(zip.subarray(offset + 30, offset + 30 + size).toString());
    offset += 30 + size + bytes;
  }
  assert.ok(names.includes('manifest.json')); assert.ok(names.includes('src/service-worker.js'));
  assert.equal(names.some(name => /private|connector|test|config\.json/.test(name)), false);
  const connected = await buildExtension({ origin: 'https://connection.example.com', outputRoot });
  const configured = JSON.parse(await readFile(join(connected.directory, 'manifest.json'), 'utf8'));
  assert.deepEqual(configured.host_permissions, ['https://connection.example.com/*']);
  assert.match(await readFile(join(connected.directory, 'src/lib/connection-config.js'), 'utf8'), /https:\/\/connection.example.com/);
  assert.equal(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'), source);
  for (const origin of ['http://example.com', 'https://example.com/path', 'https://user:secret@example.com', 'https://localhost', 'https://example.com/']) {
    await assert.rejects(buildExtension({ origin, outputRoot }));
  }
});

test('offline installed worker saves captures and settings without a connection or error badge', async t => {
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, original));
  const outputRoot = await mkdtemp(join(tmpdir(), 'newsbridge-offline-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  await writeFile(join(outputRoot, 'package.json'), '{"type":"module"}');
  const built = await buildExtension({ outputRoot });
  const local = {}, badges = [], alarms = new Map();
  globalThis.fetch = () => assert.fail('offline must not fetch');
  globalThis.chrome = {
    storage: { local: area(local) },
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, onInstalled: event(), onStartup: event(), onMessage: event() },
    alarms: { onAlarm: event(), getAll: async () => [], get: async name => alarms.get(name), clear: async name => alarms.delete(name), create: async (name, value) => alarms.set(name, value) },
    action: { onClicked: event(), setTitle: async () => {}, setBadgeText: async value => badges.push(value.text), setBadgeBackgroundColor: async () => {} },
    contextMenus: { onClicked: event(), removeAll: fn => fn(), create: () => {} }, tabs: { create: async () => {} },
  };
  await import(pathToFileURL(join(built.directory, 'src/service-worker.js')));
  const send = message => new Promise(resolve => chrome.runtime.onMessage.emit(message,
    { id: 'test', frameId: 0, url: chrome.runtime.getURL('src/options.html') }, resolve));
  chrome.runtime.onStartup.emit();
  await send({ type: 'CONNECTION_STATUS' });
  chrome.action.onClicked.emit({ id: 1, title: 'A video', url: 'https://example.com/video' });
  await send({ type: 'CONNECTION_STATUS' });
  assert.equal(local.items.length, 1);
  assert.equal((await send({ type: 'SET_READ', id: local.items[0].id, read: true })).ok, true);
  assert.equal(local.items[0].read, true);
  assert.equal((await send({ type: 'SAVE_SETTINGS', settings: { language: 'zh' } })).ok, true);
  assert.equal(local.settings.language, 'zh'); assert.equal(badges.includes('!'), false);
  assert.equal(local.knowledgeSync.enabled, false);
});
