import { isUnread, readingStatus } from './lib/reading-state.js';
import { initialRoute, ROUTES } from './lib/navigation.js';
import { chooseLanguage, translate, localizeError } from './lib/options-i18n.js';
import { endpointValue, requestEndpointPermission } from './lib/endpoint.js';
import { validateSchedule } from './lib/reminder-schedule.js';
import { isSafeArticleUrl } from './lib/security.js';
let uiLanguage = 'en', pairingView = null;
const t = (key, values) => translate(uiLanguage, key, values);
const errorText = error => localizeError(error, uiLanguage);
const locale = () => uiLanguage === 'zh' ? 'zh-CN' : 'en';
// The background worker serializes reading-data mutations; interface language stays local.

import {
  getItems,
  getSettings,
} from "./lib/storage.js";

// ===========================================================================
// READING LIST
// ===========================================================================

// A small inline SVG icon as an element.
function svg(paths, width = "1.8") {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-width", width);
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  for (const d of paths) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    el.appendChild(p);
  }
  return el;
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function savedAgo(iso) {
  const then = new Date(iso);
  return then.toLocaleDateString(locale(), { month: "short", day: "numeric" });
}

async function renderList() {
  const list = document.getElementById("list");
  const items = (await getItems()).filter(isUnread);
  list.replaceChildren();

  const count = document.getElementById("list-count");
  const unread = items.filter((it) => !it.read).length;
  count.textContent = t('count', { unread });

  if (items.length === 0) {
    list.appendChild(emptyState());
    return;
  }

  items.forEach((item, i) => list.appendChild(renderItem(item, i)));
}

function emptyState() {
  const li = document.createElement("li");
  li.className = "empty";
  const ornament = document.createElement("div");
  ornament.className = "ornament";
  ornament.appendChild(
    svg(["M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z", "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"], "1.4")
  );
  const h = document.createElement("p");
  h.className = "display";
  h.textContent = t('emptyHeading');
  const p = document.createElement("p");
  p.textContent = t('emptyHint');
  li.append(ornament, h, p);
  return li;
}

function renderItem(item, index) {
  const li = document.createElement("li");
  li.className = "item" + (item.read ? " read" : "");
  li.style.animationDelay = `${Math.min(index, 10) * 25}ms`;

  const check = document.createElement('select');
  check.className = 'status-select';
  check.setAttribute('aria-label', t('readingStatus', { title: item.title }));
  check.setAttribute('aria-describedby', 'list-status');
  for (const [value, key] of [['待阅读', 'unread'], ['已读', 'read'], ['跳过', 'skip']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = t(key); check.appendChild(option);
  }
  check.value = readingStatus(item);
  check.addEventListener('change', async () => {
    const status = check.value; check.disabled = true;
    document.getElementById('list-status').textContent = '';
    try { await mutate({ type: 'SET_STATUS', id: item.id, status }); await renderList(); await renderHome(); }
    catch (error) { check.value = readingStatus(item); document.getElementById('list-status').textContent = errorText(error); }
    finally { check.disabled = false; }
  });

  // Title + meta. Clicking the title opens the article in a new tab.
  const body = document.createElement("div");
  body.className = "item-body";

  const linked = isSafeArticleUrl(item.url);
  const title = document.createElement(linked ? "a" : "span");
  title.className = "item-title";
  title.textContent = item.title;
  if (linked) title.href = item.url;
  if (linked) { title.target = "_blank"; title.rel = "noreferrer"; }

  const meta = document.createElement("div");
  meta.className = "item-meta";
  const metaText = t('itemMeta', { domain: domainOf(item.url), date: savedAgo(item.savedAt) });
  meta.append(document.createTextNode(metaText));
  // A tag for items already delivered in a reading message.
  if (item.notifiedAt) {
    const tag = document.createElement("span");
    tag.className = "tag sent";
    tag.textContent = t('sent');
    meta.append(tag);
  }

  body.append(title, meta);

  // Delete button.
  const del = document.createElement("button");
  del.className = "del";
  del.title = t('remove');
  if (item.feishuRecordId) {
    del.title = t('removeLinked');
    del.disabled = true;
  }
  del.setAttribute('aria-label', del.title);
  del.appendChild(svg(["M18 6L6 18", "M6 6l12 12"], "2"));
  del.addEventListener("click", async () => {
    try { await mutate({ type: 'DELETE_ITEM', id: item.id }); await renderList(); await renderHome(); }
    catch (error) { alert(errorText(error)); }
  });

  li.append(check, body, del);
  return li;
}

// ===========================================================================
// SETTINGS
// ===========================================================================

async function mutate(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || t('genericFailure'));
  return result;
}
let connection = null, keyStatus = { saved: false }, validationSequence = 0, preferencesDirty = false, checkingConnection = false;
let pending = null, authError = null, keyValidation = null, pendingError = null, tableLinkError = null;
const element = id => document.getElementById(id);
let currentRoute = 'settings';
function applyRoute(route) {
  currentRoute = ROUTES.includes(route) ? route : 'settings';
  for (const view of ROUTES) element(view).hidden = view !== currentRoute;
  for (const [id, view] of [['nav-home', 'home'], ['nav-collection', 'reading-list'], ['nav-settings', 'settings']]) {
    if (view === currentRoute) element(id).setAttribute('aria-current', 'page'); else element(id).removeAttribute('aria-current');
  }
  document.title = `ReadFlow · ${t(currentRoute === 'reading-list' ? 'collection' : currentRoute)}`;
}
async function renderHome() {
  const items = (await getItems()).filter(item => !item.feishuDeleted);
  element('home-counts').textContent = t('homeCounts', { unread: items.filter(isUnread).length, skipped: items.filter(item => item.status === '跳过').length, read: items.filter(item => item.read && item.status !== '跳过').length });
  element('home-status').textContent = t(connection?.connected && keyStatus.saved && keyStatus.matchesEndpoint ? 'homeReady' : 'homeNeedsSetup');
}
function fillSettings(settings) {
  element('connectionUrl').value = settings.connectionUrl ?? '';
  element('reminderTime').value = settings.reminderTime || '10:00';
  element('timeZone').value = settings.timeZone || 'Asia/Shanghai';
  element('remindersEnabled').checked = settings.remindersEnabled === true;
}
function updateSyncButton() {
  const endpoint = addressFeedback();
  const ready = !!endpoint && endpoint === keyStatus.baseUrl && !checkingConnection && connection?.connected && keyStatus.saved && keyStatus.matchesEndpoint;
  element('sync').disabled = !ready;
  element('export-csv').disabled = !ready;
  element('export-table').disabled = !ready || !connection?.configuration?.exportAvailable;
  element('sync-help').textContent = t(ready ? 'syncReady' : 'syncUnavailable');
}
function renderKeyStatus() {
  let visibleEndpoint = '';
  try { visibleEndpoint = endpointValue(element('connectionUrl').value); } catch {}
  const pair = pairingView || (visibleEndpoint === keyStatus.baseUrl ? keyStatus : { status: 'unpaired' });
  element('pair-status').textContent = t(pair.approved || pair.status === 'approved' ? 'pairApproved' : pair.status === 'pending' ? 'pairPending' : 'pairUnpaired');
  element('pair-fingerprint').textContent = pair.fingerprint ? t('pairFingerprint', { fingerprint: pair.fingerprint }) : '';
  element('pair-command').textContent = pair.status === 'pending' ? `node examples/run.mjs pair-approve private/host.json --pair-id ${pair.pairId} --fingerprint ${pair.fingerprint}` : '';
}
async function refreshKeyStatus() {
  const pair = await mutate({ type: 'PAIR_STATUS' });
  keyStatus = { ...pair, saved: pair.approved, matchesEndpoint: pair.approved }; pairingView = null; renderKeyStatus();
}
function addressFeedback() {
  element('connectionUrl').removeAttribute('aria-invalid');
  try { const target = endpointValue(element('connectionUrl').value); element('endpoint-error').textContent = ''; return target; }
  catch (error) { element('connectionUrl').setAttribute('aria-invalid', 'true'); element('endpoint-error').textContent = errorText(error); return null; }
}
function collectSettings() {
  const connectionUrl = addressFeedback();
  if (connectionUrl === null) { element('connectionUrl').focus(); throw new Error(element('endpoint-error').textContent); }

  for (const id of ['reminderTime', 'timeZone']) element(id).removeAttribute('aria-invalid');
  try { validateSchedule(element('reminderTime').value, element('timeZone').value); } catch (error) {
    for (const id of ['reminderTime', 'timeZone']) element(id).setAttribute('aria-invalid', 'true');
    element('schedule-note').textContent = errorText(error); element('reminderTime').focus(); throw error;
  }
  return { connectionUrl, provider: 'database', reminderTime: element('reminderTime').value, timeZone: element('timeZone').value, language: uiLanguage,
    ...(!element('remindersEnabled').disabled ? { remindersEnabled: element('remindersEnabled').checked } : {}) };
}
async function showSyncStatus() {
  const { knowledgeSync } = await chrome.storage.local.get('knowledgeSync');
  element('sync-status').textContent = knowledgeSync?.error ? errorText(knowledgeSync.error) : '';
}
function renderPending() {
  element('pending-card').hidden = !connection?.connected || !pending;
  if (pending) element('pending-note').textContent = t('pendingNote', { count: pending.recordIds.length,
    time: new Date(pending.createdAt).toLocaleString(locale()), reference: pending.id });
}
function renderConnection(status) {
  connection = status;
  element('auth-status').textContent = authError ? errorText(authError) : t(checkingConnection ? 'checking' : status?.connected ? 'connected' : 'disconnected');
  if (pendingError) element('auth-status').textContent += t('pendingFailed', { error: errorText(pendingError) });
  const config = status?.configuration;
  // The chat belongs to reminder configuration, not to the pasted table URL.
  element('chatId').value = status?.connected ? config?.chatId || '' : '';
  element('remindersEnabled').disabled = !status?.connected || config?.remindersAvailable !== true;
  if (!preferencesDirty) {
    if (config?.reminderTime) element('reminderTime').value = config.reminderTime;
    if (config?.timeZone) element('timeZone').value = config.timeZone;
    element('remindersEnabled').checked = config?.remindersEnabled === true;
  }
  element('disconnect').disabled = !status?.connected && !keyStatus.saved;
  const target = config?.exportUrl;
  const safeTarget = typeof target === 'string' && /^https:\/\/(?:my\.)?feishu\.cn\/base\/[A-Za-z0-9]+\?table=tbl[A-Za-z0-9]+$/.test(target);
  element('export-target').hidden = !status?.connected || !safeTarget;
  element('export-target').textContent = t('openExportTable');
  if (safeTarget) element('export-target').href = target; else element('export-target').removeAttribute('href');
  element('export-target-note').textContent = t(config?.exportAvailable ? 'exportConfigured' : 'exportNotConfigured');
  element('schedule-note').textContent = config?.remindersAvailable ? t('schedule', { state: t(config.remindersEnabled ? 'on' : 'off'), zone: config.timeZone, time: config.reminderTime || '10:00' }) : t('scheduleUnavailable');
  element('connection-meta').textContent = t('footer', { server: keyStatus.baseUrl || t('offline'), version: chrome.runtime.getManifest().version, extensionId: chrome.runtime.id || t('unverified'), protocol: status?.protocolVersion || t('unverified') });
  updateSyncButton(); renderPending();
  renderHome().catch(() => { element('home-status').textContent = t('genericFailure'); });
}
function translatePage() {
  document.documentElement.lang = uiLanguage;
  element('ui-language').value = uiLanguage;
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.getAttribute('data-i18n'));
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder')));
  element('agent-task').value = t('agentTask', { extensionId: chrome.runtime.id || t('unverified') });
  applyRoute(currentRoute);
}
async function showConnection({ proposedKey = false, authorize = false } = {}) {
  const sequence = ++validationSequence;
  authError = null; pendingError = null; tableLinkError = null; checkingConnection = true;
  element('auth-status').textContent = t('checking');
  element('sync').disabled = true;
  const value = '';
  try {
    const connectionUrl = endpointValue(element('connectionUrl').value);
    if (authorize && !await requestEndpointPermission(connectionUrl)) throw new Error(t('permissionDenied'));
    if (sequence !== validationSequence) return;
    if (authorize) {
      const pair = await mutate({ type: 'PAIR_REQUEST', connectionUrl });
      if (sequence !== validationSequence) return;
      pairingView = pair; renderKeyStatus();
      if (pair.status !== 'approved') { checkingConnection = false; renderConnection(null); return; }
    }
    const linkPayload = {};
    const status = await mutate(proposedKey ? { type: 'VALIDATE_CONNECTION', provider: 'database', connectionUrl, ...linkPayload } : { type: 'CONNECTION_STATUS', provider: 'database', connectionUrl, ...linkPayload });
    if (sequence !== validationSequence) return;
    checkingConnection = false; renderConnection(status);
    keyValidation = status.connected ? { message: value ? 'keyAccepted' : 'savedKeyAccepted' } : null; renderKeyStatus();
    pending = null; element('pending-card').hidden = true;
    if (status.connected && !value) {
      try {
        const result = await mutate({ type: 'PENDING' });
        if (sequence !== validationSequence) return;
        pending = result.pending;
        element('pending-card').hidden = !connection?.connected || !pending;
        renderPending();
      } catch (error) { if (sequence === validationSequence) { pendingError = error.message; renderConnection(status); } }
    }
  } catch (error) {
    if (sequence !== validationSequence) return;
    checkingConnection = false; authError = error.message; keyValidation = { error: error.message };
    if (error.message.includes('PAIR_REQUIRED')) { pairingView = { status: 'unpaired' }; keyStatus.saved = false; keyStatus.matchesEndpoint = false; }
    renderConnection(null); renderKeyStatus();
    throw error;
  }
}
function bindAction(id, action) {
  const button = element(id);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await action(); }
    catch (error) {
      element('sync-status').textContent = errorText(error);
    } finally { if (id === 'sync') updateSyncButton(); else button.disabled = false; }
  });
}
function flashSaved() {
  const note = document.getElementById("saved-note");
  note.classList.add("show");
  setTimeout(() => note.classList.remove("show"), 1800);
}

// ===========================================================================
// STARTUP
// ===========================================================================

async function init() {
  const { uiLanguage: savedLanguage } = await chrome.storage.local.get('uiLanguage');
  uiLanguage = chooseLanguage(savedLanguage);
  translatePage();
  applyRoute(initialRoute(location.hash, false));
  globalThis.addEventListener?.('hashchange', () => applyRoute(initialRoute(location.hash, connection?.connected && keyStatus.saved && keyStatus.matchesEndpoint && !element('sync').disabled)));
  await renderList();
  await showSyncStatus();
  fillSettings(await getSettings());

  element('copy-agent-task').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(element('agent-task').value); element('copy-agent-status').textContent = t('taskCopied'); }
    catch { element('task-preview').open = true; element('agent-task').focus(); element('agent-task').select(); element('copy-agent-status').textContent = t('taskCopyFallback'); }
  });
  await refreshKeyStatus();
  renderConnection(null);
  element('connectionUrl').addEventListener('input', () => { validationSequence++; checkingConnection = false; pending = null; connection = null; keyValidation = null; pairingView = null; authError = null; renderConnection(null); renderKeyStatus(); addressFeedback(); });
  element('ui-language').addEventListener('change', async () => {
    uiLanguage = chooseLanguage(element('ui-language').value); preferencesDirty = true;
    await chrome.storage.local.set({ uiLanguage });
    translatePage(); renderKeyStatus(); renderConnection(connection);
    await renderList(); await renderHome(); await showSyncStatus();
  });
  for (const id of ['reminderTime', 'timeZone']) element(id).addEventListener('change', () => { preferencesDirty = true; });
  element('disconnect').addEventListener('click', async () => {
    validationSequence++; checkingConnection = false; tableLinkError = null; keyValidation = null; pendingError = null;
    try { await mutate({ type: 'DISCONNECT' }); connection = null; pending = null; preferencesDirty = false; authError = null;
      fillSettings({ language: uiLanguage }); await refreshKeyStatus(); renderConnection(null); await renderList(); applyRoute('settings');
    } catch (error) { element('auth-status').textContent = errorText(error); }
  });
  element('remindersEnabled').addEventListener('change', () => { preferencesDirty = true; });
  bindAction('save', async () => {
    const settings = collectSettings(), sequence = validationSequence;
    if (!await requestEndpointPermission(settings.connectionUrl)) throw new Error(t('permissionDenied'));
    if (sequence !== validationSequence) throw new Error('Connection settings changed during the request. Retry.');
    const result = await mutate({ type: 'SAVE_SETTINGS', settings });
    preferencesDirty = false; fillSettings(result.settings);
    await refreshKeyStatus();
    flashSaved(); await showConnection(); await renderList();
  });
  async function exportLibrary(type) {
    element('export-status').textContent = t('exportWorking');
    try {
      await mutate({ type: 'SYNC' });
      const result = await mutate({ type });
      if (type === 'EXPORT_CSV') {
        if (typeof result.csv !== 'string') throw new Error(t('genericFailure'));
        const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = 'readflow.csv'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      element('export-status').textContent = t(type === 'EXPORT_CSV' ? 'csvDone' : 'exportDone');
    } catch (error) { element('export-status').textContent = errorText(error); }
  }
  bindAction('export-table', () => exportLibrary('EXPORT_TABLE'));
  bindAction('export-csv', () => exportLibrary('EXPORT_CSV'));
  bindAction('check-connection', () => showConnection({ proposedKey: true, authorize: true }));
  bindAction('sync', async () => { await mutate({ type: 'SYNC' }); await showSyncStatus(); await showConnection(); });
  for (const [id, outcome] of [['confirm-sent', 'sent'], ['confirm-not-sent', 'not-sent']]) {
    bindAction(id, async () => { await mutate({ type: 'RESOLVE_PENDING', uuid: pending?.id, outcome }); await showConnection(); });
  }
  try { await showConnection(); } catch { /* showConnection renders the failure. */ }

  const configured = connection?.connected && keyStatus.saved && keyStatus.matchesEndpoint && !element('sync').disabled;
  applyRoute(initialRoute(location.hash, configured));
  await renderHome(); await renderList();

  // Keep the list fresh if a save happens (from the toolbar icon) while this
  // tab is open.
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.items) { renderList(); renderHome(); }
    if (changes.knowledgeSync) showSyncStatus();
  });
}

init();
