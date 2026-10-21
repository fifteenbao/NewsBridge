import { validateSchedule } from './reminder-schedule.js';
import { READING_STATUSES } from './reading-state.js';
import { parseTableUrl } from './table-url.js';
import { SafeError, isSafeArticleUrl } from './security.js';
import { callKnowledge } from './knowledge.js';
import { callConnection } from './connection.js';
import { storedEndpoint, endpointValue, releaseEndpointPermission, endpointPermission, collectionArchiveKey } from './endpoint.js';

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
  const data = await chrome.storage.local.get([SETTINGS_KEY, 'connectionEndpoint']);
  const { settings = {} } = data;
  const endpoint = storedEndpoint(data);
  return { ...(endpoint ? { connectionUrl: endpoint } : {}), ...(settings.reminderTime !== undefined || settings.timeZone !== undefined ? validateSchedule(settings.reminderTime, settings.timeZone) : {}), ...(settings.provider ? { provider: settings.provider } : {}), language: settings.language === 'zh' ? 'zh' : 'en', ...(settings.tableUrl ? { tableUrl: parseTableUrl(settings.tableUrl).url } : {}), ...(typeof settings.remindersEnabled === 'boolean' ? { remindersEnabled: settings.remindersEnabled } : {}) };
}
export function validateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new SafeError('Invalid settings.');
  if (settings.connectionUrl !== undefined && typeof settings.connectionUrl !== 'string') throw new SafeError('Enter a valid HTTPS connection service address.');
  return { ...(typeof settings.connectionUrl === 'string' ? { connectionUrl: endpointValue(settings.connectionUrl) } : {}), ...(settings.reminderTime !== undefined || settings.timeZone !== undefined ? validateSchedule(settings.reminderTime, settings.timeZone) : {}), ...(settings.provider ? { provider: settings.provider } : {}), language: settings.language === 'zh' ? 'zh' : 'en', ...(settings.tableUrl ? { tableUrl: parseTableUrl(settings.tableUrl).url } : {}), ...(typeof settings.remindersEnabled === 'boolean' ? { remindersEnabled: settings.remindersEnabled } : {}) };
}
export async function setSettings(settings) {
  const next = validateSettings(settings);
  const provider = settings.provider || 'feishu';
  if (!['feishu', 'google'].includes(provider)) throw new SafeError('Invalid storage provider.');
  const current = await chrome.storage.local.get(['collectionIdentity', 'connectionProvider', 'connectionEndpoint', 'connectionBaseUrl']);
  if (current.collectionIdentity && provider !== (current.connectionProvider || 'feishu')) throw new SafeError('Disconnect the current collection before switching providers.');
  const endpoint = next.connectionUrl !== undefined ? next.connectionUrl : storedEndpoint(current);
  const previous = storedEndpoint(current);
  if (current.collectionIdentity && endpoint !== previous) throw new SafeError('Disconnect the current collection before changing the connection address.');
  if (endpoint && !await chrome.permissions.contains(endpointPermission(endpoint))) throw new SafeError('Grant access to this connection host in Settings before connecting.');
  const dataPair = (await chrome.storage.local.get('connectionPairings')).connectionPairings?.[endpoint];
  if (endpoint && dataPair?.status !== 'approved') throw new SafeError('Pair this browser in Settings and confirm the request on the server before connecting.');
  const result = await callConnection('preferences', { language: next.language, ...(next.tableUrl ? { tableUrl: next.tableUrl, ...(parseTableUrl(next.tableUrl).base ? { table: parseTableUrl(next.tableUrl).base } : {}) } : {}), ...(next.reminderTime !== undefined ? { reminderTime: next.reminderTime, timeZone: next.timeZone } : {}), ...(next.remindersEnabled !== undefined ? { remindersEnabled: next.remindersEnabled } : {}) }, { provider, endpoint, pinIdentity: false });
  const data = await chrome.storage.local.get(['collectionArchives', 'items']);
  const archive = result.identity && data.collectionArchives?.[collectionArchiveKey(result.identity, endpoint)];
  await chrome.storage.local.set({ [SETTINGS_KEY]: next, connectionProvider: provider, connectionEndpoint: endpoint,
    ...(result.identity ? { collectionIdentity: result.identity } : {}),
    ...(!current.collectionIdentity && Array.isArray(archive) ? { items: [...archive, ...(data.items || []).filter(item => !archive.some(old => old.id === item.id))] } : {}),
    connectionAccessKey: '', connectionBaseUrl: endpoint, connectionKeySavedAt: null });
  if (endpoint !== previous) await releaseEndpointPermission(previous, endpoint);
  return next;
}

// Preserve separate collections; no remote deletion or credential revocation.
export async function disconnectCollection() {
  const data = await chrome.storage.local.get(['items', 'collectionIdentity', 'collectionArchives', 'connectionEndpoint', 'connectionBaseUrl']);
  const archives = data.collectionArchives || {};
  if (data.collectionIdentity && data.items?.length) archives[collectionArchiveKey(data.collectionIdentity, storedEndpoint(data) || data.connectionBaseUrl || '')] = data.items;
  // One atomic storage update prevents loss if Chrome quota is reached.
  await chrome.storage.local.set({ collectionArchives: archives, items: data.collectionIdentity ? [] : data.items || [], settings: { language: 'en' }, collectionIdentity: null,
    connectionEndpoint: '', connectionAccessKey: '', connectionKeySavedAt: null, connectionBaseUrl: '', connectionProvider: 'feishu', knowledgeSync: null });
  await releaseEndpointPermission(storedEndpoint(data));
  return { ok: true };
}
