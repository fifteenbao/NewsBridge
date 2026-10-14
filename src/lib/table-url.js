import { SafeError } from './security.js';
export function parseTableUrl(value) {
  let url;
  try { if (typeof value !== 'string' || value.length > 8192) throw new Error(); url = new URL(value); }
  catch { throw new SafeError('Paste a complete HTTPS Feishu Bitable or wiki link.'); }
  if (url.protocol === 'https:' && !url.username && !url.password && !url.port && url.hostname === 'docs.google.com') {
    const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{1,128})(?:\/edit)?\/?$/);
    const hash = new URLSearchParams(url.hash.slice(1)), query = url.searchParams;
    const ids = [...query.getAll('gid'), ...hash.getAll('gid')];
    if (!match || query.getAll('gid').length > 1 || hash.getAll('gid').length > 1 || ids.length === 2 && ids[0] !== ids[1] || ids.length && (!/^\d{1,10}$/.test(ids[0]) || Number(ids[0]) > 2147483647)) throw new SafeError('Use a Google Sheets /spreadsheets/d/ link with at most one numeric gid.');
    const id = ids[0] ?? null;
    return { kind: 'google', baseToken: match[1], nodeToken: null, articleTableId: id, base: id !== null ? `${match[1]}/${id}` : null, url: `https://docs.google.com/spreadsheets/d/${match[1]}/edit${id !== null ? '#gid=' + id : ''}` };
  }
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
