import { CONNECTION_BASE_URL } from './connection-config.js';
import { parseConnectionUrl } from './connection-url.js';
import { SafeError } from './security.js';
export const OPTIONAL_CONNECTION_HOSTS = ['https://*/*'];
export const CONNECTION_CSP = "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; connect-src https:;";
export function endpointValue(value) {
  if (typeof value !== 'string') throw new SafeError('Enter a valid HTTPS connection service address.');
  return value.trim() ? parseConnectionUrl(value.trim()).baseUrl : '';
}
export function storedEndpoint(data, fallback = CONNECTION_BASE_URL) {
  return endpointValue(data.connectionEndpoint !== undefined ? data.connectionEndpoint : fallback);
}
export const endpointPermission = value => ({ origins: [parseConnectionUrl(value).origin + '/*'] });
// Call directly from a click handler, before awaiting messages or storage.
export function requestEndpointPermission(value) {
  const target = endpointValue(value);
  if (!target) return Promise.resolve(true);
  if (!globalThis.chrome?.permissions?.request) return Promise.reject(new SafeError('Chrome connection permission is unavailable.'));
  return chrome.permissions.request(endpointPermission(target));
}
export async function releaseEndpointPermission(value, replacement = '') {
  if (!value || !globalThis.chrome?.permissions?.remove) return;
  const permission = endpointPermission(value);
  if (replacement && permission.origins[0] === endpointPermission(replacement).origins[0]) return;
  // Required permissions in a legacy private build cannot be removed.
  await chrome.permissions.remove(permission);
}

export const collectionArchiveKey = (identity, endpoint) => JSON.stringify({ endpoint: endpointValue(endpoint), ...identity });
