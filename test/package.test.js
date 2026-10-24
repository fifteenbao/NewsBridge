import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildExtension } from '../scripts/build-extension.mjs';
import { area, event } from '../test-support/chrome-mock.js';

test('extension archives contain only installable assets, default offline and private exact-origin builds', async t => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'readflow-package-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const source = await readFile(new URL('../manifest.json', import.meta.url), 'utf8');
  const offline = await buildExtension({ outputRoot });
  assert.deepEqual(await readFile(offline.versionArchive), await readFile(offline.archive));
  const manifest = JSON.parse(await readFile(join(offline.directory, 'manifest.json'), 'utf8'));
  assert.ok(offline.versionArchive.endsWith(`readflow-V${manifest.version}.zip`));
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src https:;/);
  assert.deepEqual((await readdir(offline.directory)).sort(), ['LICENSE', 'icons', 'manifest.json', 'src']);
  const zip = await readFile(offline.archive), names = []; let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const bytes = zip.readUInt32LE(offset + 18), size = zip.readUInt16LE(offset + 26);
    names.push(zip.subarray(offset + 30, offset + 30 + size).toString());
    offset += 30 + size + bytes;
  }
  for (const module of ['batch', 'bitable', 'api-policy', 'notifications', 'messages', 'csv']) {
    assert.equal(names.includes(`src/lib/${module}.js`), false, `backend module ${module} must not ship to Chrome`);
  }
  assert.ok(names.includes('manifest.json')); assert.ok(names.includes('src/service-worker.js'));
  assert.equal(names.some(name => /private|connector|test|config\.json|(?:^|\/)\./.test(name)), false);
  const connected = await buildExtension({ baseUrl: 'https://connection.example.com/readflow/', outputRoot });
  const configured = JSON.parse(await readFile(join(connected.directory, 'manifest.json'), 'utf8'));
  assert.deepEqual(configured.host_permissions, ['https://connection.example.com/*']);
  assert.match(await readFile(join(connected.directory, 'src/lib/connection-config.js'), 'utf8'), /https:\/\/connection.example.com\/readflow\//);
  assert.equal(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'), source);
  for (const baseUrl of ['http://example.com', 'https://example.com/path?token=value', 'https://user:secret@example.com', 'https://localhost', 'https://example.com/%2e%2e/']) {
    await assert.rejects(buildExtension({ baseUrl, outputRoot }));
  }
});

test('offline installed worker saves captures and settings without a connection or error badge', async t => {
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, original));
  const outputRoot = await mkdtemp(join(tmpdir(), 'readflow-offline-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  await writeFile(join(outputRoot, 'package.json'), '{"type":"module"}');
  const built = await buildExtension({ outputRoot });
  const local = {}, badges = [], titles = [], alarms = new Map();
  globalThis.fetch = () => assert.fail('offline must not fetch');
  globalThis.chrome = {
    storage: { local: area(local) },
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, onInstalled: event(), onStartup: event(), onMessage: event() },
    alarms: { onAlarm: event(), getAll: async () => [], get: async name => alarms.get(name), clear: async name => alarms.delete(name), create: async (name, value) => alarms.set(name, value) },
    action: { onClicked: event(), setTitle: async value => titles.push(value.title), setBadgeText: async value => badges.push(value.text), setBadgeBackgroundColor: async () => {} },
    contextMenus: { onClicked: event(), removeAll: fn => fn(), create: () => {} }, tabs: { create: async () => {} },
  };
  await import(pathToFileURL(join(built.directory, 'src/service-worker.js')));
  const send = message => new Promise(resolve => chrome.runtime.onMessage.emit(message,
    { id: 'test', frameId: 0, url: chrome.runtime.getURL('src/options.html') }, resolve));
  const popupStatus = await new Promise(resolve => chrome.runtime.onMessage.emit({ type: 'POPUP_STATUS' },
    { id: 'test', frameId: 0, url: chrome.runtime.getURL('src/popup.html') }, resolve));
  assert.deepEqual(popupStatus, { ok: true, connected: false, localOnly: false });
  chrome.runtime.onStartup.emit();
  await send({ type: 'CONNECTION_STATUS' });
  chrome.action.onClicked.emit({ id: 1, title: 'A video', url: 'https://example.com/video' });
  await send({ type: 'CONNECTION_STATUS' });
  assert.equal(local.items.length, 1);
  assert.equal(badges.at(-1), '✓');
  assert.match(titles.at(-1), /Saved locally/);
  chrome.action.onClicked.emit({ id: 1, title: 'A video', url: 'https://example.com/video' });
  await send({ type: 'CONNECTION_STATUS' });
  assert.equal(local.items.length, 1);
  assert.equal(badges.at(-1), '✓');
  assert.equal((await send({ type: 'SET_READ', id: local.items[0].id, read: true })).ok, true);
  assert.equal(local.items[0].read, true);
  assert.equal((await send({ type: 'SAVE_SETTINGS', settings: { language: 'zh' } })).ok, true);
  assert.equal(local.settings.language, 'zh'); assert.equal(badges.includes('!'), false);
  assert.equal(local.knowledgeSync.enabled, false);
  for (const url of ['chrome://extensions', 'about:blank', undefined]) {
    chrome.action.onClicked.emit({ id: 2, url });
    await send({ type: 'CONNECTION_STATUS' });
    assert.equal(badges.at(-1), '!');
    assert.match(titles.at(-1), /This page cannot be saved/);
    assert.equal(local.items.length, 1);
  }
});
