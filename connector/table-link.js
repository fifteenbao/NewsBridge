import { parseTableUrl } from '../src/lib/table-url.js';
import { DiagnosticError, cleanDiagnostic } from '../src/lib/diagnostics.js';
import { createAdapterClient } from './client.js';

export function createTableLinkResolver(config, adapter) {
  const client = createAdapterClient(config, adapter);
  return async value => {
    const link = parseTableUrl(value);
    if ((link.kind === 'google') !== (config.storageProvider === 'google')) throw new DiagnosticError('TABLE_MISMATCH', 'fields');
    let baseToken = link.baseToken;
    if (link.kind === 'wiki') {
      if (typeof adapter.resolveWikiNode !== 'function') throw new DiagnosticError('LINK_RESOLVER_UNAVAILABLE', 'wiki.resolve');
      await client.verifyIdentity();
      let node;
      try { node = await adapter.resolveWikiNode(link.nodeToken); }
      catch (error) {
        const d = cleanDiagnostic(error?.diagnostic);
        if (d) throw new DiagnosticError(d.code, 'wiki.resolve', d);
        throw new DiagnosticError('API_TRANSPORT', 'wiki.resolve', { providerCode: error?.providerCode, httpStatus: error?.httpStatus });
      }
      if (!node || node.nodeToken !== link.nodeToken || !/^[A-Za-z0-9]{1,128}$/.test(node.objToken || '') || typeof node.objType !== 'string') throw new DiagnosticError('LINK_RESPONSE_INVALID', 'wiki.resolve');
      if (node.objType !== 'bitable') throw new DiagnosticError('LINK_NOT_BITABLE', 'wiki.resolve');
      baseToken = node.objToken;
    }
    // Missing table= means use the configured table in the SAME base, never the
    // first available table or a table in an unrelated base. Do not return other
    // nodes' tokens/titles to the browser.
    if (baseToken !== config.baseToken || link.articleTableId && link.articleTableId !== config.articleTableId) throw new DiagnosticError('TABLE_MISMATCH', 'fields');
    return { url: link.url, baseToken: config.baseToken, articleTableId: config.articleTableId,
      base: `${config.baseToken}/${config.articleTableId}`, source: link.kind === 'wiki' ? 'wiki-node' : link.articleTableId ? 'explicit-link' : 'configured-table' };
  };
}
