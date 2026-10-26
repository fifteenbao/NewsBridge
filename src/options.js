import { readingNote } from './lib/reading-note.js';
import { isUnread, readingStatus } from './lib/reading-state.js';
import { initialRoute, ROUTES } from './lib/navigation.js';
import { chooseLanguage, translate, localizeError } from './lib/options-i18n.js';
import { endpointValue, requestEndpointPermission } from './lib/endpoint.js';
import { isSafeArticleUrl } from './lib/security.js';
let uiLanguage = 'zh', pairingView = null;
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

let selectedStatus = '待阅读';
const statusTabs = [['filter-unread', '待阅读', 'unread'], ['filter-read', '已读', 'read'], ['filter-skip', '跳过', 'skip']];
async function renderList() {
  const list = document.getElementById("list");
  const all = (await getItems()).filter(item => !item.feishuDeleted);
  const items = all.filter(item => readingStatus(item) === selectedStatus);
  for (const [id, value, key] of statusTabs) {
    element(id).textContent = `${t(key)} (${all.filter(item => readingStatus(item) === value).length})`;
    element(id).setAttribute('aria-pressed', String(selectedStatus === value));
  }
  list.replaceChildren();

  const count = document.getElementById("list-count");
  count.textContent = t('collectionCount', { count: all.length });

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
  h.textContent = t('emptyStatus', { status: t(statusTabs.find(tab => tab[1] === selectedStatus)[2]) });
  const p = document.createElement("p");
  p.textContent = t('emptyHint');
  li.append(ornament, h, p);
  return li;
}

function renderItem(item, index) {
  const li = document.createElement("li");
  li.className = "item collection-row";

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
  title.textContent = item.title?.trim() || item.url || t('untitled');
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
  const tags = document.createElement('div'); tags.className = 'collection-tags';
  for (const value of item.tags || []) {
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = value; tags.appendChild(tag);
  }
  if (!item.tags?.length) tags.textContent = t('noTags');
  const note = document.createElement('details'); note.className = 'collection-note';
  const summary = document.createElement('summary');
  const noteText = readingNote(item);
  summary.textContent = noteText ? noteText.slice(0, 80) + (noteText.length > 80 ? '…' : '') : t('noNote');
  note.appendChild(summary);
  if (noteText) { const full = document.createElement('p'); full.textContent = noteText; note.appendChild(full); }


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

  li.append(body, tags, note, check, del);
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
let connection = null, pairingState = { approved: false }, validationSequence = 0, checkingConnection = false;
let authError = null;
const element = id => document.getElementById(id);
let currentRoute = 'settings';
let configuredLibrary = false, busyAction = null;
function applyRoute(route) {
  currentRoute = ROUTES.includes(route) ? route : 'settings';
  for (const view of ROUTES) element(view).hidden = view !== currentRoute;
  for (const [id, view] of [['nav-collection', 'reading-list'], ['nav-settings', 'settings']]) {
    if (view === currentRoute) element(id).setAttribute('aria-current', 'page'); else element(id).removeAttribute('aria-current');
  }
  document.title = `ReadFlow · ${t(currentRoute === 'reading-list' ? 'collection' : currentRoute)}`;
}
async function renderHome() {
  const items = (await getItems()).filter(item => !item.feishuDeleted);
  element('home-counts').textContent = t('homeCounts', { unread: items.filter(isUnread).length, skipped: items.filter(item => item.status === '跳过').length, read: items.filter(item => item.read && item.status !== '跳过').length });
  element('collection-setup').hidden = configuredLibrary;
  element('home-status').textContent = t(connection?.connected && pairingState.approved ? 'homeReady' : 'homeNeedsSetup');
}
function fillSettings(settings) {
  element('connectionUrl').value = settings.connectionUrl ?? '';
}
function updateSyncButton() {
  const endpoint = addressFeedback();
  const ready = !!endpoint && endpoint === pairingState.baseUrl && !checkingConnection && connection?.connected && pairingState.approved;
  element('sync').disabled = !ready || !!busyAction;
  element('export-csv').disabled = !ready || !!busyAction;
  element('sync-help').textContent = t(ready ? 'syncReady' : 'syncUnavailable');
}
function renderPairingStatus() {
  let visibleEndpoint = '';
  try { visibleEndpoint = endpointValue(element('connectionUrl').value); } catch {}
  const pair = pairingView || (visibleEndpoint === pairingState.baseUrl ? pairingState : { status: 'unpaired' });
  element('pair-status').textContent = t(pair.approved || pair.status === 'approved' ? 'pairApproved' : pair.status === 'pending' ? 'pairPending' : 'pairUnpaired');
  element('pair-fingerprint').textContent = pair.fingerprint ? t('pairFingerprint', { fingerprint: pair.fingerprint }) : '';
  element('pair-details').hidden = !pair.fingerprint;
  element('copy-pair-task').disabled = !pair.fingerprint || !!busyAction;
  element('save').disabled = !pair.fingerprint && !pair.approved || !!busyAction;
  element('pair-task').value = pair.fingerprint ? t('pairTask', { endpoint: visibleEndpoint, extensionId: chrome.runtime.id || '', pairId: pair.pairId, fingerprint: pair.fingerprint }) : '';
}
async function refreshPairingStatus() {
  const pair = await mutate({ type: 'PAIR_STATUS' });
  pairingState = pair; pairingView = null; renderPairingStatus();
}
function addressFeedback() {
  element('connectionUrl').removeAttribute('aria-invalid');
  try { const target = endpointValue(element('connectionUrl').value); element('endpoint-error').textContent = ''; return target; }
  catch (error) { element('connectionUrl').setAttribute('aria-invalid', 'true'); element('endpoint-error').textContent = errorText(error); return null; }
}
function collectSettings() {
  const connectionUrl = addressFeedback();
  if (connectionUrl === null) { element('connectionUrl').focus(); throw new Error(element('endpoint-error').textContent); }

  return { connectionUrl, provider: 'database', language: uiLanguage };
}
async function showSyncStatus() {
  const { knowledgeSync } = await chrome.storage.local.get('knowledgeSync');
  element('sync-status').textContent = knowledgeSync?.error ? errorText(knowledgeSync.error) : '';
}
function renderConnection(status) {
  connection = status;
  element('setup-guide').hidden = configuredLibrary;
  element('pair-help').hidden = configuredLibrary;
  element('auth-status').setAttribute('data-state', authError ? 'error' : status?.connected ? 'success' : 'info');
  element('auth-status').textContent = authError ? errorText(authError) : t(checkingConnection ? 'checking' : pairingView?.status === 'pending' ? 'pairWaiting' : status?.connected ? configuredLibrary ? 'connected' : 'connectedUnsaved' : configuredLibrary ? 'configuredOffline' : 'disconnected');
  element('disconnect').disabled = !configuredLibrary || !!busyAction;
  element('connection-meta').textContent = t('footer', { server: pairingState.baseUrl || t('offline'), version: chrome.runtime.getManifest().version, extensionId: chrome.runtime.id || t('unverified'), protocol: status?.protocolVersion || t('unverified') });
  updateSyncButton();
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
async function showConnection({ verifyOnly = false, authorize = false } = {}) {
  const sequence = ++validationSequence;
  authError = null; checkingConnection = true;
  element('auth-status').textContent = t('checking');
  updateSyncButton();
  try {
    const connectionUrl = endpointValue(element('connectionUrl').value);
    if (authorize && !await requestEndpointPermission(connectionUrl)) throw new Error(t('permissionDenied'));
    if (sequence !== validationSequence) return;
    if (authorize) {
      const pair = await mutate({ type: 'PAIR_REQUEST', connectionUrl });
      if (sequence !== validationSequence) return;
      pairingView = pair; renderPairingStatus();
      if (pair.status !== 'approved') { checkingConnection = false; renderConnection(null); throw new Error(t('pairWaiting')); }
    }
    const linkPayload = {};
    const status = await mutate(verifyOnly ? { type: 'VALIDATE_CONNECTION', provider: 'database', connectionUrl, ...linkPayload } : { type: 'CONNECTION_STATUS', provider: 'database', connectionUrl, ...linkPayload });
    if (sequence !== validationSequence) return;
    checkingConnection = false; renderConnection(status);
    renderPairingStatus();

  } catch (error) {
    if (sequence !== validationSequence) return;
    checkingConnection = false; authError = error.message;
    if (error.message.includes('PAIR_REQUIRED')) pairingState.approved = false;
    renderConnection(null); renderPairingStatus();
    throw error;
  }
}
function bindAction(id, action) {
  const button = element(id);
  button.addEventListener('click', async () => {
    if (busyAction) return;
    busyAction = id;
    const controls = ['save', 'check-connection', 'copy-pair-task', 'connectionUrl', 'disconnect', 'sync', 'export-csv'];
    const previous = controls.map(name => [name, element(name).disabled]);
    for (const name of controls) element(name).disabled = true;
    const feedback = id === 'sync' ? 'sync-status' : id.startsWith('export-') ? 'export-status' : 'auth-status';
    element(feedback).textContent = ''; element(feedback).removeAttribute('data-state');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    updateSyncButton();
    try { await action(); }
    catch (error) { element(feedback).textContent = errorText(error); element(feedback).setAttribute('data-state', 'error'); }
    finally {
      busyAction = null;
      for (const [name, disabled] of previous) element(name).disabled = disabled;
      element('disconnect').disabled = !configuredLibrary;
      button.removeAttribute('aria-busy'); updateSyncButton(); renderPairingStatus();
    }
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
  for (const [id, value] of statusTabs) element(id).addEventListener('click', async () => { selectedStatus = value; await renderList(); });
  applyRoute(initialRoute(location.hash, false));
  globalThis.addEventListener?.('hashchange', () => applyRoute(initialRoute(location.hash, connection?.connected && pairingState.approved && !element('sync').disabled)));
  await renderList();
  await showSyncStatus();
  fillSettings(await getSettings());

  element('copy-agent-task').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(element('agent-task').value); element('copy-agent-status').textContent = t('taskCopied'); }
    catch { element('task-preview').open = true; element('agent-task').focus(); element('agent-task').select(); element('copy-agent-status').textContent = t('taskCopyFallback'); }
  });
  element('copy-pair-task').addEventListener('click', async () => {
    if (!element('pair-task').value) return;
    try { await navigator.clipboard.writeText(element('pair-task').value); element('copy-pair-status').textContent = t('taskCopied'); }
    catch { element('pair-task-preview').open = true; element('pair-task').focus(); element('pair-task').select(); element('copy-pair-status').textContent = t('taskCopyFallback'); }
  });
  await refreshPairingStatus();
  const savedLibrary = await chrome.storage.local.get(['collectionIdentity', 'connectionEndpoint']);
  configuredLibrary = !!(savedLibrary.collectionIdentity && savedLibrary.connectionEndpoint) || pairingState.approved && !!pairingState.baseUrl;
  renderConnection(null);
  element('connectionUrl').addEventListener('input', () => { validationSequence++; checkingConnection = false; connection = null; pairingView = null; authError = null; renderConnection(null); renderPairingStatus(); addressFeedback(); });
  element('ui-language').addEventListener('change', async () => {
    uiLanguage = chooseLanguage(element('ui-language').value);
    await chrome.storage.local.set({ uiLanguage });
    translatePage(); renderPairingStatus(); renderConnection(connection);
    await renderList(); await renderHome(); await showSyncStatus();
  });
  bindAction('disconnect', async () => {
    if (!globalThis.confirm(t('disconnectConfirm'))) return;
    validationSequence++; checkingConnection = false;
    try { await mutate({ type: 'DISCONNECT' }); configuredLibrary = false; connection = null; authError = null;
      fillSettings({ language: uiLanguage }); await refreshPairingStatus(); renderConnection(null); await renderList(); applyRoute('settings');
    } catch (error) { element('auth-status').textContent = errorText(error); }
  });
  bindAction('save', async () => {
    const settings = collectSettings();
    await showConnection({ verifyOnly: true, authorize: true });
    if (!connection?.connected) return;
    const sequence = validationSequence;
    if (!await requestEndpointPermission(settings.connectionUrl)) throw new Error(t('permissionDenied'));
    if (sequence !== validationSequence) throw new Error('Connection settings changed during the request. Retry.');
    const result = await mutate({ type: 'SAVE_SETTINGS', settings });
    configuredLibrary = true; fillSettings(result.settings);
    await refreshPairingStatus();
    flashSaved(); await showConnection(); await renderList();
  });
  async function exportLibrary() {
    element('export-status').textContent = t('exportWorking');
    try {
      await mutate({ type: 'SYNC' });
      const result = await mutate({ type: 'EXPORT_CSV' });
      {
        if (typeof result.csv !== 'string') throw new Error(t('genericFailure'));
        const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = 'readflow.csv'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      element('export-status').textContent = t('csvDone');
    } catch (error) { element('export-status').textContent = errorText(error); }
  }
  bindAction('export-csv', exportLibrary);
  bindAction('check-connection', async () => {
    const connectionUrl = addressFeedback();
    if (!connectionUrl) return;
    const sequence = ++validationSequence;
    if (!await requestEndpointPermission(connectionUrl)) throw new Error(t('permissionDenied'));
    const pair = await mutate({ type: 'PAIR_REQUEST', connectionUrl });
    if (sequence !== validationSequence) return;
    pairingView = pair; authError = null; renderPairingStatus(); renderConnection(null);
    element('auth-status').textContent = t(pair.status === 'approved' ? 'pairReady' : 'pairWaiting');
  });
  bindAction('sync', async () => {
    element('sync-status').textContent = t('syncWorking');
    await mutate({ type: 'SYNC' });
    await renderList(); await renderHome();
    element('sync-status').textContent = t('syncDone');
  });
  if (pairingState.approved) { try { await showConnection(); } catch { /* failure is shown next to the action */ } }

  const configured = connection?.connected && pairingState.approved && !element('sync').disabled;
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
