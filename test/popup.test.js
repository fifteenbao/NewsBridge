import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { area } from '../test-support/chrome-mock.js';

test('icon popup offers home, collection and settings, and captures through the trusted worker', async t => {
  const original = { chrome: globalThis.chrome, document: globalThis.document, window: globalThis.window };
  t.after(() => Object.assign(globalThis, original));
  class Element {
    constructor() { this.textContent = ''; this.disabled = false; this.attrs = {}; this.events = {}; }
    getAttribute(key) { return this.attrs[key]; } addEventListener(name, work) { this.events[name] = work; }
  }
  const elements = new Map(), translateNodes = [];
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const html = await readFile(new URL('../src/popup.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<[^>]+data-i18n="([^"]+)"[^>]*>/g)) {
    const id = match[0].match(/\bid="([^"]+)"/)?.[1], node = id ? get(id) : new Element();
    node.attrs['data-i18n'] = match[1]; translateNodes.push(node);
  }
  let result = { ok: true, saved: true, synced: false }, opened = [], sent = [];
  globalThis.document = { documentElement: {}, querySelectorAll: () => translateNodes, getElementById: get };
  globalThis.window = { close() {} };
  globalThis.chrome = { storage: { local: area({ uiLanguage: 'zh' }) },
    tabs: { create: async info => opened.push(info.url) }, runtime: { getURL: path => 'chrome-extension://test/' + path,
      sendMessage: async message => { sent.push(message); return result; } } };
  await import('../src/popup.js');
  assert.equal(get('open-home').textContent, '首页'); assert.equal(get('open-collection').textContent, '收藏'); assert.equal(get('open-settings').textContent, '设置');
  for (const id of ['open-home', 'open-collection', 'open-settings']) await get(id).events.click();
  assert.deepEqual(opened, ['chrome-extension://test/src/options.html', 'chrome-extension://test/src/options.html#reading-list', 'chrome-extension://test/src/options.html#settings']);
  await get('capture').events.click(); assert.deepEqual(sent[0], { type: 'CAPTURE_PAGE' }); assert.match(get('capture-status').textContent, /本机收藏/);
  result = { ok: true, saved: true, synced: true }; await get('capture').events.click(); assert.match(get('capture-status').textContent, /同步到表格/);
  result = { ok: false, error: 'This page cannot be saved. Open an HTTP(S) article or video page and try again.' };
  await get('capture').events.click(); assert.match(get('capture-status').textContent, /无法收藏/); assert.equal(get('capture').disabled, false);
});
