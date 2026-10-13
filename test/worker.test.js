import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../test-support/connector-fixture.js';
import { area, event } from '../test-support/chrome-mock.js';
import { buildExtension } from '../scripts/build-extension.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('worker syncs capture/status through HTTPS; external scheduler exclusively owns daily reminders', async t => {
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch, Date: globalThis.Date };
  let time = new original.Date(2026, 9, 12, 9).getTime();
  globalThis.Date = class extends original.Date {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  };
  t.after(() => Object.assign(globalThis, original));
  const local = { settings: { language: 'en' }, connectionAccessKey: 't'.repeat(43) }, session = {};
  const alarms = new Map();
  globalThis.chrome = {
    storage: { local: area(local), session: area(session) },
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`,
      onInstalled: event(), onStartup: event(), onMessage: event() },
    alarms: { onAlarm: event(), getAll: async () => [...alarms.values()], get: async name => alarms.get(name),
      clear: async name => alarms.delete(name), create: async (name, info) => alarms.set(name, { name,
        scheduledTime: info.when || time + info.periodInMinutes * 60000, ...info }) },
    action: { onClicked: event(), setTitle: async () => {}, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    contextMenus: { onClicked: event(), removeAll: callback => callback(), create: () => {} },
    tabs: { create: async () => {} },
  };
  const f = fixture({ clock: () => time });
  const { records, sends, runtime } = f;
  let unavailable = false;
  globalThis.fetch = async (url, options) => {
    if (unavailable) throw new Error('connection unavailable');
    assert.equal(new URL(url).origin, 'https://connection.example.com');
    return Response.json(await runtime.dispatch(new URL(url).pathname.slice(4), JSON.parse(options.body)));
  };
  const outputRoot = await mkdtemp(join(tmpdir(), 'newsbridge-worker-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  await writeFile(join(outputRoot, 'package.json'), '{"type":"module"}');
  const built = await buildExtension({ origin: 'https://connection.example.com', outputRoot });
  await import(pathToFileURL(join(built.directory, 'src/service-worker.js')));
  const drain = () => new Promise(resolve => chrome.runtime.onMessage.emit({ type: 'CONNECTION_STATUS' },
    { id: 'test', frameId: 0, url: chrome.runtime.getURL('src/options.html') }, resolve));
  await drain();
  const handler = chrome.runtime.onMessage.listeners[0];
  for (const sender of [
    { id: 'external', frameId: 0, url: chrome.runtime.getURL('src/options.html') },
    { id: 'test', frameId: 1, url: chrome.runtime.getURL('src/options.html') },
    { id: 'test', frameId: 0, url: chrome.runtime.getURL('src/options.html.evil') },
    { id: 'test', frameId: 0, url: 'https://untrusted.example/' },
  ]) {
    let replied = false;
    assert.equal(handler({ type: 'SYNC' }, sender, () => { replied = true; }), undefined);
    assert.equal(replied, false);
  }
  chrome.runtime.onStartup.emit(); await drain();
  assert.equal(sends.length, 0);
  assert.equal(alarms.has('daily-reading'), false);
  chrome.action.onClicked.emit({ id: 1, title: 'Captured', url: 'https://example.com/captured' }); await drain();
  assert.equal(records.length, 2);
  assert.equal(sends.length, 0);
  const captured = local.items.find(item => item.url === 'https://example.com/captured');
  const setRead = read => new Promise(resolve => chrome.runtime.onMessage.emit({ type: 'SET_READ', id: captured.id, read },
    { id: 'test', frameId: 0, url: chrome.runtime.getURL('src/options.html') }, resolve));
  assert.equal((await setRead(true)).ok, true);
  assert.equal(records[1].fields.阅读状态, '已读');
  assert.equal(local.items.find(item => item.id === captured.id).read, true);
  unavailable = true;
  const beforeFailure = structuredClone(local.items);
  assert.equal((await setRead(false)).ok, false);
  assert.deepEqual(local.items, beforeFailure);
  const previousKey = local.connectionAccessKey;
  const failedSettings = await new Promise(resolve => chrome.runtime.onMessage.emit(
    { type: 'SAVE_SETTINGS', settings: { language: 'zh', connectionAccessKey: 'b'.repeat(43) } },
    { id: 'test', frameId: 0, url: chrome.runtime.getURL('src/options.html') }, resolve));
  assert.equal(failedSettings.ok, false);
  assert.equal(local.connectionAccessKey, previousKey);
  assert.equal(local.settings.language, 'en');
  unavailable = false;
  assert.equal((await setRead(false)).ok, true);
  assert.equal(records[1].fields.阅读状态, '待阅读');
  assert.equal(sends.length, 0);
  time = new original.Date(2026, 9, 12, 10, 5).getTime();
  chrome.contextMenus.onClicked.emit({ menuItemId: 'sync-knowledge' }); await drain();
  assert.equal(sends.length, 0);
  chrome.alarms.onAlarm.emit({ name: 'daily-reading' }); await drain();
  assert.equal(sends.length, 0);
  assert.equal(records.every(record => record.fields.阅读状态 === '待阅读'), true);
  chrome.alarms.onAlarm.emit({ name: 'knowledge-sync' }); await drain();
  chrome.runtime.onStartup.emit(); await drain();
  assert.equal(sends.length, 0);
  records[0].fields.阅读状态 = '已读';
  time = new original.Date(2026, 9, 13, 11).getTime();
  chrome.runtime.onStartup.emit(); await drain();
  assert.equal(sends.length, 0);
  assert.equal(local.items.find(item => item.feishuRecordId === 'recInitial').read, true);
  assert.equal(alarms.has('daily-reading'), false);
});
