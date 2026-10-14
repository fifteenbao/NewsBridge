// Wire into an existing HTTPS router; importing this file never binds a port.
import { DiagnosticError } from '../src/lib/diagnostics.js';
import { resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
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
  const adapter = createAdapter({ config: config.connector, getCredentials });
  const connector = createConnector({ config: config.connector, adapter, ...persistence, onDiagnostic });
  const handleRequest = createHttpHandler({ baseUrl: config.baseUrl, extensionId: config.extensionId,
    authenticate: persistence.authenticate, connector });
  return { connector, handleRequest, adapter, store: persistence.store, exclusive: persistence.exclusive };
}
