import { chooseLanguage, translate, localizeError } from './lib/options-i18n.js';
import { parseTableUrl } from './lib/table-url.js';
import { CONNECTION_BASE_URL } from './lib/connection-config.js';
import { isSafeArticleUrl } from './lib/security.js';
let uiLanguage = 'en';
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
  const items = await getItems();
  list.replaceChildren();

  const count = document.getElementById("list-count");
  const unread = items.filter((it) => !it.read).length;
  count.textContent = items.length
    ? t('count', { total: items.length, unread })
    : "";

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

  // Round read/unread checkbox.
  const check = document.createElement("button");
  check.className = "check";
  check.title = t(item.read ? 'markUnread' : 'markRead');
  check.setAttribute('aria-label', check.title);
  check.appendChild(svg(["M20 6L9 17l-5-5"], "2.4"));
  check.addEventListener("click", async () => {
    check.disabled = true;
    try { await mutate({ type: 'SET_READ', id: item.id, read: !item.read }); await renderList(); }
    catch (error) { alert(errorText(error)); }
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
    try { await mutate({ type: 'DELETE_ITEM', id: item.id }); await renderList(); }
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
function fillSettings(settings) {
  element('language').value = settings.language;
  element('tableUrl').value = settings.tableUrl || '';
  element('remindersEnabled').checked = settings.remindersEnabled === true;
}
function tableFeedback() {
  const input = element('tableUrl'), note = element('table-url-error');
  input.removeAttribute('aria-invalid');
  let table;
  try { table = input.value.trim() ? parseTableUrl(input.value.trim()) : null; }
  catch (error) {
    element('baseToken').value = ''; element('articleTableId').value = '';
    element('table-id-source').textContent = t('idsEmpty');
    input.setAttribute('aria-invalid', 'true'); note.textContent = errorText(error); return false;
  }
  const config = connection?.connected ? connection.configuration : null;
  const resolved = table?.kind === 'wiki' && connection?.connected && connection.resolvedTable?.url === table.url ? connection.resolvedTable : null;
  const base = table?.kind === 'wiki' ? resolved?.baseToken : table?.baseToken;
  const sameBase = !!config && base === config.baseToken;
  element('baseToken').value = base || (!table ? config?.baseToken : '') || '';
  element('articleTableId').value = table?.articleTableId || (table?.kind === 'wiki' ? resolved?.articleTableId : sameBase || !table ? config?.articleTableId : '') || '';
  if (!table) {
    note.textContent = t('tableEmpty');
    element('table-id-source').textContent = t(config ? 'idsServer' : 'idsEmpty'); return true;
  }
  if (tableLinkError?.url === table.url) {
    input.setAttribute('aria-invalid', 'true'); note.textContent = errorText(tableLinkError.error);
    element('table-id-source').textContent = t(table.kind === 'wiki' ? 'wikiPending' : 'idsParsed'); return false;
  }
  if (table.kind === 'wiki' && !resolved) {
    note.textContent = t('wikiPending'); element('table-id-source').textContent = t('wikiPending');
    return !connection?.connected;
  }
  const matches = sameBase && (!table.articleTableId || table.articleTableId === config.articleTableId);
  element('table-id-source').textContent = t(matches ? table.kind === 'wiki' ? 'wikiVerified' : !table.articleTableId ? 'idsConfigured' : 'idsVerified' : 'idsParsed');
  if (!config) { note.textContent = t(table.articleTableId ? 'tableFormat' : 'basePending'); return true; }
  if (!matches) { input.setAttribute('aria-invalid', 'true'); note.textContent = t('tableMismatch'); return false; }
  note.textContent = t('tableVerified'); return true;
}
function updateSyncButton() {
  const matches = tableFeedback();
  const ready = !checkingConnection && connection?.connected && keyStatus.saved && keyStatus.matchesEndpoint && !element('connectionAccessKey').value.trim() && matches;
  element('sync').disabled = !ready;
  element('sync-help').textContent = t(ready ? 'syncReady' : 'syncUnavailable');
}
function renderKeyStatus() {
  element('key-status').textContent = keyStatus.saved ? t('keySaved', {
    time: keyStatus.savedAt ? new Date(keyStatus.savedAt).toLocaleString(locale()) : t('timeUnknown'),
    endpoint: keyStatus.matchesEndpoint ? '' : t('endpointChanged'),
  }) : t('noKey');
  element('key-validation').textContent = keyValidation ? (keyValidation.error ? errorText(keyValidation.error) : t(keyValidation.message)) : '';
}
async function refreshKeyStatus() {
  keyStatus = await mutate({ type: 'KEY_STATUS' }); renderKeyStatus();
}
function collectSettings() {
  if (!tableFeedback()) { element('tableUrl').focus(); throw new Error(element('table-url-error').textContent); }
  const raw = element('tableUrl').value.trim();
  return { tableUrl: raw ? parseTableUrl(raw).url : '', language: element('language').value,
    connectionAccessKey: element('connectionAccessKey').value.trim(),
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
    if (config?.language) element('language').value = config.language;
    element('remindersEnabled').checked = config?.remindersEnabled === true;
  }
  element('schedule-note').textContent = config?.remindersAvailable ? t('schedule', { state: t(config.remindersEnabled ? 'on' : 'off'), zone: config.timeZone }) : t('scheduleUnavailable');
  element('connection-meta').textContent = t('footer', { server: CONNECTION_BASE_URL || t('offline'), version: chrome.runtime.getManifest().version, protocol: status?.protocolVersion || t('unverified') });
  updateSyncButton(); renderPending();
}
function translatePage() {
  document.documentElement.lang = uiLanguage;
  element('ui-language').value = uiLanguage;
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.getAttribute('data-i18n'));
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder')));
}
async function showConnection({ proposedKey = false } = {}) {
  const sequence = ++validationSequence;
  authError = null; pendingError = null; tableLinkError = null; checkingConnection = true;
  element('auth-status').textContent = t('checking');
  element('sync').disabled = true;
  const value = element('connectionAccessKey').value.trim();
  try {
    const rawLink = element('tableUrl').value.trim();
    const linkPayload = rawLink ? { tableUrl: parseTableUrl(rawLink).url } : {};
    const status = await mutate(proposedKey ? { type: 'VALIDATE_CONNECTION', ...linkPayload, ...(value ? { accessKey: value } : {}) } : { type: 'CONNECTION_STATUS', ...linkPayload });
    if (sequence !== validationSequence) return;
    checkingConnection = false; renderConnection(status);
    element('connectionAccessKey').removeAttribute('aria-invalid');
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
    if (/LINK_|TABLE_MISMATCH|\.wiki\.resolve/.test(error.message)) {
      try { tableLinkError = { url: parseTableUrl(element('tableUrl').value.trim()).url, error: error.message }; } catch { /* Format feedback handles invalid links. */ }
      keyValidation = null;
    }
    renderConnection(null); renderKeyStatus();
    if (error.message.includes('KEY_INVALID')) element('connectionAccessKey').setAttribute('aria-invalid', 'true');
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
      if (error.message.includes('TABLE_MISMATCH')) { element('tableUrl').setAttribute('aria-invalid', 'true'); element('table-url-error').textContent = errorText(error); element('tableUrl').focus(); }
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
  uiLanguage = chooseLanguage(savedLanguage, chrome.i18n?.getUILanguage() || globalThis.navigator?.language || 'en');
  translatePage();
  await renderList();
  await showSyncStatus();
  fillSettings(await getSettings());

  await refreshKeyStatus();
  renderConnection(null);
  element('tableUrl').addEventListener('input', () => { validationSequence++; checkingConnection = false; tableLinkError = null; updateSyncButton(); });
  element('ui-language').addEventListener('change', async () => {
    uiLanguage = chooseLanguage(element('ui-language').value);
    await chrome.storage.local.set({ uiLanguage });
    translatePage(); renderKeyStatus(); renderConnection(connection);
    await renderList(); await showSyncStatus();
  });
  element('language').addEventListener('change', () => { preferencesDirty = true; });
  element('remindersEnabled').addEventListener('change', () => { preferencesDirty = true; });
  element('connectionAccessKey').addEventListener('input', () => {
    validationSequence++; checkingConnection = false; authError = null; pendingError = null;
    keyValidation = { message: 'keyNotChecked' }; renderConnection(null); renderKeyStatus();
  });
  element('connectionAccessKey').addEventListener('blur', () => {
    if (element('connectionAccessKey').value.trim()) showConnection({ proposedKey: true }).catch(() => {});
  });
  bindAction('save', async () => {
    const result = await mutate({ type: 'SAVE_SETTINGS', settings: collectSettings() });
    preferencesDirty = false; fillSettings(result.settings);
    element('connectionAccessKey').value = ''; await refreshKeyStatus();
    flashSaved(); await showConnection();
  });
  bindAction('check-connection', () => showConnection({ proposedKey: true }));
  bindAction('sync', async () => { await mutate({ type: 'SYNC' }); await showSyncStatus(); await showConnection(); });
  for (const [id, outcome] of [['confirm-sent', 'sent'], ['confirm-not-sent', 'not-sent']]) {
    bindAction(id, async () => { await mutate({ type: 'RESOLVE_PENDING', uuid: pending?.id, outcome }); await showConnection(); });
  }
  try { await showConnection(); } catch { /* showConnection renders the failure. */ }

  // The right-click menu opens this page with #reading-list or #settings so the
  // browser jumps to the relevant section. We nudge the scroll to be sure.
  if (['#settings', '#reading-list'].includes(location.hash)) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView({ behavior: "instant", block: "start" });
  }

  // Keep the list fresh if a save happens (from the toolbar icon) while this
  // tab is open.
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.items) renderList();
    if (changes.knowledgeSync) showSyncStatus();
  });
}

init();
