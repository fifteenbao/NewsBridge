import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTICLE_FIELDS } from '../src/lib/bitable.js';
import { createServerRuntime } from '../server/runtime.js';
import { area, event } from '../test-support/chrome-mock.js';

test('worker syncs capture/status through HTTPS; server exclusively owns daily reminders', async t => {
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch, Date: globalThis.Date };
  let time = new original.Date(2026, 9, 12, 9).getTime();
  globalThis.Date = class extends original.Date {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  };
  t.after(() => Object.assign(globalThis, original));
  const local = { settings: { language: 'en' }, serverAccessKey: 't'.repeat(43) }, session = {};
  let journal = { version: 1, scopes: {} };
  const config = { appId: 'cli_test', accountId: 'ou_user', baseToken: 'baseTest', articleTableId: 'tblTest',
    chatId: 'oc_test', timeZone: 'Asia/Shanghai', language: 'en', schema: 'briefing', notifications: { chatId: 'oc_test' } };
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
  const records = [{ record_id: 'recInitial', fields: { 标题: 'Initial', 链接: { link: 'https://example.com/initial' }, 阅读状态: '待阅读' } }];
  const sends = [];
  const run = async (method, path, { data } = {}) => {
    if (path.endsWith('/user_info')) return { code: 0, data: { open_id: config.accountId } };
    if (path.endsWith('/fields')) return { code: 0, data: { items: Object.entries(ARTICLE_FIELDS).map(([field_name, type]) => ({ field_name, type })) } };
    if (path.endsWith('/messages')) {
      sends.push(data);
      return { code: 0, data: { message_id: `om_${sends.length}` } };
    }
    if (method === 'PUT') {
      const id = path.split('/').at(-1);
      Object.assign(records.find(record => record.record_id === id).fields, data.fields);
      return { code: 0, data: {} };
    }
    if (method === 'POST') {
      const record = { record_id: `rec${records.length}`, fields: data.fields };
      records.push(record);
      return { code: 0, data: { record } };
    }
    return { code: 0, data: { items: records } };
  };
  const runtime = createServerRuntime({ config, run, now: () => time, exclusive: work => work(),
    store: { load: async () => structuredClone(journal), save: async value => { journal = structuredClone(value); } } });
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).origin, 'https://newsbridge.example.com');
    return Response.json(await runtime.dispatch(new URL(url).pathname.slice(4), JSON.parse(options.body)));
  };
  await import('../src/service-worker.js');
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
  assert.equal(local.feishuAuthPaused, undefined);
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
