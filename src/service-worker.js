import { requestPairing, getPairingStatus } from './lib/pairing-client.js';
import { SafeError, safeErrorMessage } from './lib/security.js';
import { getItems, setItems, setSettings, setRead, setReadingStatus, addItem, deleteItem, getConnectionKeyStatus, disconnectCollection } from './lib/storage.js';
import { callKnowledge, mergeKnowledge } from './lib/knowledge.js';
import { callConnection, connectionStatus, pendingDelivery, resolveDelivery } from './lib/connection.js';
import { normalizeCaptureMetadata } from './lib/capture-metadata.js';
import { isSafeArticleUrl } from './lib/security.js';

let queue = Promise.resolve();
function enqueue(work) {
  const task = queue.then(work);
  queue = task.catch(() => {});
  return task;
}
async function reportError(error) {
  await chrome.action.setBadgeText({ text: '!' });
  await chrome.action.setBadgeBackgroundColor({ color: '#9f401f' });
  await chrome.action.setTitle({ title: safeErrorMessage(error) + ' — Right-click ReadFlow to open Settings.' });
}
async function syncReadingLibrary() {
  try {
    const result = await callKnowledge('sync', { items: await getItems() });
    if (result.enabled) {
      const merged = mergeKnowledge(await getItems(), result);
      await setItems(merged);
      if (merged.some(item => item.metadataUpdate && !item.feishuDeleted)) throw new SafeError('Tags or remarks are still pending. Check the ReadFlow service before retrying.');
    }
    const error = result.notifications?.error || null;
    await chrome.storage.local.set({ knowledgeSync: { enabled: result.enabled, at: Date.now(), error,
      tagOptions: result.captureMetadata?.tagOptions || [] } });
    if (error) await reportError(new SafeError(error));
    else {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({ title: 'ReadFlow — Home, Collection and Settings' });
    }
    return result;
  } catch (error) {
    const { knowledgeSync } = await chrome.storage.local.get('knowledgeSync');
    await chrome.storage.local.set({ knowledgeSync: { ...knowledgeSync, enabled: true, error: safeErrorMessage(error) } });
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
chrome.runtime.onInstalled.addListener((details = {}) => {
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html') + '#settings' });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'open-list', title: 'Reading list', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'open-home', title: 'Home', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'open-settings', title: 'Settings', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'sync-knowledge', title: 'Sync reading library', contexts: ['action'] });
  });
  enqueue(async () => { await initializeAlarms(); await syncReadingLibrary(); }).catch(() => console.warn('ReadFlow operation failed; check Settings.'));
});
chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === 'sync-knowledge') enqueue(syncReadingLibrary).catch(() => console.warn('ReadFlow operation failed; check Settings.'));
  else chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html') +
    (info.menuItemId === 'open-settings' ? '#settings' : info.menuItemId === 'open-home' ? '' : '#reading-list') });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'knowledge-sync') return;
  enqueue(async () => {
    const { knowledgeSync } = await chrome.storage.local.get('knowledgeSync');
    if (knowledgeSync?.enabled) await syncReadingLibrary();
  }).catch(() => console.warn('ReadFlow operation failed; check Settings.'));
});
chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => { await initializeAlarms(); await syncReadingLibrary(); }).catch(() => console.warn('ReadFlow operation failed; check Settings.'));
});
async function capturePage(tab, metadata = {}) {
  if (!/^https?:\/\//i.test(tab?.url || '')) {
    const error = new SafeError('This page cannot be saved. Open an HTTP(S) article or video page and try again.');
    await reportError(error); throw error;
  }
  try { await addItem({ url: tab.url, title: tab.title, metadata }); }
  catch (error) { await reportError(error); throw error; }
  await showCaptureFeedback('Saved locally', 'Checking reading sync…');
  try {
    const result = await syncReadingLibrary();
    const error = result.notifications?.error || null;
    await showCaptureFeedback('Saved to ReadFlow', error || (result.enabled ? 'Synced with the ReadFlow database.' : 'Saved locally. Connect ReadFlow to back up this capture.'), !!error);
    return { ok: true, saved: true, synced: result.enabled === true, error };
  } catch (error) {
    await showCaptureFeedback('Saved locally — sync failed', safeErrorMessage(error), true);
    return { ok: true, saved: true, synced: false, error: safeErrorMessage(error) };
  }
}
// Fallback for builds without a popup; the shipped action opens popup.html.
chrome.action.onClicked.addListener(tab => {
  enqueue(() => capturePage(tab)).catch(error => { if (!(error instanceof SafeError)) console.warn('ReadFlow operation failed; check Settings.'); });
});
// Serialize dashboard mutations with background sync, so local writes do not
// overwrite a newer database snapshot while a send is in flight.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const source = sender.url?.split(/[?#]/)[0];
  const fromOptions = source === chrome.runtime.getURL('src/options.html');
  const fromPopup = source === chrome.runtime.getURL('src/popup.html');
  if (sender.id !== chrome.runtime.id || sender.frameId !== undefined && sender.frameId !== 0 || !fromOptions && !fromPopup) return;
  if (fromPopup && !['CAPTURE_PAGE', 'CAPTURE_CONTEXT', 'POPUP_STATUS'].includes(message?.type)) return;
  if (fromOptions && ['CAPTURE_PAGE', 'CAPTURE_CONTEXT'].includes(message?.type)) return;
  if (!['POPUP_STATUS', 'CAPTURE_PAGE', 'CAPTURE_CONTEXT', 'SET_STATUS', 'SET_READ', 'DELETE_ITEM', 'SAVE_SETTINGS', 'CONNECTION_STATUS', 'SYNC', 'PENDING', 'RESOLVE_PENDING', 'VALIDATE_CONNECTION', 'KEY_STATUS', 'DISCONNECT', 'PAIR_REQUEST', 'PAIR_STATUS', 'EXPORT_TABLE', 'EXPORT_CSV'].includes(message?.type)) return;
  if (!message || typeof message !== 'object' || JSON.stringify(message).length > 8192) { reply({ ok: false, error: 'Invalid request.' }); return; }
  enqueue(async () => {
    if (message.type === 'EXPORT_TABLE') return callConnection('export');
    if (message.type === 'EXPORT_CSV') return callConnection('csv');
    if (message.type === 'POPUP_STATUS') {
      const { collectionIdentity, localCaptureMode } = await chrome.storage.local.get(['collectionIdentity', 'localCaptureMode']);
      const pair = await getPairingStatus();
      if (!collectionIdentity || !pair.approved) return { ok: true, connected: false, localOnly: localCaptureMode === true };
      return { ok: true, connected: true }; // A prior pairing permits capture even while the service is offline.
    }
    if (message.type === 'CAPTURE_PAGE') {
      if (Object.keys(message).some(key => !['type', 'metadata', 'expectedUrl'].includes(key))) throw new SafeError('Invalid capture request.');
      const metadata = normalizeCaptureMetadata(message.metadata);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (message.expectedUrl !== undefined && message.expectedUrl !== tab?.url) throw new SafeError('The active page changed. Reopen the popup before saving.');
      return capturePage(tab, metadata);
    }
    if (message.type === 'CAPTURE_CONTEXT') {
      if (Object.keys(message).some(key => key !== 'type')) throw new SafeError('Invalid capture request.');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!isSafeArticleUrl(tab?.url)) throw new SafeError('This page cannot be saved. Open an HTTP(S) article or video page and try again.');
      const items = await getItems();
      const item = items.find(item => item.url === tab.url && !item.feishuDeleted);
      const { knowledgeSync } = await chrome.storage.local.get('knowledgeSync');
      return { ok: true, url: tab.url, title: tab.title || tab.url, tags: item?.tags || [], remark: item?.remark || '',
        tagOptions: [...new Set([...(item?.tags || []), ...(knowledgeSync?.tagOptions || []), ...items.flatMap(item => item.tags || [])])].slice(0, 200) };
    }
    if (['SET_READ', 'SET_STATUS', 'DELETE_ITEM'].includes(message.type) && (typeof message.id !== 'string' || message.id.length > 512)) throw new SafeError('Invalid item ID.');
    if (message.type === 'DISCONNECT') return disconnectCollection();
    if (message.type === 'PAIR_REQUEST') return { ok: true, ...await requestPairing(message.connectionUrl) };
    if (message.type === 'PAIR_STATUS') return { ok: true, ...await getPairingStatus() };
    if (message.type === 'KEY_STATUS') return { ok: true, ...await getConnectionKeyStatus() };
    if (message.type === 'VALIDATE_CONNECTION') {
      if (message.accessKey !== undefined && (typeof message.accessKey !== 'string' || message.accessKey.length > 512)) throw new SafeError('Invalid access key.');
      return { ok: true, ...await callConnection('health', message.tableUrl !== undefined ? { tableUrl: message.tableUrl } : {}, { pinIdentity: false, provider: message.provider, endpoint: message.connectionUrl }) };
    }
    if (message.type === 'SAVE_SETTINGS') return { ok: true, settings: await setSettings(message.settings) };
    if (message.type === 'CONNECTION_STATUS') return { ok: true, ...await callConnection('health', message.tableUrl !== undefined ? { tableUrl: message.tableUrl } : {}, { provider: message.provider, endpoint: message.connectionUrl }) };
    if (message.type === 'SYNC') { await syncReadingLibrary(); return { ok: true }; }
    if (message.type === 'PENDING') return { ok: true, pending: await pendingDelivery() };
    if (message.type === 'RESOLVE_PENDING') {
      await resolveDelivery(message.uuid, message.outcome);
      await chrome.storage.local.remove('knowledgeSync');
      return { ok: true };
    }
    if (message.type === 'SET_STATUS') {
      await setReadingStatus(message.id, message.status);
    } else if (message.type === 'SET_READ') {
      if (typeof message.read !== 'boolean') throw new SafeError('Invalid reading status.');
      await setRead(message.id, message.read);
    } else {
      const item = (await getItems()).find(item => item.id === message.id);
      if (item?.feishuRecordId) throw new SafeError('Database item deletion is not available in this view.');
      await deleteItem(message.id);
    }
    return { ok: true };
  }).then(reply, error => reply({ ok: false, error: safeErrorMessage(error) }));
  return true;
});
// Toolbar feedback needs no script injection or page-content access.
async function showCaptureFeedback(title, note, warning = false) {
  await chrome.action.setBadgeBackgroundColor({ color: warning ? '#9f401f' : '#23734d' });
  await chrome.action.setBadgeText({ text: warning ? '!' : '✓' });
  await chrome.action.setTitle({ title: title + ' · ' + note + ' — Right-click → Reading list.' });
}
// Alarms can disappear on restart/update; restore them whenever the worker loads.
enqueue(initializeAlarms).catch(() => console.warn('ReadFlow operation failed; check Settings.'));
