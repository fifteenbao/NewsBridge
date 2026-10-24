// Encrypted Feishu callbacks -> durable inbox -> existing, locked table sync.
// Importing never binds a port, starts a timer or fetches submitted URLs.
import { createHash, createDecipheriv, timingSafeEqual, randomUUID } from 'node:crypto';
import { validateConnectorConfig } from '../connector/config.js';
import { createBridge } from '../connector/bridge.js';
import { isSafeArticleUrl } from '../src/lib/security.js';
import { cleanDiagnostic } from '../src/lib/diagnostics.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function extractArticleLinks(text) {
  if (typeof text !== 'string' || text.length > 32000) throw new Error('Invalid text message.');
  const urls = new Set();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'\u3000-\u303f\uff00-\uffef]+/gi)) {
    let value = match[0].replace(/[.,;!?]+$/, '');
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      while (value.endsWith(close) && value.split(close).length > value.split(open).length) value = value.slice(0, -1);
    }
    if (isSafeArticleUrl(value)) urls.add(new URL(value).href);
  }
  if (urls.size > 10) throw new Error('At most ten links per message.');
  return [...urls];
}

export function createFeishuInbox({ config: input, inboxConfig, adapter, store, exclusive,
  capture, sendReceipt, applyAction, getEventCredentials, onDiagnostic = () => {}, now = () => Date.now() }) {
  const config = validateConnectorConfig(input);
  const appId = config.connectionId.startsWith('app:') ? config.connectionId.slice(4) : '';
  const validList = (list, pattern) => Array.isArray(list) && list.length > 0 && list.length <= 100 && list.every(value => typeof value === 'string' && pattern.test(value));
  if (!/^cli_[A-Za-z0-9]+$/.test(appId) || inboxConfig?.enabled !== true ||
      !validList(inboxConfig.allowedChatIds, /^oc_[A-Za-z0-9]{1,128}$/) ||
      !validList(inboxConfig.allowedOpenIds, /^ou_[A-Za-z0-9]{1,128}$/) ||
      typeof getEventCredentials !== 'function') throw new Error('Configure explicit Feishu inbox app, chats and senders.');
  const scope = JSON.stringify([config.connectionId, config.baseToken, config.articleTableId]);
  const bridge = capture ? null : createBridge({ config, adapter, store, now });
  let active = 0;
  const response = (status, body = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  async function report(error) {
    const diagnostic = cleanDiagnostic(error?.diagnostic);
    try { await onDiagnostic(diagnostic || { code: 'INBOX_FAILED', stage: 'inbox' }); } catch { /* No payloads or credentials in logs. */ }
  }
  function inbox(state) {
    if (state.version !== 1 || !state.scopes) throw new Error('Invalid state.');
    state.feishuInbox ||= { scope, messages: {} };
    const value = state.feishuInbox;
    if (value.scope !== scope || !value.messages || typeof value.messages !== 'object' || Array.isArray(value.messages)) throw new Error('Inbox scope changed.');
    return value;
  }
  async function parse(request) {
    let timer, activeReader;
    // Bounded JSON read plus an overall deadline, including slow request bodies.
    const body = new Response(request.body, { headers: request.headers });
    const raw = await Promise.race([
      (async () => {
        const reader = body.body?.getReader(); activeReader = reader;
        if (!reader) throw new Error();
        let size = 0; const chunks = [];
        try {
          for (;;) {
            const { value, done } = await reader.read(); if (done) break;
            size += value.byteLength; if (size > 65536) throw new Error(); chunks.push(value);
          }
          return Buffer.concat(chunks);
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { reject(new Error()); activeReader?.cancel().catch(() => {}); }, 5000); }),
    ]).finally(() => clearTimeout(timer));
    const { encryptKey, verificationToken } = await getEventCredentials() || {};
    if (![encryptKey, verificationToken].every(v => typeof v === 'string' && v.length > 0 && v.length <= 512 && !/[\r\n]/.test(v))) throw new Error();
    const envelope = JSON.parse(raw.toString('utf8'));
    if (typeof envelope.encrypt !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.encrypt)) throw new Error();
    const encrypted = Buffer.from(envelope.encrypt, 'base64');
    if (encrypted.length < 32 || encrypted.length % 16 !== 0) throw new Error();
    const decipher = createDecipheriv('aes-256-cbc', createHash('sha256').update(encryptKey).digest(), encrypted.subarray(0, 16));
    const event = JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(16)), decipher.final()]).toString('utf8'));
    if (!equal(event.header?.token ?? event.token, verificationToken)) throw new Error();
    // URL verification has no external effects. Both decryption and token must pass.
    if (event.type === 'url_verification' && typeof event.challenge === 'string' && event.challenge.length <= 512) return event;
    const timestamp = request.headers.get('X-Lark-Request-Timestamp'), nonce = request.headers.get('X-Lark-Request-Nonce');
    const signature = request.headers.get('X-Lark-Signature');
    if (!/^\d{10}$/.test(timestamp || '') || Math.abs(now() - Number(timestamp) * 1000) > 300000 ||
        typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature || '')) throw new Error();
    const expected = createHash('sha256').update(timestamp + nonce + encryptKey).update(raw).digest('hex');
    if (!equal(signature, expected)) throw new Error();
    return event;
  }
  return {
    async handleRequest(request) {
      if (request.method !== 'POST') return response(405);
      if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return response(415);
      if (Number(request.headers.get('Content-Length')) > 65536) return response(413);
      if (active >= 2) return response(503);
      active++;
      try {
        let event;
        try { event = await parse(request); } catch { return response(401); }
        if (event.type === 'url_verification') return response(200, { challenge: event.challenge });
        if (event.schema !== '2.0' || event.header?.app_id !== appId) return response(403);
        if (event.header.event_type === 'card.action.trigger' && applyAction) {
          const body = event.event, value = body?.action?.value, chat = body?.context?.open_chat_id;
          if (!inboxConfig.allowedChatIds.includes(chat) || !inboxConfig.allowedOpenIds.includes(body?.operator?.open_id)) return response(403);
          await exclusive(async () => {
            const state = await store.load();
            const card = Object.values(state.scopes).filter(scope => scope.target?.chatId === chat)
              .map(scope => scope.cards?.[body?.context?.open_message_id]).find(Boolean);
            if (!card || card.requestId !== value?.requestId || !card.recordIds.includes(value?.recordId)) throw new Error('Unknown reading card.');
            await applyAction(event.header.event_id, value.recordId, value.action, now());
          });
          return response(200, { toast: { type: 'success', content: 'ReadFlow: saved / 已保存' } });
        }
        if (event.header.event_type !== 'im.message.receive_v1') return response(200, { code: 0 });
        const message = event.event?.message, sender = event.event?.sender;
        if (sender?.sender_type !== 'user' || message?.chat_type !== 'p2p' || message?.message_type !== 'text' ||
            !inboxConfig.allowedChatIds.includes(message.chat_id) || !inboxConfig.allowedOpenIds.includes(sender.sender_id?.open_id)) return response(200, { code: 0 });
        if (!/^om_[A-Za-z0-9]{1,128}$/.test(message.message_id || '') || typeof message.content !== 'string') return response(400);
        let links;
        try { links = extractArticleLinks(JSON.parse(message.content).text); } catch { return response(400); }
        if (!links.length) return response(200, { code: 0 });
        const id = hash(JSON.stringify([appId, message.message_id]));
        await exclusive(async () => {
          const state = await store.load(), entries = inbox(state).messages;
          if (Object.hasOwn(entries, id)) return; // Deduplicate by message_id, not event_id.
          if (Object.keys(entries).length >= 2000) throw new Error('Inbox capacity reached.');
          entries[id] = { status: 'pending', savedAt: new Date(now()).toISOString(), links, chatId: message.chat_id };
          await store.save(state); // Acknowledge only after durable enqueue, never after slow provider work.
        });
        return response(200, { code: 0 });
      } catch (error) { await report(error); return response(503); }
      finally { active--; }
    },
    async receipts(id, outcome) {
      return exclusive(async () => {
        const state = await store.load(), entries = inbox(state).messages;
        if (id === undefined) return Object.entries(entries).filter(([, e]) => e.receipt && !e.receipt.sent).map(([id, e]) => ({ id, at: e.receipt.at, count: e.links.length }));
        if (!entries[id]?.receipt || !['sent', 'not-sent'].includes(outcome)) throw new Error('Invalid receipt resolution.');
        if (outcome === 'sent') entries[id].receipt.sent = true;
        else entries[id].receipt = { ...entries[id].receipt, uuid: randomUUID(), at: now(), sent: false };
        await store.save(state); return { ok: true };
      });
    },
    async processPending() {
      return exclusive(async () => {
        const state = await store.load(), entries = inbox(state).messages;
        const pending = Object.entries(entries).filter(([, entry]) => (entry.status === 'pending' || entry.status === 'recorded' && sendReceipt && !entry.receipt?.sent)).slice(0, 10);
        let processed = 0, created = 0;
        for (const [id, entry] of pending) {
          if (!Array.isArray(entry.links) || entry.links.length > 10 || entry.links.some(url => !isSafeArticleUrl(url)) || !Number.isFinite(Date.parse(entry.savedAt))) throw new Error('Invalid inbox entry.');
          const items = entry.links.map((url, index) => ({ id: hash(id + ':' + index), url, title: url, savedAt: entry.savedAt, read: false, status: '待阅读' }));
          // Same path and URL deduplication as Chrome capture; no message send or URL fetch.
          const result = entry.status === 'recorded' ? { created: 0 } : capture ? await capture(items) : await bridge('sync', { items });
          const latest = await store.load(); // bridge may have updated other state; do not overwrite it.
          const recorded = inbox(latest).messages[id];
          recorded.status = 'recorded';
          if (sendReceipt && !recorded.receipt) recorded.receipt = { uuid: randomUUID(), at: now(), created: result.created, sent: false };

          await store.save(latest);
          if (sendReceipt && !recorded.receipt.sent) {
            if (now() - recorded.receipt.at >= 3600000) throw new Error('Unconfirmed intake receipt: inspect inbox-pending before resolving.');
            await sendReceipt(recorded.chatId, recorded.receipt.uuid, recorded.links.length, recorded.receipt.created);
            recorded.receipt.sent = true; await store.save(latest);
          }
          processed++; created += result.created;
        }
        return { ok: true, processed, created };
      });
    },
  };
}
