// Wire into an existing HTTPS router; importing this file never binds a port.
import { DiagnosticError } from '../src/lib/diagnostics.js';
import { resolve, dirname } from 'node:path';
import { readFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createGoogleAdapter } from './google-adapter.js';
import { createAdapter } from './adapter.js';
import { createFileState } from './file-state.js';
import { createConnector } from '../connector/runtime.js';
import { createHttpHandler } from '../connector/http.js';
export async function loadHostConfig(file) {
  const config = JSON.parse(await readFile(file, 'utf8'));
  if (typeof config.stateDir !== 'string' || !config.stateDir) throw new Error('Set stateDir.');
  return { ...config, stateDir: resolve(dirname(resolve(file)), config.stateDir) };
}
export async function createHost(config, { getCredentials = () => ({ appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET }), onDiagnostic = diagnostic => console.error(JSON.stringify(diagnostic)) } = {}) {
  let persistence;
  // Fail before mounting when the explicit initialization step was missed.
  try { persistence = await createFileState(config); await persistence.store.load(); }
  catch { throw new DiagnosticError('STATE_LOAD', 'state.load'); }
  try { await persistence.checkAccessKey(); }
  catch { throw new DiagnosticError('ACCESS_KEY', 'identity'); }
  const profiles = config.connections || { [config.connector.storageProvider || 'feishu']: config.connector };
  const hosts = {};
  for (const [provider, input] of Object.entries(profiles)) {
    if (!['feishu', 'google'].includes(provider) || (input.storageProvider || 'feishu') !== provider) throw new DiagnosticError('AUTH_VERIFY', 'identity');
    let adapter;
    if (provider === 'google') {
      const getGoogleCredentials = async () => {
        const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
        if (!file) throw new Error();
        const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.nlink !== 1 || info.mode & 0o077 || typeof process.getuid === 'function' && info.uid !== process.getuid() || info.size > 65536) throw new Error();
          return JSON.parse(await handle.readFile('utf8'));
        } finally { await handle.close(); }
      };
      const messageAdapter = input.remindersEnabled ? createAdapter({ config: { ...input, storageProvider: 'feishu', connectionId: input.messageConnectionId }, getCredentials }) : undefined;
      adapter = createGoogleAdapter({ config: input, getCredentials: getGoogleCredentials, messageAdapter });
    } else adapter = createAdapter({ config: input, getCredentials });
    hosts[provider] = { adapter, connector: createConnector({ config: input, adapter, ...persistence, onDiagnostic }), config: input };
  }
  const primary = hosts[config.connector.storageProvider || 'feishu'];
  if (!primary) throw new DiagnosticError('AUTH_VERIFY', 'identity');
  const { adapter, connector } = primary;
  const router = { async dispatch(action, payload = {}) {
    const provider = payload.provider || config.connector.storageProvider || 'feishu';
    if (!Object.hasOwn(hosts, provider)) throw new DiagnosticError('TABLE_MISMATCH', 'fields');
    const { provider: ignored, ...body } = payload;
    return hosts[provider].connector.dispatch(action, body);
  } };
  const handleRequest = createHttpHandler({ baseUrl: config.baseUrl, extensionId: config.extensionId,
    authenticate: persistence.authenticate, connector: router });
  return { connector, hosts, handleRequest, adapter, store: persistence.store, exclusive: persistence.exclusive };
}
