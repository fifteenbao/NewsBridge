import { SafeError } from './security.js';
export function parseTableUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new SafeError('Paste a complete HTTPS Feishu Bitable link with ?table=tbl…'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/^(?:[a-z0-9-]+\.)*(?:feishu\.cn|larksuite\.com)$/.test(url.hostname)) throw new SafeError('Use a Feishu or Lark Bitable link.');
  if (url.pathname.startsWith('/wiki/')) throw new SafeError('Wiki links need to be resolved by your connection operator. Paste the direct /base/ link.');
  const match = url.pathname.match(/^\/base\/([A-Za-z0-9]+)\/?$/);
  const table = url.searchParams.get('table');
  if (!match || !/^tbl[A-Za-z0-9]+$/.test(table || '') || url.searchParams.getAll('table').length !== 1) throw new SafeError('Open the target data table and copy its /base/ link including ?table=tbl…');
  return { baseToken: match[1], articleTableId: table, base: `${match[1]}/${table}`,
    url: `${url.origin}/base/${match[1]}?table=${table}` };
}
