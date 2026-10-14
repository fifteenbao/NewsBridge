import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTableUrl } from '../src/lib/table-url.js';
import { formatDiagnostic } from '../src/lib/diagnostics.js';
import { area, event } from '../test-support/chrome-mock.js';

// Interaction test against the real options module; no visual/browser claim.
test('settings show saved-key metadata, live table states, disabled sync, reminder preference and 401/403 guidance', async t => {
  const original = { chrome: globalThis.chrome, document: globalThis.document, location: globalThis.location };
  t.after(() => Object.assign(globalThis, original));
  class Element {
    constructor() { this.value = ''; this.textContent = ''; this.disabled = false; this.checked = false; this.listeners = {}; this.attrs = {}; this.classList = { add() {}, remove() {} }; }
    setAttribute(k,v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; } removeAttribute(k) { delete this.attrs[k]; }
    append() {} appendChild() {} replaceChildren() {} focus() {} scrollIntoView() {}
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
  globalThis.location = { hash: '#settings' };
  let connected = false, saved = false, lastSaved, calls = [];
  const local = {};
  const status = () => ({ ok: true, connected, protocolVersion: 1, configuration: { baseToken: 'baseTest', articleTableId: 'tblTest', chatId: 'oc_reminders', remindersAvailable: true, remindersEnabled: lastSaved?.remindersEnabled ?? true, timeZone: 'Asia/Shanghai', language: lastSaved?.language || 'en' } });
  globalThis.chrome = {
    storage: { local: area(local), onChanged: event() },
    i18n: { getUILanguage: () => 'en-US' },
    runtime: { getManifest: () => ({ version }), sendMessage: async message => {
      calls.push(message);
      if (message.type === 'KEY_STATUS') return { ok: true, saved, savedAt: saved ? '2026-10-14T00:00:00Z' : null, matchesEndpoint: saved };
      if (message.type === 'VALIDATE_CONNECTION') {
        if (message.accessKey === 'bad') return { ok: false, error: formatDiagnostic({ code: 'KEY_INVALID', stage: 'identity' }) };
        if (message.accessKey === 'wrong-origin') return { ok: false, error: formatDiagnostic({ code: 'ORIGIN_DENIED', stage: 'identity' }) };
        if (message.tableUrl?.includes('/wiki/wikiDoc')) return { ok: false, error: formatDiagnostic({ code: 'LINK_NOT_BITABLE', stage: 'health.wiki.resolve' }) };
        connected = true;
        const result = status();
        if (message.tableUrl?.includes('/wiki/')) result.resolvedTable = { url: parseTableUrl(message.tableUrl).url, baseToken: 'baseTest', articleTableId: 'tblTest', base: 'baseTest/tblTest', source: 'wiki-node' };
        return result;
      }
      if (message.type === 'CONNECTION_STATUS') return status();
      if (message.type === 'PENDING') return { ok: true, pending: null };
      if (message.type === 'SAVE_SETTINGS') { saved = true; lastSaved = message.settings; return { ok: true, settings: lastSaved }; }
      return { ok: true };
    } },
  };
  const drain = () => new Promise(resolve => setImmediate(resolve));
  await import('../src/options.js'); await drain();
  assert.match(el('key-status').textContent, /No key saved/); assert.equal(el('sync').disabled, true);
  assert.ok(el('connection-meta').textContent.includes(version));
  el('tableUrl').value = 'https://workspace.feishu.cn/base/baseTest?table=tblTest'; el('tableUrl').listeners.input();
  assert.match(el('table-url-error').textContent, /Format valid/);
  assert.equal(el('baseToken').value, 'baseTest'); assert.equal(el('articleTableId').value, 'tblTest');
  assert.equal(el('chatId').value, '');
  el('tableUrl').value = 'invalid'; el('tableUrl').listeners.input();
  assert.equal(el('baseToken').value, ''); assert.equal(el('articleTableId').value, '');
  el('tableUrl').value = 'https://workspace.feishu.cn/base/baseTest?table=tblTest'; el('tableUrl').listeners.input();
  el('connectionAccessKey').value = 'good'; el('connectionAccessKey').listeners.input(); el('connectionAccessKey').listeners.blur(); await drain();
  assert.match(el('table-url-error').textContent, /Matches server configuration/);
  assert.equal(el('chatId').value, 'oc_reminders');
  el('tableUrl').value = 'https://workspace.feishu.cn/base/baseOther?table=tblOther'; el('tableUrl').listeners.input();
  assert.equal(el('baseToken').value, 'baseOther'); assert.equal(el('articleTableId').value, 'tblOther');
  assert.equal(el('chatId').value, 'oc_reminders');
  assert.match(el('table-url-error').textContent, /Does not match/);
  el('tableUrl').value = 'https://workspace.feishu.cn/base/baseTest?table=tblTest'; el('tableUrl').listeners.input();
  assert.equal(saved, false); assert.equal(el('sync').disabled, true);
  await el('save').listeners.click(); await drain();
  assert.match(el('key-status').textContent, /Key saved/); assert.equal(el('sync').disabled, false);
  el('tableUrl').value = 'https://my.feishu.cn/base/baseTest?from=from_copylink'; el('tableUrl').listeners.input();
  assert.equal(el('baseToken').value, 'baseTest'); assert.equal(el('articleTableId').value, 'tblTest');
  assert.match(el('table-id-source').textContent, /configured table in the same base/);
  el('tableUrl').value = 'https://my.feishu.cn/wiki/wikiTest?from=from_copylink'; el('tableUrl').listeners.input();
  assert.equal(el('baseToken').value, ''); assert.equal(el('articleTableId').value, ''); assert.equal(el('sync').disabled, true);
  assert.match(el('table-url-error').textContent, /Check the connection/);
  await el('check-connection').listeners.click();
  assert.equal(calls.findLast(message => message.type === 'VALIDATE_CONNECTION').tableUrl, 'https://my.feishu.cn/wiki/wikiTest');
  assert.equal(el('baseToken').value, 'baseTest'); assert.equal(el('articleTableId').value, 'tblTest');
  assert.equal(el('sync').disabled, false);
  el('tableUrl').value = 'https://my.feishu.cn/wiki/wikiDoc'; el('tableUrl').listeners.input();
  await el('check-connection').listeners.click();
  assert.match(el('table-url-error').textContent, /LINK_NOT_BITABLE/); assert.equal(el('sync').disabled, true);
  el('tableUrl').value = 'https://workspace.feishu.cn/base/baseTest?table=tblTest'; el('tableUrl').listeners.input();
  await el('check-connection').listeners.click();
  const beforeLanguageChange = calls.length;
  el('language').value = 'zh'; el('language').listeners.change();
  el('ui-language').value = 'zh'; await el('ui-language').listeners.change();
  assert.equal(document.documentElement.lang, 'zh'); assert.equal(local.uiLanguage, 'zh');
  assert.equal(calls.length, beforeLanguageChange);
  assert.equal(el('language').value, 'zh');
  assert.equal(el('check-connection').textContent, '检查连接 / 重试');
  assert.match(el('key-status').textContent, /已保存密钥/);
  assert.match(el('table-url-error').textContent, /与连接配置一致/);
  assert.match(el('chatId').getAttribute('placeholder'), /需要提醒/);
  assert.match(el('baseToken').getAttribute('placeholder'), /自动填写/);
  assert.match(el('schedule-note').textContent, /连接端状态/);
  el('ui-language').value = 'en'; await el('ui-language').listeners.change();
  assert.equal(el('language').value, 'zh'); assert.equal(document.documentElement.lang, 'en');
  assert.equal(el('check-connection').textContent, 'Check connection / Retry');
  el('remindersEnabled').checked = false; el('remindersEnabled').listeners.change(); await el('save').listeners.click();
  assert.equal(lastSaved.remindersEnabled, false);
  for (const [key, code] of [['bad','KEY_INVALID'], ['wrong-origin','ORIGIN_DENIED']]) {
    el('connectionAccessKey').value = key; el('connectionAccessKey').listeners.input(); el('connectionAccessKey').listeners.blur(); await drain();
    assert.match(el('key-validation').textContent, new RegExp(code)); assert.equal(el('sync').disabled, true);
    assert.equal(el('baseToken').value, 'baseTest');
    assert.equal(el('articleTableId').value, 'tblTest');
    assert.equal(el('chatId').value, '');
  }
  assert.ok(calls.some(c => c.type === 'VALIDATE_CONNECTION'));
});
