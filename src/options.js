import { CONNECTION_ORIGIN } from './lib/connection-config.js';
import { isSafeArticleUrl } from './lib/security.js';
// Dashboard reads cached data; the background worker serializes all mutations.

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
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function renderList() {
  const list = document.getElementById("list");
  const items = await getItems();
  list.replaceChildren();

  const count = document.getElementById("list-count");
  const unread = items.filter((it) => !it.read).length;
  count.textContent = items.length
    ? `${items.length} saved · ${unread} unread`
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
  h.textContent = "Nothing saved yet";
  const p = document.createElement("p");
  p.textContent = "Click the NewsBridge icon in your toolbar on any article to save it here.";
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
  check.title = item.read ? "Mark as unread" : "Mark as read";
  check.setAttribute('aria-label', check.title);
  check.appendChild(svg(["M20 6L9 17l-5-5"], "2.4"));
  check.addEventListener("click", async () => {
    check.disabled = true;
    try { await mutate({ type: 'SET_READ', id: item.id, read: !item.read }); await renderList(); }
    catch (error) { alert(error.message); }
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
  const metaText = `${domainOf(item.url)} · saved ${savedAgo(item.savedAt)}`;
  meta.append(document.createTextNode(metaText));
  // A tag for items already delivered in a reading message.
  if (item.notifiedAt) {
    const tag = document.createElement("span");
    tag.className = "tag sent";
    tag.textContent = "Sent";
    meta.append(tag);
  }

  body.append(title, meta);

  // Delete button.
  const del = document.createElement("button");
  del.className = "del";
  del.title = "Remove";
  if (item.feishuRecordId) {
    del.title = 'Delete this item in Feishu Bitable, then sync.';
    del.disabled = true;
  }
  del.setAttribute('aria-label', del.title);
  del.appendChild(svg(["M18 6L6 18", "M6 6l12 12"], "2"));
  del.addEventListener("click", async () => {
    try { await mutate({ type: 'DELETE_ITEM', id: item.id }); await renderList(); }
    catch (error) { alert(error.message); }
  });

  li.append(check, body, del);
  return li;
}

// ===========================================================================
// SETTINGS
// ===========================================================================

async function mutate(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || 'Could not complete the operation.');
  return result;
}
function fillSettings(settings) {
  document.getElementById('language').value = settings.language;
}
function collectSettings() { return { language: document.getElementById('language').value, connectionAccessKey: document.getElementById('connectionAccessKey').value.trim() }; }
async function showSyncStatus() {
  const { knowledgeSync } = await chrome.storage.local.get('knowledgeSync');
  document.getElementById('sync-status').textContent = knowledgeSync?.error || '';
}

let pending = null;
async function showConnection() {
  const status = await mutate({ type: 'CONNECTION_STATUS' });
  document.getElementById('auth-status').textContent = status.connected ? `Connected to ${CONNECTION_ORIGIN}; connection identity verified.` : 'Local collection mode. An existing connection can enable Feishu sync.';
  for (const key of ['baseToken', 'articleTableId', 'chatId']) document.getElementById(key).value = status.configuration?.[key] || '';
  if (status.configuration?.language) document.getElementById('language').value = status.configuration.language;
  document.getElementById('schedule-note').textContent = status.configuration?.remindersEnabled ? `Your connected tool schedules unread reminders at 10:00 (${status.configuration.timeZone}). Sending does not mark items read.` : 'Daily reminders are not enabled. Your connected tool can schedule them.';
  pending = status.connected ? (await mutate({ type: 'PENDING' })).pending : null;
  document.getElementById('pending-card').hidden = !pending;
  if (pending) document.getElementById('pending-note').textContent = `${pending.recordIds.length} items · requested ${new Date(pending.createdAt).toLocaleString()} · reference ${pending.id}`;
}
function bindAction(id, action) {
  const button = document.getElementById(id);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await action(); await showConnection(); await showSyncStatus(); }
    catch (error) { document.getElementById('sync-status').textContent = error.message; }
    finally { button.disabled = false; }
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
  await renderList();
  await showSyncStatus();
  fillSettings(await getSettings());
  document.getElementById('schedule-note').textContent = 'Daily reminders are optional and run through your connected tool.';

  bindAction('save', async () => {
    const result = await mutate({ type: 'SAVE_SETTINGS', settings: collectSettings() });
    fillSettings(result.settings);
    document.getElementById('connectionAccessKey').value = '';
    flashSaved();
  });
  bindAction('check-connection', async () => {});
  bindAction('sync', () => mutate({ type: 'SYNC' }));
  for (const [id, outcome] of [['confirm-sent', 'sent'], ['confirm-not-sent', 'not-sent']]) {
    bindAction(id, () => mutate({ type: 'RESOLVE_PENDING', uuid: pending?.id, outcome }));
  }
  try { await showConnection(); } catch (error) { document.getElementById('auth-status').textContent = error.message; }

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
    if (changes.knowledgeSync) { showSyncStatus(); showConnection().catch(() => {}); }
  });
}

init();
