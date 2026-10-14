import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chooseLanguage, translations, translate, localizeError } from '../src/lib/options-i18n.js';
import { messages, formatDiagnostic } from '../src/lib/diagnostics.js';

test('both interface languages cover the real page and preserve interpolation variables', async () => {
  const html = await readFile(new URL('../src/options.html', import.meta.url), 'utf8');
  assert.deepEqual(Object.keys(translations.zh).sort(), Object.keys(translations.en).sort());
  for (const key of Object.keys(translations.en)) {
    const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(placeholders(translations.en[key]), placeholders(translations.zh[key]), key);
  }
  for (const [, key] of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) {
    assert.ok(translate('en', key)); assert.ok(translate('zh', key));
  }
  assert.equal(html.includes('Feishu Bitable link / 多维表格链接'), false);
  assert.ok(html.indexOf('id="chatId"') > html.indexOf('id="remindersEnabled"'));
  assert.ok(html.indexOf('id="chatId"') > html.indexOf('id="sync"'));
  assert.match(html, /node examples\/run\.mjs init private\/host\.json/);
  assert.match(html, /private\/state\/access\.key/);
});
test('interface choice respects a saved preference and supports Chinese browser locales', () => {
  assert.equal(chooseLanguage(undefined, 'zh-CN'), 'zh');
  assert.equal(chooseLanguage(undefined, 'zh-TW'), 'zh');
  assert.equal(chooseLanguage(undefined, 'de-DE'), 'en');
  assert.equal(chooseLanguage('en', 'zh-CN'), 'en');
  assert.equal(chooseLanguage('zh', 'en-US'), 'zh');
});
test('Chinese diagnostics retain codes, provider details and references', () => {
  for (const code of Object.keys(messages)) {
    const formatted = formatDiagnostic({ code, stage: 'sync.records.list', providerCode: 1254030, httpStatus: 403, reference: '12345678-1234-1234-1234-123456789abc' });
    const localized = localizeError(formatted, 'zh');
    assert.notEqual(localized, formatted, code);
    assert.match(localized, /sync\.records\.list/); assert.match(localized, /provider=1254030/);
    assert.match(localized, /12345678-1234-1234-1234-123456789abc/);
    assert.equal(localizeError(formatted, 'en'), formatted);
  }
  assert.match(localizeError('Enter the connection access key in Settings.', 'zh'), /连接访问密钥/);
  assert.match(localizeError('Open the target data table and copy its /base/ link including ?table=tbl…', 'zh'), /数据表 ID/);
});
