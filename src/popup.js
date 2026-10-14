import { chooseLanguage, translate, localizeError } from './lib/options-i18n.js';
const { uiLanguage: saved } = await chrome.storage.local.get('uiLanguage');
const language = chooseLanguage(saved, chrome.i18n?.getUILanguage() || 'en');
const t = (key, values) => translate(language, key, values);
document.documentElement.lang = language;
for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.getAttribute('data-i18n'));
for (const [id, route] of [['open-home', ''], ['open-collection', '#reading-list'], ['open-settings', '#settings']]) {
  document.getElementById(id).addEventListener('click', async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html') + route });
    window.close();
  });
}
document.getElementById('capture').addEventListener('click', async () => {
  const button = document.getElementById('capture'), status = document.getElementById('capture-status');
  button.disabled = true; status.textContent = t('capturing');
  try {
    const result = await chrome.runtime.sendMessage({ type: 'CAPTURE_PAGE' });
    if (!result?.ok || !result.saved) throw new Error(result?.error || t('genericFailure'));
    status.textContent = t(result.synced ? 'captureSynced' : 'captureLocal') + (result.error ? ` ${localizeError(result.error, language)}` : '');
  } catch (error) { status.textContent = localizeError(error, language); }
  finally { button.disabled = false; }
});
