import { DiagnosticError, cleanDiagnostic } from '../src/lib/diagnostics.js';
import { SafeError } from '../src/lib/security.js';
import { validateFeishuOperation } from './lib/api-policy.js';

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
    try { identity = await adapter.getIdentity(); } catch (error) { const d = cleanDiagnostic(error?.diagnostic); if (d) throw new DiagnosticError(d.code, d.stage, d); throw new DiagnosticError('AUTH_VERIFY', 'identity', { providerCode: error?.providerCode, httpStatus: error?.httpStatus }); }
    if (identity?.connectionId !== config.connectionId) throw new SafeError('Connection identity does not match the configured account.');
  }
  return {
    verifyIdentity,
    request: async (method, path, options) => {
      validateFeishuOperation(config, method, path, options);
      await verifyIdentity();
      const stage = path.endsWith('/fields') ? 'fields' : path.endsWith('/messages') ? 'messages.send' : method === 'GET' ? 'records.list' : method === 'PUT' ? 'records.update' : 'records.create';
      let result;
      try { result = await adapter.request(method, path, options); } catch (error) { const d = cleanDiagnostic(error?.diagnostic); if (d) throw new DiagnosticError(d.code, d.stage, d); throw new DiagnosticError(Number.isSafeInteger(error?.providerCode) ? 'API_REJECTED' : 'API_TRANSPORT', stage, { providerCode: error?.providerCode, httpStatus: error?.httpStatus }); }
      if (!result || result.code !== 0 || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
        throw new DiagnosticError(Number.isSafeInteger(result?.code) && result.code !== 0 ? 'API_REJECTED' : 'API_RESPONSE', stage, { providerCode: result?.code });
      }
      return result;
    },
  };
}
