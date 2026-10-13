import { SafeError, isSafeArticleUrl } from './security.js';

// Keep URL normalization identical in the browser, packager and host handler.
export function parseConnectionUrl(value) {
  if (typeof value !== 'string' || !isSafeArticleUrl(value) || !value.startsWith('https://') || /[?#%\\]/.test(value)) {
    throw new SafeError('Use an HTTPS base URL without credentials, query, fragment or encoded path segments.');
  }
  const url = new URL(value);
  if (!/^[a-z0-9.-]+$/i.test(url.hostname)) throw new SafeError('Use one exact HTTPS hostname without wildcards.');
  const pathStart = value.indexOf('/', 'https://'.length);
  // Reject ambiguous path spellings rather than silently normalizing traversal.
  const suppliedPath = pathStart === -1 ? '/' : value.slice(pathStart);
  if (suppliedPath !== url.pathname || url.pathname.split('/').slice(1).some((part, index, parts) =>
      part === '' ? index !== parts.length - 1 : !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(part))) {
    throw new SafeError('Use a simple absolute base path without empty or traversal segments.');
  }
  const path = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
  return { baseUrl: url.origin + path, origin: url.origin, apiPath: path + 'v1/' };
}
