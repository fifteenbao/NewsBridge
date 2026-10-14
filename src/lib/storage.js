import { validateSchedule } from './reminder-schedule.js';
import { READING_STATUSES } from './reading-state.js';
import { parseTableUrl } from './table-url.js';
import { SafeError, isSafeArticleUrl } from './security.js';
import { callKnowledge } from './knowledge.js';
import { callConnection, validAccessKey } from './connection.js';
import { CONNECTION_BASE_URL } from './connection-config.js';

const ITEMS_KEY = 'items';
const SETTINGS_KEY = 'settings';
export const DEFAULT_SETTINGS = { language: 'en' };

export async function getItems() {
  const data = await chrome.storage.local.get(ITEMS_KEY);
  return data[ITEMS_KEY] || [];
}
export async function setItems(items) {
  await chrome.storage.local.set({ [ITEMS_KEY]: items });
}
export async function addItem({ url, title }) {
  if (!isSafeArticleUrl(url)) throw new SafeError('This URL is invalid or contains credentials or authentication parameters. It was not saved.');
  const items = await getItems();
  if (items.length >= 5000) throw new SafeError('The local collection has reached its 5000-item limit.');
  title = typeof title === 'string' ? title.slice(0, 1000) : '';
  const existing = items.find(item => item.url === url && !item.feishuDeleted);
  if (existing) return existing;
  const item = { id: crypto.randomUUID(), url, title: title || url,
    savedAt: new Date().toISOString(), read: false, status: '待阅读', notifiedAt: null };
  await setItems([item, ...items]);
  return item;
}
export const setRead = (id, read) => setReadingStatus(id, read ? '已读' : '待阅读');
export async function setReadingStatus(id, status) {
  if (!READING_STATUSES.includes(status)) throw new SafeError('Invalid reading status.');
  const item = (await getItems()).find(item => item.id === id);
  if (!item) throw new SafeError('Reading item not found.');
  if (item.feishuRecordId && !item.feishuDeleted) {
    await callKnowledge('read', { recordId: item.feishuRecordId, base: item.feishuBase, status });
  }
  const items = (await getItems()).map(item => item.id === id ? { ...item, status, read: status !== '待阅读' } : item);
  await setItems(items); return items;
}
export async function deleteItem(id) {
  const items = (await getItems()).filter(item => item.id !== id);
  await setItems(items);
  return items;
}
export async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...(settings.reminderTime !== undefined || settings.timeZone !== undefined ? validateSchedule(settings.reminderTime, settings.timeZone) : {}), ...(settings.provider ? { provider: settings.provider } : {}), language: settings.language === 'zh' ? 'zh' : 'en', ...(settings.tableUrl ? { tableUrl: parseTableUrl(settings.tableUrl).url } : {}), ...(typeof settings.remindersEnabled === 'boolean' ? { remindersEnabled: settings.remindersEnabled } : {}) };
}
export function validateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new SafeError('Invalid settings.');
  return { ...(settings.reminderTime !== undefined || settings.timeZone !== undefined ? validateSchedule(settings.reminderTime, settings.timeZone) : {}), ...(settings.provider ? { provider: settings.provider } : {}), language: settings.language === 'zh' ? 'zh' : 'en', ...(settings.tableUrl ? { tableUrl: parseTableUrl(settings.tableUrl).url } : {}), ...(typeof settings.remindersEnabled === 'boolean' ? { remindersEnabled: settings.remindersEnabled } : {}) };
}
export async function setSettings(settings) {
  const next = validateSettings(settings);
  const provider = settings.provider || 'feishu';
  if (!['feishu', 'google'].includes(provider)) throw new SafeError('Invalid storage provider.');
  const current = await chrome.storage.local.get(['collectionIdentity', 'connectionProvider']);
  if (current.collectionIdentity && provider !== (current.connectionProvider || 'feishu')) throw new SafeError('Disconnect the current collection before switching providers.');
  if (settings.connectionAccessKey && !CONNECTION_BASE_URL) throw new SafeError('This offline build has no connection configured.');
  if (settings.connectionAccessKey) {
    if (!validAccessKey(settings.connectionAccessKey)) throw new SafeError('Invalid connection access key.');
  }
  await callConnection('preferences', { language: next.language, ...(next.tableUrl ? { tableUrl: next.tableUrl, ...(parseTableUrl(next.tableUrl).base ? { table: parseTableUrl(next.tableUrl).base } : {}) } : {}), ...(next.reminderTime !== undefined ? { reminderTime: next.reminderTime, timeZone: next.timeZone } : {}), ...(next.remindersEnabled !== undefined ? { remindersEnabled: next.remindersEnabled } : {}) }, { accessKey: settings.connectionAccessKey, provider });
  if (settings.connectionAccessKey) await chrome.storage.local.set({ connectionAccessKey: settings.connectionAccessKey, connectionBaseUrl: CONNECTION_BASE_URL, connectionKeySavedAt: new Date().toISOString() });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next, connectionProvider: provider });
  return next;
}

export async function getConnectionKeyStatus() {
  const data = await chrome.storage.local.get(['connectionAccessKey', 'connectionKeySavedAt', 'connectionBaseUrl']);
  return { saved: validAccessKey(data.connectionAccessKey), savedAt: typeof data.connectionKeySavedAt === 'string' && Number.isFinite(Date.parse(data.connectionKeySavedAt)) ? data.connectionKeySavedAt : null,
    matchesEndpoint: data.connectionBaseUrl === CONNECTION_BASE_URL };
}

// Preserve separate collections; no remote deletion or credential revocation.
export async function disconnectCollection() {
  const data = await chrome.storage.local.get(['items', 'collectionIdentity', 'collectionArchives']);
  const archives = data.collectionArchives || {};
  if (data.collectionIdentity && data.items?.length) archives[JSON.stringify(data.collectionIdentity)] = data.items;
  // One atomic storage update prevents loss if Chrome quota is reached.
  await chrome.storage.local.set({ collectionArchives: archives, items: data.collectionIdentity ? [] : data.items || [], settings: { language: 'en' }, collectionIdentity: null,
    connectionAccessKey: '', connectionKeySavedAt: null, connectionBaseUrl: '', connectionProvider: 'feishu', knowledgeSync: null });
  return { ok: true };
}
