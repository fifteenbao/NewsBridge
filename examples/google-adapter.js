// Google Sheets translation for the existing restricted reading-table contract.
// Credentials are acquired per operation; this module has no import-time effects.
import { sign } from 'node:crypto';
import { validateConnectorConfig } from '../connector/config.js';
import { validateFeishuOperation } from '../src/lib/api-policy.js';
import { ARTICLE_FIELDS } from '../src/lib/bitable.js';
import { DiagnosticError } from '../src/lib/diagnostics.js';
import { readJsonResponse } from '../src/lib/security.js';
const names = Object.keys(ARTICLE_FIELDS), key = 'newsbridge.record.v1';
const failure = stage => new DiagnosticError('API_RESPONSE', stage);
export function createGoogleAdapter({ config: input, getCredentials, messageAdapter, fetchImpl = fetch, now = () => Date.now() }) {
  const config = validateConnectorConfig(input), sheetId = Number(config.articleTableId), messageConnectionId = input.messageConnectionId;
  if (config.storageProvider !== 'google' || !/^\d{1,10}$/.test(config.articleTableId) || !Number.isSafeInteger(sheetId) || sheetId > 2147483647 || typeof getCredentials !== 'function') throw failure('identity');
  const root = `https://sheets.googleapis.com/v4/spreadsheets/${config.baseToken}`;
  async function json(url, options, stage) {
    let response;
    try { response = await fetchImpl(url, { ...options, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000) }); }
    catch { throw new DiagnosticError('API_TRANSPORT', stage); }
    let result;
    try { result = await readJsonResponse(response, 20 * 1024 * 1024); } catch { throw failure(stage); }
    if (!response.ok || result.error) throw new DiagnosticError('API_REJECTED', stage, { httpStatus: response.status, providerCode: Number.isSafeInteger(result.error?.code) ? result.error.code : undefined });
    return result;
  }
  let cached;
  async function authorize() {
    let credentials;
    try { credentials = await getCredentials(); } catch { throw new DiagnosticError('AUTH_VERIFY', 'identity'); }
    const email = credentials?.client_email, privateKey = credentials?.private_key;
    if (typeof email !== 'string' || !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(email) || config.connectionId !== `google:${email}` || typeof privateKey !== 'string') throw new DiagnosticError('AUTH_VERIFY', 'identity');
    if (cached?.email === email && cached.key === privateKey && cached.expires > now()) return cached.token;
    const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
    const stamp = Math.floor(now() / 1000), assertion = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({ iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: stamp, exp: stamp + 3600 });
    let signature;
    try { signature = sign('RSA-SHA256', Buffer.from(assertion), privateKey).toString('base64url'); } catch { throw new DiagnosticError('AUTH_VERIFY', 'identity'); }
    const result = await json('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion + '.' + signature }).toString() }, 'identity');
    if (typeof result.access_token !== 'string' || !/^[A-Za-z0-9._~-]{1,4096}$/.test(result.access_token) || !Number.isFinite(result.expires_in) || result.expires_in < 60) throw failure('identity');
    cached = { token: result.access_token, email, key: privateKey, expires: now() + Math.min(result.expires_in - 30, 3500) * 1000 };
    return cached.token;
  }
  async function api(suffix, body, stage) {
    const token = await authorize();
    return json(root + suffix, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, stage);
  }
  async function snapshot(requireHeader = true) {
    const result = await api(':getByDataFilter?fields=sheets(properties(sheetId,gridProperties),data(startRow,rowData(values(userEnteredValue,effectiveValue))))', { dataFilters: [{ gridRange: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 8 } }], includeGridData: true }, 'records.list');
    if (!Array.isArray(result.sheets)) throw failure('records.list');
    const matches = result.sheets.filter(s => s?.properties?.sheetId === sheetId);
    if (matches.length !== 1) throw failure('records.list');
    const sheet = matches[0];
    if (!sheet || !Number.isSafeInteger(sheet.properties.gridProperties?.rowCount) || sheet.properties.gridProperties.rowCount < 2 || sheet.properties.gridProperties.rowCount > 10001 || (sheet.data?.[0]?.startRow || 0) !== 0) throw failure('records.list');
    if (sheet.data !== undefined && (!Array.isArray(sheet.data) || sheet.data.length > 1)) throw failure('records.list');
    const rows = sheet.data?.[0]?.rowData || [];
    if (!Array.isArray(rows) || rows.some(row => !row || row.values !== undefined && !Array.isArray(row.values))) throw failure('records.list');
    const value = cell => cell?.effectiveValue?.stringValue ?? cell?.effectiveValue?.numberValue ?? cell?.userEnteredValue?.stringValue ?? cell?.userEnteredValue?.numberValue ?? '';
    const values = rows.map(row => names.map((_, i) => value(row.values?.[i])));
    if (requireHeader && names.some((name, i) => values[0]?.[i] !== name)) throw new DiagnosticError('SCHEMA_INVALID', 'fields');
    const found = await api('/developerMetadata:search', { dataFilters: [{ developerMetadataLookup: { metadataKey: key, metadataValue: String(sheetId), visibility: 'DOCUMENT' } }] }, 'records.list');
    if (found.matchedDeveloperMetadata !== undefined && !Array.isArray(found.matchedDeveloperMetadata)) throw failure('records.list');
    const ids = new Map(), seen = new Set();
    for (const entry of found.matchedDeveloperMetadata || []) {
      const m = entry.developerMetadata, d = m?.location?.dimensionRange;
      if (d?.sheetId !== sheetId) continue;
      if (d.dimension !== 'ROWS' || d.endIndex !== d.startIndex + 1 || d.startIndex < 1 || !Number.isSafeInteger(m.metadataId) || m.metadataId < 0 || m.metadataId > 2147483647 || ids.has(d.startIndex) || seen.has(m.metadataId)) throw failure('records.list');
      ids.set(d.startIndex, m.metadataId); seen.add(m.metadataId);
    }
    return { values, ids, rowCount: sheet.properties.gridProperties.rowCount };
  }
  const fieldsOf = row => Object.fromEntries(names.map((name, i) => [name, name === '时间' ? (typeof row[i] === 'number' ? row[i] : Number.isFinite(Date.parse(row[i])) ? Date.parse(row[i]) : null) : name === '推荐指数' ? (row[i] === '' ? null : Number(row[i])) : row[i]]));
  async function list() {
    const { values, ids } = await snapshot();
    values.slice(1).forEach((row, i) => {
      if (row.some(v => v !== '') && !ids.has(i + 1)) throw new DiagnosticError('SHEET_ROWS_UNPREPARED', 'records.list');
    });
    if (!ids.size) return [];
    // Fetch values by identity, not by a row index from an earlier API response.
    // Concurrent whole-row moves cannot bind another article to this record ID.
    const wanted = new Set(ids.values());
    const result = await api('/values:batchGetByDataFilter', { dataFilters: [...wanted].map(metadataId => ({ developerMetadataLookup: { metadataId } })), majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE' }, 'records.list');
    if (!Array.isArray(result.valueRanges) || result.valueRanges.length !== wanted.size) throw failure('records.list');
    const seen = new Set(), records = [];
    for (const match of result.valueRanges) {
      const id = match?.dataFilters?.[0]?.developerMetadataLookup?.metadataId;
      if (match.dataFilters?.length !== 1 || !wanted.has(id) || seen.has(id) || !match.valueRange) throw failure('records.list');
      seen.add(id);
      const data = match.valueRange.values || [];
      if (!Array.isArray(data) || data.length > 1 || data.length && !Array.isArray(data[0])) throw failure('records.list');
      const row = names.map((_, i) => data[0]?.[i] ?? '');
      if (row.some(v => v !== '')) records.push({ record_id: 'rec' + id, fields: fieldsOf(row) });
    }
    return records;
  }
  async function create(fields) {
    const snapshotNow = await snapshot();
    if (snapshotNow.rowCount >= 10001) throw failure('records.create');
    const values = names.map(name => { const v = fields[name] ?? ''; return { userEnteredValue: typeof v === 'number' ? { numberValue: v } : { stringValue: String(v) } }; });
    const result = await api(':batchUpdate', { requests: [
      { insertDimension: { range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, inheritFromBefore: false } },
      { updateCells: { start: { sheetId, rowIndex: 1, columnIndex: 0 }, rows: [{ values }], fields: 'userEnteredValue' } },
      { createDeveloperMetadata: { developerMetadata: { metadataKey: key, metadataValue: String(sheetId), visibility: 'DOCUMENT', location: { dimensionRange: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 } } } } },
    ] }, 'records.create');
    const id = result.replies?.[2]?.createDeveloperMetadata?.developerMetadata?.metadataId;
    if (!Number.isSafeInteger(id) || id < 0 || id > 2147483647) throw failure('records.create');
    return { record_id: 'rec' + id, fields };
  }
  async function update(id, values) {
    if (!/^rec(?:0|[1-9]\d{0,9})$/.test(id)) throw failure('records.update');
    const rows = await list();
    if (!rows.some(row => row.record_id === id)) throw failure('records.update');
    const result = await api('/values:batchUpdateByDataFilter', { valueInputOption: 'RAW', data: [{ dataFilter: { developerMetadataLookup: { metadataId: Number(id.slice(3)) } }, majorDimension: 'ROWS', values: [values] }] }, 'records.update');
    if (result.totalUpdatedRows !== 1) throw failure('records.update');
  }
  return {
    capabilities: { tableRead: true, tableWrite: true, messages: messageAdapter?.capabilities?.messages === true },
    async getIdentity() {
      await authorize();
      if (config.remindersEnabled) {
        const identity = await messageAdapter?.getIdentity();
        if (!/^app:cli_[A-Za-z0-9]+$/.test(messageConnectionId || '') || identity?.connectionId !== messageConnectionId) throw new DiagnosticError('AUTH_VERIFY', 'identity');
      }
      return { connectionId: config.connectionId };
    },
    async prepare() {
      const { values, ids } = await snapshot(false);
      const empty = values.every(row => row.every(v => v === ''));
      if (!empty && names.some((name, i) => values[0]?.[i] !== name)) throw new DiagnosticError('SCHEMA_INVALID', 'fields');
      const requests = [];
      if (empty) requests.push({ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 0 }, rows: [{ values: names.map(stringValue => ({ userEnteredValue: { stringValue } })) }], fields: 'userEnteredValue' } });
      values.slice(1).forEach((row, i) => { if (row.some(v => v !== '') && !ids.has(i + 1)) requests.push({ createDeveloperMetadata: { developerMetadata: { metadataKey: key, metadataValue: String(sheetId), visibility: 'DOCUMENT', location: { dimensionRange: { sheetId, dimension: 'ROWS', startIndex: i + 1, endIndex: i + 2 } } } } }); });
      if (requests.length > 1000) throw failure('records.create');
      if (requests.length) await api(':batchUpdate', { requests }, 'records.create');
      return { ok: true, prepared: requests.length };
    },
    async probeRecord(fields, created, inspect, cleaned) {
      if (!/^NewsBridge self-test [a-f0-9-]{36}$/.test(fields.标题 || '') || fields.阅读状态 !== '已读') throw failure('records.create');
      const record = await create(fields); let error;
      try { await created(record.record_id); await inspect((await list()).find(r => r.record_id === record.record_id)); } catch (e) { error = e; }
      try { await update(record.record_id, names.map(() => '')); await api(':batchUpdate', { requests: [{ deleteDeveloperMetadata: { dataFilter: { developerMetadataLookup: { metadataId: Number(record.record_id.slice(3)) } } } }] }, 'records.update'); } catch { throw new DiagnosticError('PROBE_CLEANUP', 'records.update'); }
      await cleaned(); if (error) throw error;
    },
    async request(method, path, options = {}) {
      validateFeishuOperation(config, method, path, options);
      if (path.endsWith('/messages')) {
        if (!messageAdapter) throw new DiagnosticError('REMINDERS_UNAVAILABLE', 'messages.send');
        return messageAdapter.request(method, path, options);
      }
      if (path.endsWith('/fields')) { await snapshot(); return { code: 0, data: { items: names.map(field_name => ({ field_name, type: field_name === '链接' ? 1 : ARTICLE_FIELDS[field_name] })), has_more: false } }; }
      if (method === 'GET') return { code: 0, data: { items: await list(), has_more: false } };
      if (method === 'POST') return { code: 0, data: { record: await create(options.data.fields) } };
      await update(path.split('/').at(-1), [null, null, null, null, options.data.fields.阅读状态]);
      return { code: 0, data: {} };
    },
  };
}
