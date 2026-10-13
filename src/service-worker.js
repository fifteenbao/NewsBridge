import { SafeError, safeErrorMessage } from './lib/security.js';
import { getItems, setItems, setSettings, setRead, addItem, deleteItem } from './lib/storage.js';
import { callKnowledge, mergeKnowledge } from './lib/knowledge.js';
import { connectionStatus, pendingDelivery, resolveDelivery } from './lib/connection.js';

let queue = Promise.resolve();
function enqueue(work) {
  const task = queue.then(work);
  queue = task.catch(() => {});
  return task;
}
async function reportError(error) {
  await chrome.action.setBadgeText({ text: '!' });
  await chrome.action.setBadgeBackgroundColor({ color: '#9f401f' });
  await chrome.action.setTitle({ title: safeErrorMessage(error) + ' — Sync reading library to retry.' });
}
async function syncReadingLibrary() {
  try {
    const result = await callKnowledge('sync', { items: await getItems() });
    if (result.enabled) await setItems(mergeKnowledge(await getItems(), result));
    const error = result.notifications?.error || null;
    await chrome.storage.local.set({ knowledgeSync: { enabled: result.enabled, at: Date.now(), error } });
    if (error) await reportError(new SafeError(error));
    else {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({ title: 'Save this page to NewsBridge' });
    }
    return result;
  } catch (error) {
    await chrome.storage.local.set({ knowledgeSync: { enabled: true, error: safeErrorMessage(error) } });
    await reportError(error);
    throw error;
  }
}
async function initializeAlarms() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  for (const alarm of await chrome.alarms.getAll()) {
    if (alarm.name.startsWith('review:')) await chrome.alarms.clear(alarm.name);
  }
  await chrome.storage.local.remove('reviews');
  if (!(await chrome.alarms.get('knowledge-sync'))) await chrome.alarms.create('knowledge-sync', { periodInMinutes: 15 });
  await chrome.alarms.clear('daily-reading');
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'open-list', title: 'Reading list', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'open-settings', title: 'Settings', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'sync-knowledge', title: 'Sync reading library', contexts: ['action'] });
  });
  enqueue(async () => { await initializeAlarms(); await syncReadingLibrary(); }).catch(() => console.warn('NewsBridge operation failed; check Settings.'));
});
chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === 'sync-knowledge') enqueue(syncReadingLibrary).catch(() => console.warn('NewsBridge operation failed; check Settings.'));
  else chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html') +
    (info.menuItemId === 'open-settings' ? '#settings' : '#reading-list') });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'knowledge-sync') return;
  enqueue(async () => {
    const { knowledgeSync } = await chrome.storage.local.get('knowledgeSync');
    if (knowledgeSync?.enabled) await syncReadingLibrary();
  }).catch(() => console.warn('NewsBridge operation failed; check Settings.'));
});
chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => { await initializeAlarms(); await syncReadingLibrary(); }).catch(() => console.warn('NewsBridge operation failed; check Settings.'));
});
chrome.action.onClicked.addListener(tab => {
  enqueue(async () => {
    if (!/^https?:\/\//i.test(tab?.url || '')) return;
    try { await addItem({ url: tab.url, title: tab.title }); } catch (error) { await reportError(error); return; }
    await showToast(tab.id, 'Saved to NewsBridge', 'Syncing reading status…');
    try {
      const result = await syncReadingLibrary();
      const note = result.notifications?.error || (result.enabled ? 'Synced with Feishu Bitable.' :
        'Saved locally. Configure a connection to enable Feishu sync.');
      await showToast(tab.id, 'Saved to NewsBridge', note);
    } catch (error) { await showToast(tab.id, 'Saved locally', safeErrorMessage(error)); }
  }).catch(() => console.warn('NewsBridge operation failed; check Settings.'));
});
// Serialize dashboard mutations with background sync, so local writes do not
// overwrite a newer Feishu snapshot while a send is in flight.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL('src/options.html')) return;
  if (!['SET_READ', 'DELETE_ITEM', 'SAVE_SETTINGS', 'CONNECTION_STATUS', 'SYNC', 'PENDING', 'RESOLVE_PENDING'].includes(message?.type)) return;
  if (!message || typeof message !== 'object' || JSON.stringify(message).length > 8192) { reply({ ok: false, error: 'Invalid request.' }); return; }
  enqueue(async () => {
    if (['SET_READ', 'DELETE_ITEM'].includes(message.type) && (typeof message.id !== 'string' || message.id.length > 512)) throw new SafeError('Invalid item ID.');
    if (message.type === 'SAVE_SETTINGS') return { ok: true, settings: await setSettings(message.settings) };
    if (message.type === 'CONNECTION_STATUS') return { ok: true, ...await connectionStatus() };
    if (message.type === 'SYNC') { await syncReadingLibrary(); return { ok: true }; }
    if (message.type === 'PENDING') return { ok: true, pending: await pendingDelivery() };
    if (message.type === 'RESOLVE_PENDING') {
      await resolveDelivery(message.uuid, message.outcome);
      await chrome.storage.local.remove('knowledgeSync');
      return { ok: true };
    }
    if (message.type === 'SET_READ') {
      if (typeof message.read !== 'boolean') throw new SafeError('Invalid reading status.');
      await setRead(message.id, message.read);
    } else {
      const item = (await getItems()).find(item => item.id === message.id);
      if (item?.feishuRecordId) throw new SafeError('Delete linked items in Feishu Bitable, then sync.');
      await deleteItem(message.id);
    }
    return { ok: true };
  }).then(reply, error => reply({ ok: false, error: safeErrorMessage(error) }));
  return true;
});
// Toolbar feedback needs no script injection or page-content access.
async function showToast(_tabId, title, note) {
  await chrome.action.setTitle({ title: title + ' · ' + note });
}
// Alarms can disappear on restart/update; restore them whenever the worker loads.
enqueue(initializeAlarms).catch(() => console.warn('NewsBridge operation failed; check Settings.'));
