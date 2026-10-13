import { SERVER_ORIGIN } from './server-target.js';
import { SafeError, readJsonResponse } from './security.js';
export async function callServer(action, payload = {}, { accessKey } = {}) {
  if (!['health', 'sync', 'read', 'pending', 'resolve', 'preferences'].includes(action)) throw new SafeError('Unsupported service operation.');
  const stored = await chrome.storage.local.get(['serverAccessKey', 'collectionIdentity']);
  const serverAccessKey = accessKey || stored.serverAccessKey, collectionIdentity = stored.collectionIdentity;
  if (!/^[A-Za-z0-9_-]{43}$/.test(serverAccessKey || '')) throw new SafeError('Save the server access key in Settings before connecting.');
  const body = JSON.stringify({ ...payload, ...(collectionIdentity ? { expectedIdentity: collectionIdentity } : {}) });
  if (new TextEncoder().encode(body).length > 20 * 1024 * 1024) throw new SafeError('Sync request exceeds 20 MiB. Reduce the collection.');
  let response;
  try {
    response = await fetch(`${SERVER_ORIGIN}/v1/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${serverAccessKey}`, 'Content-Type': 'application/json' },
      body, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(180000) });
  } catch { throw new SafeError('Server connection failed or timed out. Check HTTPS, authorization and server status.'); }
  if (response.status === 401 || response.status === 403) throw new SafeError('Server denied access. Check the service key and configured extension ID.');
  if (response.status === 429 || response.status >= 500) throw new SafeError('Server is busy or unavailable. Retry later; pending deliveries remain on the server.');
  const result = await readJsonResponse(response, 20 * 1024 * 1024);
  if (!response.ok || result.ok !== true) throw new SafeError(typeof result.error === 'string' ? result.error.slice(0, 500) : 'Server operation failed.');
  if (result.identity) {
    if (!/^cli_[A-Za-z0-9]{1,128}$/.test(result.identity.appId || '') || !/^ou_[A-Za-z0-9]{1,128}$/.test(result.identity.openId || '') ||
        collectionIdentity && (collectionIdentity.appId !== result.identity.appId || collectionIdentity.openId !== result.identity.openId)) throw new SafeError('Server account differs from this reading collection.');
    if (!collectionIdentity) await chrome.storage.local.set({ collectionIdentity: result.identity });
  }
  return result;
}
export const connectionStatus = () => callServer('health');
export async function pendingDelivery() { return (await callServer('pending')).pending; }
export const resolveDelivery = (uuid, outcome) => callServer('resolve', { uuid, outcome });
