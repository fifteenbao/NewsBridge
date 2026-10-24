// Explicit operator command. Importing this module never creates remote data.
import { readFile, mkdir, open, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { ARTICLE_FIELDS, createKnowledgeService } from '../connector/lib/bitable.js';
import { CAPTURE_FIELDS } from '../src/lib/capture-metadata.js';
import { SafeError, safeErrorMessage, readJsonResponse } from '../src/lib/security.js';
import { DiagnosticError, cleanDiagnostic } from '../src/lib/diagnostics.js';

export const tableFields = () => Object.entries({ ...ARTICLE_FIELDS, ...CAPTURE_FIELDS }).map(([field_name, type]) => ({ field_name, type,
  ...(field_name === '类别' ? { property: { options: [{ name: '待分类' }] } } : {}),
  ...(field_name === '阅读状态' ? { property: { options: ['待阅读', '阅读中', '已读', '跳过'].map(name => ({ name })) } } : {}),
}));

export async function createReadingTable({ config, getCredentials, fetchImpl = fetch, newBase = false, name = 'ReadFlow Reading', onProgress = async () => {} }) {
  if (!config || typeof config !== 'object' || !config.connector || typeof getCredentials !== 'function' || typeof name !== 'string' || !name.trim() || name.length > 100) throw new SafeError('Provide a host config, current app credentials and a table name (1–100 characters).');
  if (config.connector.storageProvider !== 'database') throw new SafeError('Use a ReadFlow database host configuration.');
  const credentials = await getCredentials();
  const { appId, appSecret } = credentials || {};
  if (!/^cli_[A-Za-z0-9]+$/.test(appId || '') || typeof appSecret !== 'string' || !appSecret || /[\r\n]/.test(appSecret)) throw new DiagnosticError('AUTH_VERIFY', 'identity');
  let token;
  async function api(method, path, data, stage) {
    let response;
    try { response = await fetchImpl(`https://open.feishu.cn${path}`, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}), redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30000) }); }
    catch { throw new DiagnosticError('API_TRANSPORT', stage); }
    const result = await readJsonResponse(response, 20 * 1024 * 1024);
    if (!response.ok || result.code !== 0) throw new DiagnosticError('API_REJECTED', stage, { providerCode: result.code, httpStatus: response.status });
    return result;
  }
  const auth = await api('POST', '/open-apis/auth/v3/tenant_access_token/internal', { app_id: appId, app_secret: appSecret }, 'identity');
  token = auth.tenant_access_token;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+$/.test(token)) throw new DiagnosticError('AUTH_VERIFY', 'identity');
  const connectionId = `app:${appId}`;
  if (config.feishu?.appId && config.feishu.appId !== appId) throw new DiagnosticError('AUTH_VERIFY', 'identity');
  let baseToken = config.feishu?.export?.baseToken;
  if (!newBase && !/^[A-Za-z0-9]{1,128}$/.test(baseToken || '')) throw new SafeError('Set a real baseToken, or explicitly pass --new-base to create a new Bitable.');
  await onProgress({ stage: 'authorized', connectionId, newBase, name });
  if (newBase) {
    await onProgress({ stage: 'base-create-requested', connectionId, name });
    const result = await api('POST', '/open-apis/bitable/v1/apps', { name }, 'setup.app.create');
    baseToken = result.data?.app?.app_token;
    if (!/^[A-Za-z0-9]{1,128}$/.test(baseToken || '')) throw new DiagnosticError('API_RESPONSE', 'setup.app.create');
    await onProgress({ stage: 'base-created', connectionId, baseToken, name });
  }
  await onProgress({ stage: 'table-create-requested', connectionId, baseToken, name });
  const result = await api('POST', `/open-apis/bitable/v1/apps/${baseToken}/tables`, { table: { name, default_view_name: 'Reading', fields: tableFields() } }, 'setup.table.create');
  const articleTableId = result.data?.table_id;
  if (!/^tbl[A-Za-z0-9]{1,128}$/.test(articleTableId || '')) throw new DiagnosticError('API_RESPONSE', 'setup.table.create');
  await onProgress({ stage: 'table-created', connectionId, baseToken, articleTableId, name });
  const connector = { storageProvider: 'feishu', reminderTime: config.connector.reminderTime || '10:00', connectionId, baseToken, articleTableId, chatId: '', remindersEnabled: false, schema: 'briefing', timeZone: config.connector.timeZone || 'Asia/Shanghai', language: config.connector.language || 'en' };
  const tablePath = `/open-apis/bitable/v1/apps/${baseToken}/tables/${articleTableId}`;
  const fieldMetadata = [];
  const knowledge = createKnowledgeService(async (method, path, { params } = {}) => {
    if (method !== 'GET' || ![tablePath + '/fields', tablePath + '/records'].includes(path)) throw new SafeError('Bootstrap verification is read-only for the new table.');
    const query = new URLSearchParams(Object.entries(params || {}).map(([key, value]) => [key, String(value)]));
    const result = await api('GET', `${path}?${query}`, undefined, path.endsWith('/fields') ? 'fields' : 'records.list');
    if (path.endsWith('/fields') && Array.isArray(result.data?.items)) fieldMetadata.push(...result.data.items);
    return result;
  });
  const snapshot = await knowledge.sync({ config: connector, items: [] });
  if (fieldMetadata.length !== 10 || !Object.keys(CAPTURE_FIELDS).every(name => fieldMetadata.some(field => field.field_name === name && field.type === CAPTURE_FIELDS[name]))) throw new SafeError('The new table did not return all ten fields. Inspect the progress journal.');
  if (snapshot.articles.length !== 0 || snapshot.created !== 0) throw new SafeError('The newly created table is not empty. Inspect the progress journal before proceeding.');
  const hostConfig = { ...config, feishu: { ...config.feishu, appId, export: { baseToken, articleTableId } } };
  await onProgress({ stage: 'verified-empty', connectionId, baseToken, articleTableId, fields: 10, records: 0 });
  return { config: hostConfig, emptyVerified: true, fields: 10, records: 0 };
}

const usage = 'Usage: node scripts/create-table.mjs private/host.json --output private/new-host.json [--env private/host.env] [--new-base] [--name "ReadFlow Reading"]';
export async function runCreateTable(args) {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  const [file, ...rest] = args;
  let output, envFile, newBase = false, name;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--output' && !output && rest[i + 1]) output = rest[++i];
    else if (rest[i] === '--env' && !envFile && rest[i + 1]) envFile = rest[++i];
    else if (rest[i] === '--name' && !name && rest[i + 1]) name = rest[++i];
    else if (rest[i] === '--new-base' && !newBase) newBase = true;
    else throw new SafeError(usage);
  }
  if (!file || !output || resolve(file) === resolve(output)) throw new SafeError(usage);
  if (envFile) { try { loadEnvFile(envFile); } catch { throw new SafeError('Cannot load the selected environment file.'); } }
  const config = JSON.parse(await readFile(file, 'utf8'));
  await mkdir(dirname(resolve(output)), { recursive: true, mode: 0o700 });
  const parent = await lstat(dirname(resolve(output)));
  if (!parent.isDirectory() || parent.mode & 0o077 || process.getuid && parent.uid !== process.getuid()) throw new SafeError('Use a private output directory owned by the current account with 0700 permissions.');
  // Reserve new files before external effects. Never overwrite an existing config.
  const journal = await open(output + '.progress.json', 'wx', 0o600);
  let target;
  async function write(file, value) { const data = Buffer.from(JSON.stringify(value, null, 2) + '\n'); await file.write(data, 0, data.length, 0); await file.truncate(data.length); await file.sync(); }
  try {
    target = await open(output, 'wx', 0o600);
    await write(target, { setupPending: true, progressFile: output + '.progress.json' });
    await write(journal, { stage: 'initialized', name: name || 'ReadFlow Reading' });
    const result = await createReadingTable({ config, newBase, name, getCredentials: () => ({ appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET }), onProgress: value => write(journal, value) });
    await write(target, result.config);
    console.log('Created ten fields (including tags/remark) and verified zero-record sync. New private config: ' + output);
    const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
    console.log('Review the new export configuration; keep the existing database stateDir.');
    console.log('Explicit export: node examples/run.mjs export ' + quote(output) + (envFile ? ' --env ' + quote(envFile) : ''));
  } finally { if (target) await target.close(); await journal.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runCreateTable(process.argv.slice(2)); }
  catch (error) { const d = cleanDiagnostic(error?.diagnostic); if (d) console.error(JSON.stringify(d)); console.error(safeErrorMessage(error)); console.error('Creation is never retried automatically. Inspect the private .progress.json before retrying.'); process.exitCode = 1; }
}
