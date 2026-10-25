import { createAgentApi } from './agent-api.js';
// Wire into an existing HTTPS router; importing this file never binds a port.
import { validateHostConfig } from '../connector/host-config.js';
import { DiagnosticError } from '../src/lib/diagnostics.js';
import { resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createFeishuInbox } from './feishu-inbox.js';
import { createPairing } from './pairing.js';
import { openLibrary } from './database.js';
import { createFeishuService } from './feishu-service.js';
import { createDatabaseConnector } from '../connector/database-runtime.js';
import { createFileState } from './file-state.js';
import { createHttpHandler } from '../connector/http.js';
export async function loadHostConfig(file) {
  const config = JSON.parse(await readFile(file, 'utf8'));
  if (typeof config.stateDir !== 'string' || !config.stateDir) throw new Error('Set stateDir.');
  return { ...config, stateDir: resolve(dirname(resolve(file)), config.stateDir) };
}
export async function createHost(config, { getCredentials = () => ({ appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET }), getEventCredentials = () => ({ encryptKey: process.env.FEISHU_EVENT_ENCRYPT_KEY, verificationToken: process.env.FEISHU_EVENT_VERIFICATION_TOKEN }), onDiagnostic = diagnostic => console.error(JSON.stringify(diagnostic)) } = {}) {
  validateHostConfig(config);
  let persistence;
  // Fail before mounting when the explicit initialization step was missed.
  try { persistence = await createFileState({ ...config, authentication: 'paired' }); await persistence.store.load(); }
  catch { throw new DiagnosticError('STATE_LOAD', 'state.load'); }
  const library = await openLibrary(config.stateDir);
  try {
    const shared = { store: library.store, exclusive: persistence.exclusive };
    const feishuConfig = { ...config.feishu, allowedChatIds: config.feishuInbox?.allowedChatIds || [] };
    const feishu = createFeishuService({ config: feishuConfig, getCredentials });
    const runtimeConfig = { ...config.connector, chatId: config.feishu?.chatId || '', interactive: config.feishuInbox?.enabled === true };
    const connector = createDatabaseConnector({ library, config: runtimeConfig, feishu, ...shared });
    const pairing = createPairing({ config, ...shared });
    const agentPairing = createPairing({ config, ...shared, agent: true });
    const agentApi = createAgentApi({ config, pairing: agentPairing, library, exclusive: persistence.exclusive });
    const agentPath = new URL('v1/agent/', config.baseUrl.endsWith('/') ? config.baseUrl : config.baseUrl + '/').pathname;
    const handleRequest = createHttpHandler({ baseUrl: config.baseUrl, extensionId: config.extensionId,
      authenticate: pairing.authenticate, pairing, connector });
    const inbox = config.feishuInbox?.enabled ? createFeishuInbox({
      config: { ...runtimeConfig, connectionId: `app:${config.feishu?.appId}`, baseToken: library.libraryId, articleTableId: 'library', storageProvider: 'feishu' },
      inboxConfig: config.feishuInbox, ...shared,
      capture: items => library.sync(items), applyAction: (...args) => library.applyAction(...args),
      sendReceipt: async (chatId, uuid, count, created) => {
        const result = await feishu.send(chatId, 'post', { zh_cn: { title: 'ReadFlow · 已收录 / Saved', content: [[{ tag: 'text', text: `${count} 个链接：${created} 条新收藏，其余已存在。Saved ${created} new item(s); other links already exist.` }]] } }, uuid);
        if (!/^om_[A-Za-z0-9]+$/.test(result.data?.message_id || '')) throw new Error('Receipt delivery is unconfirmed.');
      },
      getEventCredentials, onDiagnostic,
    }) : null;
    const eventUrl = new URL('events/feishu', config.baseUrl.endsWith('/') ? config.baseUrl : config.baseUrl + '/').href;
    const route = async request => request.url === eventUrl
      ? inbox ? inbox.handleRequest(request) : new Response(null, { status: 404 })
      : new URL(request.url).pathname.startsWith(agentPath) ? agentApi(request) : handleRequest(request);
    return { connector, handleRequest: route, pairing, agentPairing, library, feishu, inbox, store: library.store, exclusive: persistence.exclusive, close: () => library.close() };
  } catch (error) { library.close(); throw error; }
}
