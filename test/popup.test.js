import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { area } from '../test-support/chrome-mock.js';

test('icon popup offers collection and settings, and captures through the trusted worker', async t => {
  const original = { chrome: globalThis.chrome, document: globalThis.document, window: globalThis.window };
  t.after(() => Object.assign(globalThis, original));
  class Element {
    constructor() { this.value = ''; this.children = []; this.checked = false; this.textContent = ''; this.disabled = false; this.attrs = {}; this.events = {}; }
    append(...values) { this.children.push(...values); } replaceChildren(...values) { this.children = values; }
    setAttribute(key, value) { this.attrs[key] = value; } removeAttribute(key) { delete this.attrs[key]; }
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
  globalThis.document = { documentElement: {}, querySelectorAll: () => translateNodes, getElementById: get, createElement: () => new Element() };
  globalThis.window = { close() {} };
  globalThis.chrome = { storage: { local: area({ uiLanguage: 'zh' }) },
    tabs: { create: async info => opened.push(info.url) }, runtime: { getURL: path => 'chrome-extension://test/' + path,
      sendMessage: async message => { sent.push(message); return message.type === 'POPUP_STATUS' ? { ok: true, connected: true } : message.type === 'CAPTURE_CONTEXT' ? { ok: true, url: 'https://example.com/a', title: 'Article', tags: ['AI'], remark: 'Existing remark', tagOptions: ['AI', 'Research'] } : result; } } };
  await import('../src/popup.js');
  assert.equal(get('open-collection').textContent, '收藏'); assert.equal(get('open-settings').textContent, '设置');
  for (const id of ['open-collection', 'open-settings']) await get(id).events.click();
  assert.deepEqual(opened, ['chrome-extension://test/src/options.html#reading-list', 'chrome-extension://test/src/options.html#settings']);
  assert.equal(get('setup-welcome').hidden, true);
  assert.equal(get('capture-editor').hidden, false);
  assert.equal(sent[0].type, 'POPUP_STATUS');
  assert.equal(get('capture-remark').value, 'Existing remark');
  assert.equal(get('capture-tag-options').children.length, 1);
  get('capture-new-tag').value = 'Research'; get('capture-new-tag').events.input();
  assert.equal(get('capture-tag-options').children[0].children[1].textContent, 'Research');
  get('capture-new-tag').value = ''; get('capture-new-tag').events.input();
  await get('capture').events.click(); assert.deepEqual(sent.at(-1), { type: 'CAPTURE_PAGE', expectedUrl: 'https://example.com/a', metadata: {} }); assert.match(get('capture-status').textContent, /本机收藏/);
  get('capture-new-tag').value = 'New tag'; await get('capture-add-tag').events.click();
  get('capture-remark').value = 'Question for review';
  result = { ok: true, saved: true, synced: true }; await get('capture').events.click(); assert.match(get('capture-status').textContent, /数据库/);
  assert.deepEqual(sent.at(-1).metadata, { tags: ['AI', 'New tag'], remark: 'Question for review' });
  for (const option of get('capture-tag-options').children) { const checkbox = option.children[0]; checkbox.checked = false; checkbox.events.change(); }
  get('capture-remark').value = ''; await get('capture').events.click();
  assert.deepEqual(sent.at(-1).metadata, { tags: [], remark: '' });
  let finishSave;
  result = new Promise(resolve => { finishSave = resolve; });
  const saving = get('capture').events.click();
  assert.equal(get('capture').textContent, '正在收藏…');
  assert.equal(get('capture').disabled, true);
  assert.equal(get('capture-remark').disabled, true);
  const requestCount = sent.length;
  await get('capture').events.click();
  assert.equal(sent.length, requestCount, 'duplicate click must not submit another capture');
  finishSave({ ok: true, saved: true, synced: false, error: 'Service unavailable' });
  await saving;
  assert.equal(get('capture').textContent, '收藏成功');
  assert.match(get('capture-status').textContent, /尚未同步到数据库/);
  assert.equal(get('capture-status').getAttribute('data-state'), 'local');
  assert.equal(get('capture-remark').disabled, false);
  assert.ok(html.indexOf('id="capture-status"') < html.indexOf('class="popup-nav"'));
  result = { ok: false, error: 'This page cannot be saved. Open an HTTP(S) article or video page and try again.' };
  await get('capture').events.click(); assert.match(get('capture-status').textContent, /无法收藏/); assert.equal(get('capture').disabled, false);
  assert.equal(get('capture').textContent, '重新收藏');
  assert.match(get('capture-status').textContent, /^收藏失败：/);
  assert.equal(get('capture-status').getAttribute('data-state'), 'error');
  result = undefined; await get('capture').events.click();
  assert.match(get('capture-status').textContent, /^收藏失败：/);
  result = { ok: true, saved: true, synced: true }; await get('capture').events.click();
  assert.equal(get('capture').textContent, '收藏成功');
  assert.equal(get('capture-status').getAttribute('data-state'), 'success');
});


test('unconfigured, rejected and unreachable connections never expose the capture editor', async t => {
  const original = { chrome: globalThis.chrome, document: globalThis.document, window: globalThis.window };
  t.after(() => Object.assign(globalThis, original));
  for (const [index, status] of [{ ok: true, connected: false }, { ok: false, error: 'PAIR_REQUIRED' }, new Error('Unavailable')].entries()) {
    const elements = new Map(), sent = [], opened = [];
    const get = id => {
      if (!elements.has(id)) elements.set(id, { hidden: id === 'capture-editor', value: '', events: {}, addEventListener(name, fn) { this.events[name] = fn; } });
      return elements.get(id);
    };
    globalThis.document = { documentElement: {}, querySelectorAll: () => [], getElementById: get };
    globalThis.window = { close() {} };
    globalThis.chrome = { storage: { local: area({}) }, tabs: { create: async value => opened.push(value.url) }, runtime: {
      getURL: path => 'chrome-extension://test/' + path,
      sendMessage: async message => { sent.push(message.type); if (status instanceof Error) throw status; return status; }
    } };
    await import(`../src/popup.js?unconfigured=${index}`);
    assert.equal(get('capture-editor').hidden, true);
    assert.equal(get('setup-welcome').hidden, false);
    assert.equal(get('capture').disabled, true);
    assert.deepEqual(sent, ['POPUP_STATUS']);
    await get('start-setup').events.click();
    assert.deepEqual(opened, ['chrome-extension://test/src/options.html#settings']);
  }
});
