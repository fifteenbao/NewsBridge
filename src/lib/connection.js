import { cleanDiagnostic, formatDiagnostic } from './diagnostics.js';
import { parseTableUrl } from './table-url.js';
import { CONNECTION_BASE_URL } from './connection-config.js';
import { SafeError, readJsonResponse } from './security.js';
import { parseConnectionUrl } from './connection-url.js';
const actions = new Set(['health', 'sync', 'read', 'pending', 'resolve', 'preferences']);
export const validAccessKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,512}$/.test(value);
const validIdentity = value => value && /^[A-Za-z0-9._:-]{1,128}$/.test(value.connectionId || '') && /^[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(value.base || '');
const sameIdentity = (a, b) => a.connectionId === b.connectionId && a.base === b.base;

export function createConnectionClient({ baseUrl = CONNECTION_BASE_URL, storage, fetchImpl } = {}) {
  return async (action, payload = {}, { accessKey, pinIdentity = true } = {}) => {
    if (!actions.has(action)) throw new SafeError('Unsupported connection operation.');
    if (!baseUrl) {
      if (['health', 'sync', 'preferences'].includes(action)) return { ok: true, connected: false, enabled: false };
      if (action === 'pending') return { ok: true, pending: null };
      throw new SafeError('Configure a connection before updating linked records.');
    }
    const target = parseConnectionUrl(baseUrl).baseUrl;
    const local = storage || chrome.storage.local;
    const stored = await local.get(['connectionAccessKey', 'collectionIdentity', 'connectionBaseUrl']);
    const key = accessKey || stored.connectionAccessKey, identity = stored.collectionIdentity;
    if (!validAccessKey(key)) throw new SafeError(key ? formatDiagnostic({ code: 'KEY_INVALID', stage: 'identity' }) : 'Enter the connection access key in Settings.');
    if (!accessKey && stored.connectionBaseUrl && stored.connectionBaseUrl !== target) throw new SafeError('Connection address changed. Verify it and enter its access key again.');
    const body = JSON.stringify({ ...payload, ...(identity ? { expectedIdentity: identity } : {}) });
    if (new TextEncoder().encode(body).length > 20 * 1024 * 1024) throw new SafeError('Sync request exceeds 20 MiB.');
    let response;
    try {
      response = await (fetchImpl || fetch)(`${target}v1/${action}`, { method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body,
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(180000) });
    } catch { throw new SafeError('Connection failed or timed out. Check its availability and HTTPS configuration.'); }
    if (response.status === 401) throw new SafeError(formatDiagnostic({ code: 'KEY_INVALID', stage: 'identity' }));
    if (response.status === 403) throw new SafeError(formatDiagnostic({ code: 'ORIGIN_DENIED', stage: 'identity' }));
    const result = await readJsonResponse(response, 20 * 1024 * 1024);
    if (!response.ok || result.ok !== true) throw new SafeError(cleanDiagnostic(result.diagnostic) ? formatDiagnostic(result.diagnostic) : 'Connection operation failed. Check its authorization, permissions and private logs.');
    if (result.protocolVersion !== 1 || !validIdentity(result.identity)) throw new SafeError('Unsupported or invalid connection response.');
    if (identity && !sameIdentity(identity, result.identity)) throw new SafeError('Connection account or table differs from this collection.');
    if (action === 'health' && (result.connected !== true || result.capabilities?.tableRead !== true || result.capabilities?.tableWrite !== true)) {
      throw new SafeError('This connection does not support table reading and writing.');
    }
    if (action === 'sync') {
      if (result.enabled !== true || result.base !== result.identity.base || !Array.isArray(result.bindings) || !Array.isArray(result.articles) || !Array.isArray(result.topics) ||
          result.articles.length > 10000 || result.bindings.length > 5000 ||
          result.bindings.some(b => typeof b?.id !== 'string' || !/^rec[A-Za-z0-9]+$/.test(b.recordId || '')) ||
          result.articles.some(a => !/^rec[A-Za-z0-9]+$/.test(a?.recordId || '') || typeof a.read !== 'boolean' || typeof a.url !== 'string' || !Array.isArray(a.topicIds))) {
        throw new SafeError('Invalid table snapshot; local data was preserved.');
      }
    }
    if (payload.tableUrl !== undefined) {
      const link = parseTableUrl(payload.tableUrl), resolved = result.resolvedTable;
      if (!resolved || resolved.url !== link.url || resolved.base !== result.identity.base ||
          resolved.base !== `${resolved.baseToken}/${resolved.articleTableId}` ||
          resolved.source !== (link.kind === 'wiki' ? 'wiki-node' : link.articleTableId ? 'explicit-link' : 'configured-table') ||
          (link.kind === 'base' && resolved.baseToken !== link.baseToken) ||
          (link.articleTableId && resolved.articleTableId !== link.articleTableId)) {
        throw new SafeError(formatDiagnostic({ code: 'LINK_RESPONSE_INVALID', stage: link.kind === 'wiki' ? 'wiki.resolve' : 'fields' }));
      }
    }
    if (!identity && pinIdentity) await local.set({ collectionIdentity: result.identity });
    return result;
  };
}
export const callConnection = createConnectionClient();
export const connectionStatus = () => callConnection('health');
export async function pendingDelivery() { return (await callConnection('pending')).pending; }
export const resolveDelivery = (uuid, outcome) => callConnection('resolve', { uuid, outcome });
