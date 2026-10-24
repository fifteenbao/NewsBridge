import { signConnectionRequest } from './pairing-client.js';
import { cleanDiagnostic, formatDiagnostic } from './diagnostics.js';
import { parseTableUrl } from './table-url.js';
import { storedEndpoint, endpointValue, endpointPermission, collectionArchiveKey } from './endpoint.js';
import { SafeError, readJsonResponse } from './security.js';
import { parseConnectionUrl } from './connection-url.js';
const actions = new Set(['health', 'sync', 'read', 'pending', 'resolve', 'preferences', 'export', 'csv']);
export const validAccessKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,512}$/.test(value);
const validIdentity = value => value && /^[A-Za-z0-9.@_:-]{1,254}$/.test(value.connectionId || '') && /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(value.base || '');
const sameIdentity = (a, b) => a.connectionId === b.connectionId && a.base === b.base;

export function createConnectionClient({ baseUrl, storage, fetchImpl, hasPermission, authentication = 'paired', signRequest = signConnectionRequest } = {}) {
  return async (action, payload = {}, { accessKey, pinIdentity = true, provider, endpoint } = {}) => {
    if (!actions.has(action)) throw new SafeError('Unsupported connection operation.');
    const local = storage || chrome.storage.local;
    const stored = await local.get(['connectionEndpoint', 'connectionAccessKey', 'collectionIdentity', 'connectionBaseUrl', 'connectionProvider', 'collectionArchives']);
    const selectedUrl = endpoint !== undefined ? endpointValue(endpoint) : baseUrl !== undefined ? endpointValue(baseUrl) : storedEndpoint(stored);
    if (!selectedUrl) {
      if (['health', 'sync', 'preferences'].includes(action)) return { ok: true, connected: false, enabled: false };
      if (action === 'pending') return { ok: true, pending: null };
      throw new SafeError('Configure a connection before updating linked records.');
    }
    const target = parseConnectionUrl(selectedUrl).baseUrl;
    const allowed = hasPermission ? await hasPermission(endpointPermission(target)) : globalThis.chrome?.permissions?.contains ? await chrome.permissions.contains(endpointPermission(target)) : baseUrl !== undefined;
    if (!allowed) throw new SafeError('Grant access to this connection host in Settings before connecting.');
    const savedTarget = stored.connectionBaseUrl || '';
    const switched = savedTarget && savedTarget !== target;
    if (switched && stored.collectionIdentity) throw new SafeError('Disconnect the current collection before changing the connection address.');
    const identity = stored.collectionIdentity;
    let key;
    if (authentication === 'bearer') {
      key = accessKey || (!switched ? stored.connectionAccessKey : '');
      if (!validAccessKey(key)) throw new SafeError(key ? formatDiagnostic({ code: 'KEY_INVALID', stage: 'identity' }) : 'Enter the connection access key in Settings.');
    }
    const selectedProvider = provider || stored.connectionProvider || (authentication === 'bearer' ? 'feishu' : 'database');
    if (!['database', 'feishu'].includes(selectedProvider)) throw new SafeError('Invalid storage provider.');
    const body = JSON.stringify({ ...payload, provider: selectedProvider, ...(identity ? { expectedIdentity: identity } : {}) });
    if (new TextEncoder().encode(body).length > 20 * 1024 * 1024) throw new SafeError('Sync request exceeds 20 MiB.');
    const authHeaders = authentication === 'bearer' ? { Authorization: `Bearer ${key}` } : await signRequest(target, `${target}v1/${action}`, body, local);
    let response;
    try {
      response = await (fetchImpl || fetch)(`${target}v1/${action}`, { method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' }, body,
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(180000) });
    } catch { throw new SafeError('Connection failed or timed out. Check its availability and HTTPS configuration.'); }
    if (response.status === 401) {
      if (authentication !== 'bearer') { const { connectionPairings = {} } = await local.get('connectionPairings');
        if (connectionPairings[target]) await local.set({ connectionPairings: { ...connectionPairings, [target]: { ...connectionPairings[target], status: 'unpaired' } } });
      }
      throw new SafeError(formatDiagnostic({ code: authentication === 'bearer' ? 'KEY_INVALID' : 'PAIR_REQUIRED', stage: 'identity' }));
    }
    if (response.status === 403) throw new SafeError(formatDiagnostic({ code: 'ORIGIN_DENIED', stage: 'identity' }));
    const result = await readJsonResponse(response, 20 * 1024 * 1024);
    if (!response.ok || result.ok !== true) throw new SafeError(cleanDiagnostic(result.diagnostic) ? formatDiagnostic(result.diagnostic) : 'Connection operation failed. Check its authorization, permissions and private logs.');
    if (result.protocolVersion !== 1 || !validIdentity(result.identity)) throw new SafeError('Unsupported or invalid connection response.');
    if (identity && !sameIdentity(identity, result.identity)) throw new SafeError('Connection account or table differs from this collection. Disconnect in Settings before reassociating.');
    if (action === 'health' && (result.configuration?.storageProvider || 'database') !== selectedProvider) throw new SafeError('The connection does not match the selected storage provider.');
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
      if (result.articles.some(article => article.tags !== undefined && (!Array.isArray(article.tags) || article.tags.length > 200 || article.tags.some(tag => typeof tag !== 'string' || tag.length > 1000)) ||
          article.remark !== undefined && (typeof article.remark !== 'string' || article.remark.length > 64000))) {
        throw new SafeError('Invalid capture metadata snapshot; local edits were preserved.');
      }
      if (result.captureMetadata !== undefined && (!result.captureMetadata || !Array.isArray(result.captureMetadata.tagOptions) || result.captureMetadata.tagOptions.length > 200 ||
          result.captureMetadata.tagOptions.some(tag => typeof tag !== 'string' || tag.length > 50))) throw new SafeError('Invalid capture tag options.');
      if (result.metadataBindings !== undefined && (!Array.isArray(result.metadataBindings) || result.metadataBindings.length > 5000 ||
          result.metadataBindings.some(binding => typeof binding?.id !== 'string' || typeof binding.editId !== 'string' || binding.editId.length !== 36))) {
        throw new SafeError('Invalid metadata acknowledgement; local edits were preserved.');
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
    if (!identity && pinIdentity) {
      const latest = await local.get(['connectionEndpoint', 'collectionIdentity']);
      if ((endpoint === undefined && baseUrl === undefined && storedEndpoint(latest) !== target) || JSON.stringify(latest.collectionIdentity || null) !== JSON.stringify(identity || null)) throw new SafeError('Connection settings changed during the request. Retry.');
      const archived = stored.collectionArchives?.[collectionArchiveKey(result.identity, target)];
      const current = (await local.get('items')).items || [];
      await local.set({ collectionIdentity: result.identity, ...(Array.isArray(archived) ? { items: [...archived, ...current.filter(item => !archived.some(old => old.id === item.id))] } : {}) });
    }
    return result;
  };
}
export const callConnection = createConnectionClient();
export const connectionStatus = () => callConnection('health');
export async function pendingDelivery() { return (await callConnection('pending')).pending; }
export const resolveDelivery = (uuid, outcome) => callConnection('resolve', { uuid, outcome });
