import { SafeError, isSafeArticleUrl } from './security.js';
import { callKnowledge } from './knowledge.js';
import { callConnection, validAccessKey } from './connection.js';
import { CONNECTION_ORIGIN } from './connection-config.js';

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
    savedAt: new Date().toISOString(), read: false, notifiedAt: null };
  await setItems([item, ...items]);
  return item;
}
export async function setRead(id, read) {
  const item = (await getItems()).find(item => item.id === id);
  if (item?.feishuRecordId && !item.feishuDeleted) {
    await callKnowledge('read', { recordId: item.feishuRecordId, base: item.feishuBase, read }, await getSettings());
  }
  const items = (await getItems()).map(item => item.id === id ? { ...item, read } : item);
  await setItems(items);
  return items;
}
export async function deleteItem(id) {
  const items = (await getItems()).filter(item => item.id !== id);
  await setItems(items);
  return items;
}
export async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get(SETTINGS_KEY);
  return { language: settings.language === 'zh' ? 'zh' : 'en' };
}
export function validateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new SafeError('Invalid settings.');
  return { language: settings.language === 'zh' ? 'zh' : 'en' };
}
export async function setSettings(settings) {
  const next = validateSettings(settings);
  if (settings.connectionAccessKey && !CONNECTION_ORIGIN) throw new SafeError('This offline build has no connection configured.');
  if (settings.connectionAccessKey) {
    if (!validAccessKey(settings.connectionAccessKey)) throw new SafeError('Invalid connection access key.');
  }
  await callConnection('preferences', { language: next.language }, { accessKey: settings.connectionAccessKey });
  if (settings.connectionAccessKey) await chrome.storage.local.set({ connectionAccessKey: settings.connectionAccessKey, connectionOrigin: CONNECTION_ORIGIN });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
