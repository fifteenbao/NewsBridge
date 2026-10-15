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
  let operatorApproved = false, permissionGranted = true, connected = false, saved = false, provider = 'feishu', lastSaved, calls = [];
  const local = { connectionEndpoint: 'https://connection.example.com/newsbridge/', items: [
    { id: 'unread', title: 'Unread', url: 'https://example.com/a', read: false, savedAt: '2026-10-14T00:00:00Z' },
    { id: 'read', title: 'Read', url: 'https://example.com/b', read: true, status: '已读', savedAt: '2026-10-14T00:00:00Z' },
    { id: 'skip', title: 'Skip', url: 'https://example.com/c', read: true, status: '跳过', savedAt: '2026-10-14T00:00:00Z' },
  ] };
  const status = () => ({ ok: true, connected, protocolVersion: 1, configuration: { storageProvider: provider, baseToken: provider === 'google' ? 'sheet_Test-1' : 'baseTest', articleTableId: provider === 'google' ? '0' : 'tblTest', reminderTime: lastSaved?.reminderTime || '10:00', chatId: 'oc_reminders', remindersAvailable: true, remindersEnabled: lastSaved?.remindersEnabled ?? true, timeZone: 'Asia/Shanghai', language: lastSaved?.language || 'en' } });
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
        provider = message.provider || 'feishu'; connected = true;
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
  assert.match(el('home-counts').textContent, /1 unread.*1 read.*1 skipped/);
  location.hash = '#reading-list'; viewEvents.hashchange();
  assert.equal(el('settings').hidden, true); assert.equal(el('reading-list').hidden, false);
  location.hash = '#settings'; viewEvents.hashchange();
  assert.match(el('pair-status').textContent, /Not paired/); assert.equal(el('sync').disabled, true);
  assert.ok(el('connection-meta').textContent.includes(version));
  assert.equal(el('table-link-label').textContent, 'Feishu Bitable link');
  el('tableUrl').value = 'https://workspace.feishu.cn/base/baseTest?table=tblTest'; el('tableUrl').listeners.input();
  assert.match(el('table-url-error').textContent, /Format valid/);
  assert.equal(el('chatId').value, '');
  el('tableUrl').value = 'invalid'; el('tableUrl').listeners.input();
  el('tableUrl').value = 'https://workspace.feishu.cn/base/baseTest?table=tblTest'; el('tableUrl').listeners.input();
  await el('check-connection').listeners.click(); assert.match(el('pair-status').textContent, /Waiting for server/); assert.match(el('pair-command').textContent, /pair-approve/);
  operatorApproved = true; await el('check-connection').listeners.click();
  assert.match(el('table-url-error').textContent, /Matches server configuration/);
  assert.equal(el('chatId').value, 'oc_reminders');
  el('tableUrl').value = 'https://workspace.feishu.cn/base/baseOther?table=tblOther'; el('tableUrl').listeners.input();
  assert.equal(el('chatId').value, 'oc_reminders');
  assert.match(el('table-url-error').textContent, /Does not match/);
  el('tableUrl').value = 'https://workspace.feishu.cn/base/baseTest?table=tblTest'; el('tableUrl').listeners.input();
  assert.equal(saved, false); assert.equal(el('sync').disabled, true);
  await el('save').listeners.click(); await drain();
  assert.match(el('pair-status').textContent, /Browser paired/); assert.equal(el('sync').disabled, false);
  el('tableUrl').value = 'https://my.feishu.cn/base/baseTest?from=from_copylink'; el('tableUrl').listeners.input();
  assert.match(el('table-id-source').textContent, /configured table in the same base/);
  el('tableUrl').value = 'https://my.feishu.cn/wiki/wikiTest?from=from_copylink'; el('tableUrl').listeners.input();
  assert.match(el('table-url-error').textContent, /Check the connection/);
  await el('check-connection').listeners.click();
  assert.equal(calls.findLast(message => message.type === 'VALIDATE_CONNECTION').tableUrl, 'https://my.feishu.cn/wiki/wikiTest');
  assert.equal(el('sync').disabled, false);
  el('tableUrl').value = 'https://my.feishu.cn/wiki/wikiDoc'; el('tableUrl').listeners.input();
  await el('check-connection').listeners.click();
  assert.match(el('table-url-error').textContent, /LINK_NOT_BITABLE/); assert.equal(el('sync').disabled, true);
  el('tableUrl').value = 'https://workspace.feishu.cn/base/baseTest?table=tblTest'; el('tableUrl').listeners.input();
  await el('check-connection').listeners.click();
  const beforeLanguageChange = calls.length;
  el('ui-language').value = 'zh'; await el('ui-language').listeners.change();
  assert.equal(document.documentElement.lang, 'zh'); assert.equal(local.uiLanguage, 'zh');
  assert.equal(calls.length, beforeLanguageChange);
  await el('save').listeners.click(); assert.equal(lastSaved.language, 'zh');
  assert.equal(el('check-connection').textContent, '配对并检查 / 重试');
  assert.match(el('pair-status').textContent, /已配对/);
  assert.match(el('table-url-error').textContent, /与连接配置一致/);
  assert.match(el('chatId').getAttribute('placeholder'), /需要提醒/);
  assert.match(el('schedule-note').textContent, /连接端状态/);
  el('ui-language').value = 'en'; await el('ui-language').listeners.change();
  assert.equal(el('check-connection').textContent, 'Pair and check / Retry');
  await el('save').listeners.click(); assert.equal(lastSaved.language, 'en');
  el('remindersEnabled').checked = false; el('remindersEnabled').listeners.change(); await el('save').listeners.click();
  assert.equal(lastSaved.remindersEnabled, false);
  assert.ok(calls.some(c => c.type === 'VALIDATE_CONNECTION'));
  await el('disconnect').listeners.click(); assert.equal(el('provider').disabled, false); assert.match(el('list-count').textContent, /0/);
  el('connectionUrl').value = 'https://connection.example.com/newsbridge/';
  el('provider').value = 'google'; el('provider').listeners.change();
  assert.equal(el('table-link-label').textContent, 'Google Sheets link');
  el('tableUrl').value = 'https://docs.google.com/spreadsheets/d/sheet_Test-1/edit#gid=0'; el('tableUrl').listeners.input();
  await el('check-connection').listeners.click();
  assert.equal(calls.findLast(c => c.type === 'VALIDATE_CONNECTION').provider, 'google');
  el('reminderTime').value = '08:45'; el('reminderTime').listeners.change(); el('timeZone').value = 'Europe/London'; el('timeZone').listeners.change();
  await el('save').listeners.click(); assert.equal(lastSaved.provider, 'google'); assert.equal(lastSaved.reminderTime, '08:45'); assert.equal(lastSaved.timeZone, 'Europe/London');
  assert.match(el('schedule-note').textContent, /08:45/);
  el('reminderTime').value = '25:00'; await el('save').listeners.click(); assert.equal(el('reminderTime').attrs['aria-invalid'], 'true');
  assert.equal(el('connectionUrl').value, 'https://connection.example.com/newsbridge/');
  el('connectionUrl').value = 'https://other.example.com/library/'; el('connectionUrl').listeners.input();
  assert.equal(el('sync').disabled, true);
  permissionGranted = false; const beforeDenied = calls.length; await el('check-connection').listeners.click();
  assert.equal(calls.length, beforeDenied); assert.match(el('auth-status').textContent, /not granted/);
  el('connectionUrl').value = 'http://example.com/'; el('connectionUrl').listeners.input(); assert.equal(el('connectionUrl').attrs['aria-invalid'], 'true');

});
