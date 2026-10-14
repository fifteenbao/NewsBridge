import { SafeError } from './security.js';
export function parseTableUrl(value) {
  let url;
  try { if (typeof value !== 'string' || value.length > 8192) throw new Error(); url = new URL(value); }
  catch { throw new SafeError('Paste a complete HTTPS Feishu Bitable or wiki link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/^(?:[a-z0-9-]+\.)*(?:feishu\.cn|larksuite\.com)$/.test(url.hostname)) throw new SafeError('Use a Feishu or Lark Bitable link.');
  const match = url.pathname.match(/^\/(base|wiki)\/([A-Za-z0-9]{1,128})\/?$/);
  const values = url.searchParams.getAll('table'), table = values[0] || null;
  if (!match || values.length > 1 || values.length === 1 && !/^tbl[A-Za-z0-9]{1,128}$/.test(table || '')) throw new SafeError('Use a /base/ or /wiki/ link; if table= is present it must contain one valid Table ID.');
  const kind = match[1] === 'base' ? 'base' : 'wiki';
  const baseToken = kind === 'base' ? match[2] : null;
  return { kind, baseToken, nodeToken: kind === 'wiki' ? match[2] : null, articleTableId: table,
    base: baseToken && table ? `${baseToken}/${table}` : null,
    url: `${url.origin}/${match[1]}/${match[2]}${table ? `?table=${table}` : ''}` };
}
