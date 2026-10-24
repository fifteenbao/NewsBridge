import test from 'node:test';
import assert from 'node:assert/strict';
import { seedApprovedBrowser } from '../test-support/pairing.js';
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
  const local = { settings: { language: 'en' } }, session = {};
  const alarms = new Map(), badges = [], titles = [], opened = [];
  globalThis.chrome = {
    permissions: { contains: async () => true, remove: async () => true },
    storage: { local: area(local), session: area(session) },
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`,
      onInstalled: event(), onStartup: event(), onMessage: event() },
    alarms: { onAlarm: event(), getAll: async () => [...alarms.values()], get: async name => alarms.get(name),
      clear: async name => alarms.delete(name), create: async (name, info) => alarms.set(name, { name,
        scheduledTime: info.when || time + info.periodInMinutes * 60000, ...info }) },
    action: { onClicked: event(), setTitle: async value => titles.push(value.title), setBadgeText: async value => badges.push(value.text), setBadgeBackgroundColor: async () => {} },
    contextMenus: { onClicked: event(), removeAll: callback => callback(), create: () => {} },
    tabs: { create: async value => opened.push(value.url) },
  };
  await seedApprovedBrowser(chrome.storage.local, 'https://connection.example.com/');
  const f = fixture({ clock: () => time, captureMetadata: true });
  const { records, sends, runtime } = f;
  let unavailable = false, omitMetadataAcknowledgement = false;
  globalThis.fetch = async (url, options) => {
    if (unavailable) throw new Error('connection unavailable');
    assert.equal(new URL(url).origin, 'https://connection.example.com');
    const result = await runtime.dispatch(new URL(url).pathname.slice(4), JSON.parse(options.body));
    if (omitMetadataAcknowledgement) delete result.metadataBindings;
    return Response.json(result);
  };
  const outputRoot = await mkdtemp(join(tmpdir(), 'readflow-worker-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  await writeFile(join(outputRoot, 'package.json'), '{"type":"module"}');
  const built = await buildExtension({ baseUrl: 'https://connection.example.com', outputRoot });
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
  chrome.runtime.onInstalled.emit({ reason: 'install' }); await drain();
  assert.equal(opened.at(-1), chrome.runtime.getURL('src/options.html') + '#settings');
  const saveSettings = settings => new Promise(resolve => chrome.runtime.onMessage.emit({ type: 'SAVE_SETTINGS', settings },
    { id: 'test', frameId: 0, url: chrome.runtime.getURL('src/options.html') }, resolve));
  assert.equal((await saveSettings({ provider: 'feishu', language: 'en', tableUrl: 'https://workspace.feishu.cn/base/baseTest?table=tblTest&view=vewTest' })).ok, true);
  assert.equal(local.settings.tableUrl, 'https://workspace.feishu.cn/base/baseTest?table=tblTest');
  const previousSettings = structuredClone(local.settings);
  assert.equal((await saveSettings({ provider: 'feishu', language: 'zh', tableUrl: 'https://workspace.feishu.cn/base/baseOther?table=tblOther' })).ok, false);
  assert.deepEqual(local.settings, previousSettings);
  const keyStatus = await new Promise(resolve => chrome.runtime.onMessage.emit({ type: 'PAIR_STATUS' },
    { id: 'test', frameId: 0, url: chrome.runtime.getURL('src/options.html') }, resolve));
  assert.equal(keyStatus.approved, true);
  assert.equal(Object.hasOwn(keyStatus, 'privateKey'), false);
  assert.equal(JSON.stringify(keyStatus).includes(local.pairingDevices['https://connection.example.com/'].privateKey.d), false);
  assert.equal(local.connectionAccessKey, '');
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
  unavailable = true;
  chrome.action.onClicked.emit({ id: 3, title: 'Offline capture', url: 'https://example.com/offline-capture' });
  await drain();
  assert.ok(local.items.some(item => item.url === 'https://example.com/offline-capture'));
  assert.equal(records.some(record => record.fields.标题 === 'Offline capture'), false);
  assert.equal(badges.at(-1), '!');
  assert.match(titles.at(-1), /Saved locally — sync failed/);
  chrome.tabs.query = async () => [{ url: 'https://example.com/popup-capture', title: 'Popup capture' }];
  const popupSend = message => new Promise(resolve => chrome.runtime.onMessage.emit(message,
    { id: 'test', url: chrome.runtime.getURL('src/popup.html') }, resolve));
  const popupResult = await popupSend({ type: 'CAPTURE_PAGE' });
  assert.equal(popupResult.saved, true); assert.equal(popupResult.synced, false);
  assert.ok(local.items.some(item => item.title === 'Popup capture'));
  assert.equal((await popupSend({ type: 'CAPTURE_PAGE', url: 'https://untrusted.example.com' })).ok, false);
  let popupReplied = false;
  assert.equal(handler({ type: 'SAVE_SETTINGS', settings: { language: 'zh' } },
    { id: 'test', frameId: 0, url: chrome.runtime.getURL('src/popup.html') }, () => { popupReplied = true; }), undefined);
  assert.equal(popupReplied, false);
  const status = value => new Promise(resolve => chrome.runtime.onMessage.emit({ type: 'SET_STATUS', id: captured.id, status: value },
    { id: 'test', url: chrome.runtime.getURL('src/options.html') }, resolve));
  const preserved = structuredClone(local.items);
  assert.equal((await status('跳过')).ok, false); assert.deepEqual(local.items, preserved);
  unavailable = false;
  assert.equal((await status('跳过')).ok, true);
  assert.equal(records[1].fields.阅读状态, '跳过');
  assert.equal(local.items.find(item => item.id === captured.id).status, '跳过');
  assert.equal(local.items.find(item => item.id === captured.id).read, true);
  assert.equal((await status('待阅读')).ok, true);
  assert.equal(local.items.find(item => item.id === captured.id).read, false);
  const context = await popupSend({ type: 'CAPTURE_CONTEXT' }); assert.equal(context.url, 'https://example.com/popup-capture');
  assert.ok(context.tagOptions.includes('AI'));
  const metadata = { tags: ['AI', 'Product'], remark: 'Compare the evidence' };
  assert.equal((await popupSend({ type: 'CAPTURE_PAGE', metadata, expectedUrl: context.url })).synced, true);
  const remote = records.find(record => record.fields.链接?.link === context.url);
  assert.deepEqual(remote.fields.标签, ['AI', 'Product']); assert.equal(remote.fields.备注, 'Compare the evidence');
  assert.equal(local.items.find(item => item.url === context.url).metadataUpdate, undefined);
  assert.equal((await popupSend({ type: 'CAPTURE_PAGE', metadata, expectedUrl: 'https://example.com/other' })).ok, false);
  assert.equal((await popupSend({ type: 'CAPTURE_PAGE', metadata: { note: 'not allowed' } })).ok, false);
  omitMetadataAcknowledgement = true;
  const unconfirmed = await popupSend({ type: 'CAPTURE_PAGE', metadata: { remark: 'Unconfirmed edit' }, expectedUrl: context.url });
  assert.equal(unconfirmed.saved, true); assert.equal(unconfirmed.synced, false); assert.match(unconfirmed.error, /still pending/);
  assert.ok(local.items.find(item => item.url === context.url).metadataUpdate);
  omitMetadataAcknowledgement = false;
  await new Promise(resolve => chrome.runtime.onMessage.emit({ type: 'SYNC' }, { id: 'test', url: chrome.runtime.getURL('src/options.html') }, resolve));
  assert.equal(local.items.find(item => item.url === context.url).metadataUpdate, undefined);

});
