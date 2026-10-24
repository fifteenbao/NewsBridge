import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTableUrl } from '../src/lib/table-url.js';
import { formatDiagnostic } from '../src/lib/diagnostics.js';
import { area, event } from '../test-support/chrome-mock.js';

// Interaction test against the real options module; no visual/browser claim.
test('settings pair with approval, use one language selector and group provider links without parsed-ID inputs', async t => {
  const original = { chrome: globalThis.chrome, document: globalThis.document, location: globalThis.location, addEventListener: globalThis.addEventListener };
  const viewEvents = {}; globalThis.addEventListener = (name, fn) => { viewEvents[name] = fn; };
  t.after(() => Object.assign(globalThis, original));
  class Element {
    constructor() { this.style = {}; this.children = []; this.value = ''; this.textContent = ''; this.disabled = false; this.checked = false; this.listeners = {}; this.attrs = {}; this.classList = { add() {}, remove() {} }; }
    setAttribute(k,v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; } removeAttribute(k) { delete this.attrs[k]; }
    append(...values) { this.children.push(...values); } appendChild(value) { this.children.push(value); } replaceChildren(...values) { this.children = values; } focus() {} scrollIntoView() {}
    addEventListener(name, fn) { this.listeners[name] = fn; }
  }
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const version = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8')).version;
  const html = await readFile(new URL('../src/options.html', import.meta.url), 'utf8');
  const translatable = [];
  for (const tag of html.matchAll(/<[^>]+data-i18n(?:-placeholder)?="[^"]+"[^>]*>/g)) {
    const id = tag[0].match(/\bid="([^"]+)"/)?.[1];
    const node = id ? el(id) : new Element();
    for (const attr of tag[0].matchAll(/(data-i18n(?:-placeholder)?)="([^"]+)"/g)) node.setAttribute(attr[1], attr[2]);
    translatable.push(node);
  }
  globalThis.document = { documentElement: { lang: 'en' }, querySelectorAll: selector => translatable.filter(node => node.getAttribute(selector.slice(1, -1))), getElementById: el, createElement: () => new Element(), createElementNS: () => new Element(), createTextNode: text => text };
  globalThis.location = { hash: '' };
  let operatorApproved = false, permissionGranted = true, connected = false, saved = false, provider = 'database', lastSaved, calls = [];
  const local = { connectionEndpoint: 'https://connection.example.com/readflow/', items: [
    { id: 'unread', title: 'Unread', url: 'https://example.com/a', read: false, savedAt: '2026-10-14T00:00:00Z' },
    { id: 'read', title: 'Read', url: 'https://example.com/b', read: true, status: '已读', savedAt: '2026-10-14T00:00:00Z' },
    { id: 'skip', title: 'Skip', url: 'https://example.com/c', read: true, status: '跳过', savedAt: '2026-10-14T00:00:00Z' },
  ] };
  const status = () => ({ ok: true, connected, protocolVersion: 1, configuration: { storageProvider: provider, baseToken: 'baseTest', articleTableId: 'tblTest', reminderTime: lastSaved?.reminderTime || '10:00', chatId: 'oc_reminders', remindersAvailable: true, remindersEnabled: lastSaved?.remindersEnabled ?? true, timeZone: 'Asia/Shanghai', language: lastSaved?.language || 'en' } });
  globalThis.chrome = {
    permissions: { request: async () => permissionGranted, contains: async () => true, remove: async () => true },
    storage: { local: area(local), onChanged: event() },
    i18n: { getUILanguage: () => 'en-US' },
    runtime: { getManifest: () => ({ version }), sendMessage: async message => {
      calls.push(message);
      if (message.type === 'PAIR_STATUS') return { ok: true, approved: saved, status: saved ? 'approved' : 'unpaired', baseUrl: local.connectionEndpoint || '' };
      if (message.type === 'PAIR_REQUEST') return { ok: true, status: operatorApproved ? 'approved' : 'pending', fingerprint: 'f'.repeat(64), pairId: 'a'.repeat(36) };
      if (message.type === 'VALIDATE_CONNECTION') {
        if (message.accessKey === 'bad') return { ok: false, error: formatDiagnostic({ code: 'KEY_INVALID', stage: 'identity' }) };
        if (message.accessKey === 'wrong-origin') return { ok: false, error: formatDiagnostic({ code: 'ORIGIN_DENIED', stage: 'identity' }) };
        if (message.tableUrl?.includes('/wiki/wikiDoc')) return { ok: false, error: formatDiagnostic({ code: 'LINK_NOT_BITABLE', stage: 'health.wiki.resolve' }) };
        provider = message.provider || 'database'; connected = true;
        const result = status();
        if (message.tableUrl?.includes('/wiki/')) result.resolvedTable = { url: parseTableUrl(message.tableUrl).url, baseToken: 'baseTest', articleTableId: 'tblTest', base: 'baseTest/tblTest', source: 'wiki-node' };
        return result;
      }
      if (message.type === 'DISCONNECT') { connected = false; saved = false; local.items = []; local.connectionEndpoint = ''; return { ok: true }; }
      if (message.type === 'CONNECTION_STATUS') return status();
      if (message.type === 'PENDING') return { ok: true, pending: null };
      if (message.type === 'SAVE_SETTINGS') { saved = true; lastSaved = message.settings; local.connectionEndpoint = lastSaved.connectionUrl; return { ok: true, settings: lastSaved }; }
      return { ok: true };
    } },
  };
  const drain = () => new Promise(resolve => setImmediate(resolve));
  await import('../src/options.js'); await drain();
  assert.equal(el('settings').hidden, false); assert.equal(el('home').hidden, true);
  assert.equal(el('reading-list').hidden, true); assert.equal(el('list').children.length, 1);
  assert.match(el('home-counts').textContent, /1 条未读.*1 条已读.*1 条跳过/);
  location.hash = '#reading-list'; viewEvents.hashchange();
  assert.equal(el('settings').hidden, true); assert.equal(el('reading-list').hidden, false);
  location.hash = '#settings'; viewEvents.hashchange();
  assert.match(el('pair-status').textContent, /未配对/); assert.equal(el('sync').disabled, true);
  assert.ok(el('connection-meta').textContent.includes(version));
  assert.doesNotMatch(html, /id="(?:provider|tableUrl)"/);
  assert.equal(el('export-table').disabled, true);
  await el('check-connection').listeners.click(); assert.match(el('pair-status').textContent, /等待服务端/);
  operatorApproved = true; await el('check-connection').listeners.click();
  assert.equal(el('chatId').value, 'oc_reminders');
  await el('save').listeners.click(); await drain();
  assert.equal(el('sync').disabled, false); assert.equal(el('export-csv').disabled, false);
  const beforeLanguageChange = calls.length;
  el('ui-language').value = 'zh'; await el('ui-language').listeners.change();
  assert.equal(document.documentElement.lang, 'zh'); assert.equal(local.uiLanguage, 'zh');
  assert.equal(calls.length, beforeLanguageChange);
  await el('save').listeners.click(); assert.equal(lastSaved.language, 'zh');
  assert.equal(el('check-connection').textContent, '配对并检查 / 重试');
  assert.match(el('pair-status').textContent, /已配对/);
  assert.match(el('chatId').getAttribute('placeholder'), /需要提醒/);
  assert.match(el('schedule-note').textContent, /连接端状态/);
  el('ui-language').value = 'en'; await el('ui-language').listeners.change();
  assert.equal(el('check-connection').textContent, 'Pair and check / Retry');
  await el('save').listeners.click(); assert.equal(lastSaved.language, 'en');
  el('remindersEnabled').checked = false; el('remindersEnabled').listeners.change(); await el('save').listeners.click();
  assert.equal(lastSaved.remindersEnabled, false);
  assert.ok(calls.some(c => c.type === 'VALIDATE_CONNECTION'));
  await el('disconnect').listeners.click();  assert.match(el('list-count').textContent, /0/);
  el('connectionUrl').value = 'https://connection.example.com/readflow/';
  assert.doesNotMatch(html, /value="google"/);
  await el('check-connection').listeners.click();
  assert.equal(calls.findLast(c => c.type === 'VALIDATE_CONNECTION').provider, 'database');
  el('reminderTime').value = '08:45'; el('reminderTime').listeners.change(); el('timeZone').value = 'Europe/London'; el('timeZone').listeners.change();
  await el('save').listeners.click(); assert.equal(lastSaved.provider, 'database'); assert.equal(lastSaved.reminderTime, '08:45'); assert.equal(lastSaved.timeZone, 'Europe/London');
  assert.match(el('schedule-note').textContent, /08:45/);
  el('reminderTime').value = '25:00'; await el('save').listeners.click(); assert.equal(el('reminderTime').attrs['aria-invalid'], 'true');
  assert.equal(el('connectionUrl').value, 'https://connection.example.com/readflow/');
  el('connectionUrl').value = 'https://other.example.com/library/'; el('connectionUrl').listeners.input();
  assert.equal(el('sync').disabled, true);
  permissionGranted = false; const beforeDenied = calls.length; await el('check-connection').listeners.click();
  assert.equal(calls.length, beforeDenied); assert.match(el('auth-status').textContent, /not granted/);
  el('connectionUrl').value = 'http://example.com/'; el('connectionUrl').listeners.input(); assert.equal(el('connectionUrl').attrs['aria-invalid'], 'true');

});


test('setup keeps the first action visible and advanced controls collapsed', async () => {
  const html = await readFile(new URL('../src/options.html', import.meta.url), 'utf8');
  assert.match(html, /<html lang="zh-CN">/);
  const advanced = html.indexOf('id="advanced-settings"');
  const firstAction = html.indexOf('id="copy-agent-task"');
  assert.ok(firstAction < html.indexOf('id="task-preview"'));
  assert.ok(html.indexOf('id="connectionUrl"') < advanced);
  assert.ok(html.indexOf('id="save"') < advanced);
  assert.doesNotMatch(html, /<details[^>]*id="advanced-settings"[^>]*\bopen\b/);
  for (const id of ['sync', 'disconnect', 'remindersEnabled', 'export-table', 'export-csv', 'connection-meta']) {
    assert.ok(html.indexOf(`id="${id}"`) > advanced, id);
  }
});
