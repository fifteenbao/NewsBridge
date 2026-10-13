import { SafeError } from '../src/lib/security.js';
import { validateFeishuOperation } from '../src/lib/api-policy.js';

export function createAdapterClient(config, adapter) {
  if (typeof adapter?.getIdentity !== 'function' || typeof adapter?.request !== 'function' ||
      adapter.capabilities?.tableRead !== true || adapter.capabilities?.tableWrite !== true ||
      config.remindersEnabled && adapter.capabilities?.messages !== true) {
    throw new SafeError('The adapter lacks required identity, table or message capabilities.');
  }
  async function verifyIdentity() {
    // The adapter must derive this stable identity from verified credentials,
    // not echo the requested configuration or browser payload.
    let identity;
    try { identity = await adapter.getIdentity(); } catch { throw new SafeError('Connection authorization could not be verified.'); }
    if (identity?.connectionId !== config.connectionId) throw new SafeError('Connection identity does not match the configured account.');
  }
  return {
    verifyIdentity,
    request: async (method, path, options) => {
      validateFeishuOperation(config, method, path, options);
      await verifyIdentity();
      let result;
      try { result = await adapter.request(method, path, options); } catch { throw new SafeError('The connection operation failed. Check authorization and permissions.'); }
      if (!result || result.code !== 0 || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
        throw new SafeError('The adapter returned an invalid or unsuccessful response.');
      }
      return result;
    },
  };
}
