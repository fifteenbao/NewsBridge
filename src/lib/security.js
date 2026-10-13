export class SafeError extends Error {}
export function safeErrorMessage(error) {
  return error instanceof SafeError ? error.message.slice(0, 500) : 'The operation failed. Retry or check your connection and permissions.';
}

const secretParameters = new Set(['access_token', 'refresh_token', 'id_token', 'token', 'api_key', 'apikey',
  'client_secret', 'password', 'passwd', 'session_id', 'sessionid', 'authorization', 'x-amz-signature']);
export function isSafeArticleUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.startsWith('[') || ['.localhost', '.local', '.internal', '.lan', '.home'].some(suffix => host.endsWith(suffix))) return false;
    // WHATWG URL parsing canonicalizes shortened, integer and hex IPv4 forms.
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      if ([0, 10, 127].includes(a) || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
          a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19].includes(b)) return false;
    }
    const parts = [url.searchParams, new URLSearchParams(url.hash.slice(1))];
    return parts.every(params => ![...params.keys()].some(key => secretParameters.has(key.toLowerCase())) &&
      !(params.has('code') && params.has('state')));
  } catch { return false; }
}

export async function readJsonResponse(response, maxBytes = 2 * 1024 * 1024) {
  if (Number(response.headers.get('Content-Length')) > maxBytes) throw new SafeError('The server response is too large.');
  const reader = response.body?.getReader();
  if (!reader) throw new SafeError('The server returned an empty response.');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new SafeError('The server response is too large.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const result = JSON.parse(new TextDecoder().decode(bytes));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof SafeError) throw error;
    throw new SafeError('The server returned an invalid response.');
  } finally { reader.releaseLock(); }
}
