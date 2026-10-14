import { messages as diagnosticMessages } from './diagnostics.js';

export const translations = {
  en: {
    lede: 'Save articles and videos worth your time. Organize your collection in Feishu Bitable.',
    readingList: 'Reading list', settings: 'Settings', interfaceLanguage: 'Interface language',
    interfaceHint: 'Saved on this device. This does not change the language of Feishu reminders.',
    connection: 'Feishu connection', connectionHint: 'Save locally, or connect your authorized Feishu workspace to sync your collection.',
    accessKey: 'Connection access key', keyHint: 'Get the dedicated NewsBridge key from whoever configured your connection service, or from its existing credential store.',
    keyHow: 'Using the reference connection yourself?',
    keyInit: 'Run this command in the project folder on the machine running your connection, after preparing private/host.json:',
    keyFile: 'Open access.key in your configured stateDir and paste its contents here. The example configuration uses private/state/access.key. Initialization preserves an existing key.',
    keySafety: 'Use the connection key here, not a Feishu App Secret or access token. Leave blank to keep a saved key. To rotate it, replace the host key, then enter and save the new key here. Reinstallation or another Chrome profile may require entering it again.',
    noKey: 'No key saved · Enter the connection key for this Chrome profile.',
    keySaved: 'Key saved · {time}{endpoint}', timeUnknown: 'save time unavailable', endpointChanged: ' · endpoint changed; re-enter the key',
    tableLink: 'Feishu Bitable link', tableHint: 'Paste a Feishu /base/ or /wiki/ share link. Links without table= use the connected service’s configured table in the same base. Wiki links resolve when you check the connection.',
    baseToken: 'Bitable base token', baseHint: 'Parsed from /base/, or returned after resolving a wiki link.',
    tableId: 'Table ID', tableIdHint: 'From table= when present; otherwise from the verified connection’s configured table.',
    idPlaceholder: 'Paste a table link to fill automatically',
    idsParsed: 'IDs parsed from your link; access is not yet verified.', idsVerified: 'IDs parsed from your link and matched to the connection.',
    idsServer: 'Showing the authorized table returned by the connection. Paste its direct link to compare.', idsEmpty: 'Base token and Table ID fill from the table link. A table link cannot provide a conversation ID.',
    tableEmpty: 'Paste a direct Bitable link to compare it with the connection target.',
    basePending: 'Base ID parsed · Check the connection to fill its configured Table ID.',
    wikiPending: 'Valid wiki link · Check the connection to resolve the Bitable. Wiki read permission is required.',
    wikiVerified: 'Wiki link resolved to the authorized Bitable and its configured data table.',
    idsConfigured: 'No table= in this link; using the connected service’s configured table in the same base.',
    tableFormat: 'Format valid · Server match and access not checked.',
    tableMismatch: 'Format valid · Does not match the server-authorized table.',
    tableVerified: 'Format valid · Matches server configuration · Read access and eight fields verified. Write access needs the explicit host self-test.',
    check: 'Check connection / Retry', sync: 'Sync reading library', syncReady: 'Connection checked. Sync uploads new captures and refreshes Feishu status.',
    syncUnavailable: 'Sync is unavailable: check the connection, match the table, and save the key first.',
    connected: 'Connected · Identity, read access and eight table fields verified.',
    disconnected: 'Not connected. Local captures remain available; a connected build and authorized host are required for Feishu sync.',
    checking: 'Checking connection…', keyAccepted: 'Key accepted · Save settings to store this key.', savedKeyAccepted: 'Saved key accepted.', keyNotChecked: 'Not checked · Leave this field to validate without saving.',
    messages: 'Reading reminders', reminders: 'Daily unread reminders', reminderHint: 'Optional. Configure the connection scheduler first; save settings to apply this switch.',
    reminderExplanation: 'Only daily reminders need a conversation ID. Saving and syncing Bitable work without one. A reminder never marks an item as read.',
    chatId: 'Reminder conversation ID', chatHint: 'For reminders only. Returned by the connection service (chat_id, usually oc_…). It cannot be derived from a Bitable link; configure the target conversation in that service.',
    chatPlaceholder: 'Optional — configure on the connection for reminders',
    schedule: 'Server state: {state} · 10:00 ({zone}). Save settings to apply changes. Sending does not mark items read.', on: 'On', off: 'Off',
    scheduleUnavailable: 'Reminders are unavailable. Configure the scheduler, target conversation and message permissions on the connection service if you need them. Bitable sync does not require reminders.',
    reminderLanguage: 'Reminder message language', reminderLanguageHint: 'Changes Feishu reminder messages. Interface language is set separately above.',
    save: 'Save settings', saved: 'Saved', pendingHeading: 'Check an unconfirmed message',
    pendingHint: 'Check the target Feishu conversation before choosing a result. Previous delivery receipts are preserved.',
    confirmSent: 'I verified it was delivered', confirmNotSent: 'I verified it was not delivered',
    pendingNote: '{count} items · requested {time} · reference {reference}', pendingFailed: ' Pending check failed: {error}',
    footer: 'Server: {server} · Extension {version} · Protocol {protocol}', offline: 'Offline build', unverified: 'not verified',
    count: '{total} saved · {unread} unread', emptyHeading: 'Nothing saved yet', emptyHint: 'Click the NewsBridge toolbar icon on an article or video page to save its title and link.',
    markRead: 'Mark as read', markUnread: 'Mark as unread', remove: 'Remove', removeLinked: 'Delete this item in Feishu Bitable, then sync.',
    itemMeta: '{domain} · saved {date}', sent: 'Sent', genericFailure: 'Could not complete the operation.',
    tableInvalid: 'Paste a complete HTTPS Feishu Bitable or wiki link.', tableHostInvalid: 'Use a Feishu or Lark Bitable link.',
    tableWiki: 'Wiki links resolve through the connection service during Check connection.', tableMissingId: 'Use a /base/ or /wiki/ link; if table= is present it must contain one valid Table ID.',
  },
  zh: {
    lede: '收藏值得深入阅读的文章和视频，在飞书多维表格中整理与回顾。',
    readingList: '阅读列表', settings: '设置', interfaceLanguage: '界面语言',
    interfaceHint: '保存在本机，仅影响插件界面。飞书提醒语言在下方单独设置。',
    connection: '飞书连接', connectionHint: '可先在本机收藏；连接已授权的飞书工作空间后即可同步。',
    accessKey: '连接访问密钥', keyHint: '向配置连接服务的人获取 NewsBridge 专用密钥，或从该服务现有的凭证存储中取得。',
    keyHow: '自己运行仓库的参考连接？',
    keyInit: '先准备 private/host.json，再在运行连接服务的设备上，进入项目目录执行：',
    keyFile: '打开配置中 stateDir 目录里的 access.key，将文件内容粘贴到此处。示例配置的路径是 private/state/access.key。初始化不会替换已有密钥。',
    keySafety: '这里填写连接专用密钥，不是飞书 App Secret 或访问令牌。留空可保留已存密钥。轮换时先更新连接端密钥，再在此输入新密钥并保存。重装或更换 Chrome 配置后可能需要重新输入。',
    noKey: '未保存密钥 · 请为当前 Chrome 配置输入连接密钥。',
    keySaved: '已保存密钥 · {time}{endpoint}', timeUnknown: '保存时间未知', endpointChanged: ' · 连接地址已变更，请重新输入密钥',
    tableLink: '飞书多维表格链接', tableHint: '支持飞书 /base/ 与 /wiki/ 分享链接。不含 table= 时，匹配同一多维表格下连接端已配置的数据表；知识库链接在检查连接时解析。',
    baseToken: '多维表格 ID（Base token）', baseHint: '从 /base/ 链接解析，或由连接端解析知识库链接后返回。',
    tableId: '数据表 ID（Table ID）', tableIdHint: '优先取链接的 table= 参数；未包含时匹配已验证连接的目标数据表。',
    idPlaceholder: '粘贴表格链接后自动填写',
    idsParsed: '已从链接解析 ID，尚未验证访问权限。', idsVerified: '已从链接解析 ID，并与连接服务配置一致。',
    idsServer: '当前显示连接服务授权的表格 ID，可粘贴其直接链接进行核对。', idsEmpty: '多维表格 ID 和数据表 ID 可从表格链接解析；会话 ID 无法从表格链接取得。',
    tableEmpty: '粘贴多维表格直接链接，核对连接服务的目标表格。',
    basePending: '已解析多维表格 ID · 检查连接后匹配已配置的数据表 ID。',
    wikiPending: '知识库链接格式有效 · 请检查连接以解析实际多维表格，需要知识库读取权限。',
    wikiVerified: '已将知识库链接解析为连接端授权的多维表格及目标数据表。',
    idsConfigured: '链接未指定 table=，已匹配同一多维表格下连接端配置的目标数据表。',
    tableFormat: '格式有效 · 尚未核对连接配置与访问权限。',
    tableMismatch: '格式有效 · 与连接服务授权的表格不一致。',
    tableVerified: '格式有效 · 与连接配置一致 · 已验证读取权限与八个字段。写入权限仍需显式往返自检。',
    check: '检查连接 / 重试', sync: '同步阅读列表', syncReady: '连接检查通过，同步会上传新收藏并更新飞书阅读状态。',
    syncUnavailable: '暂不可同步：请检查连接、核对表格，并保存连接密钥。',
    connected: '已连接 · 身份、读取权限与八个字段检查通过。',
    disconnected: '尚未连接。本机收藏仍可使用；飞书同步需要已配置地址的连接版插件和连接端授权。',
    checking: '正在检查连接…', keyAccepted: '密钥有效 · 点击保存设置后才会存储。', savedKeyAccepted: '已存密钥验证通过。', keyNotChecked: '尚未验证 · 离开输入框时校验，不会自动保存。',
    messages: '阅读提醒', reminders: '每日未读提醒', reminderHint: '可选功能。先配置连接端调度器；修改开关后需保存设置。',
    reminderExplanation: '只有每日提醒需要会话 ID；收藏和多维表格同步不需要。发送提醒不会将素材标记为已读。',
    chatId: '提醒会话 ID', chatHint: '仅用于提醒。由连接服务返回（chat_id，通常以 oc_ 开头）。它不能从表格链接推导，需要在连接服务中配置目标会话。',
    chatPlaceholder: '可选：需要提醒时在连接端配置',
    schedule: '连接端状态：{state} · 每日 10:00（{zone}）。修改后请保存设置；提醒不会标记已读。', on: '开启', off: '关闭',
    scheduleUnavailable: '提醒尚未配置。如需使用，请在连接服务中配置调度器、目标会话和消息权限。多维表格同步无需启用提醒。',
    reminderLanguage: '提醒消息语言', reminderLanguageHint: '仅改变飞书提醒消息；界面语言在上方单独选择。',
    save: '保存设置', saved: '已保存', pendingHeading: '核对未确认的消息',
    pendingHint: '先检查目标飞书会话，再选择发送结果。操作会保留已有发送记录。',
    confirmSent: '已核实：消息已送达', confirmNotSent: '已核实：消息未送达',
    pendingNote: '{count} 条素材 · 请求时间 {time} · 参考编号 {reference}', pendingFailed: ' 待确认消息检查失败：{error}',
    footer: '连接地址：{server} · 插件版本 {version} · 协议版本 {protocol}', offline: '离线版', unverified: '尚未验证',
    count: '已收藏 {total} 条 · 未读 {unread} 条', emptyHeading: '尚无收藏', emptyHint: '在文章或视频页面点击工具栏的 NewsBridge 图标，保存标题与链接。',
    markRead: '标记为已读', markUnread: '标记为未读', remove: '移除', removeLinked: '请先在飞书多维表格中删除此条记录，再同步。',
    itemMeta: '{domain} · 收藏于 {date}', sent: '已发送', genericFailure: '无法完成操作。',
    tableInvalid: '请粘贴完整的 HTTPS 飞书多维表格或知识库分享链接。', tableHostInvalid: '请使用飞书或 Lark 的多维表格链接。',
    tableWiki: '知识库链接会在检查连接时，由连接服务进行解析。', tableMissingId: '请使用 /base/ 或 /wiki/ 链接；若包含 table=，该参数须为一个有效的数据表 ID。',
  },
};
export function chooseLanguage(saved, browserLanguage = 'en') {
  return ['en', 'zh'].includes(saved) ? saved : /^zh(?:-|$)/i.test(browserLanguage) ? 'zh' : 'en';
}
export function translate(language, key, values = {}) {
  const template = translations[language]?.[key] ?? translations.en[key];
  if (typeof template !== 'string') throw new Error(`Unknown translation key: ${key}`);
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}
const tableErrors = new Map([
  [translations.en.tableInvalid, 'tableInvalid'], [translations.en.tableHostInvalid, 'tableHostInvalid'],
  ['Open the target data table and copy its /base/ link including ?table=tbl…', 'tableMissingId'],
  [translations.en.tableWiki, 'tableWiki'], [translations.en.tableMissingId, 'tableMissingId'],
]);
const diagnosticChinese = {
  LINK_RESOLVER_UNAVAILABLE: '连接适配器尚未实现知识库解析，请添加只读解析能力或使用 /base/ 链接。',
  LINK_NOT_BITABLE: '此知识库节点不是多维表格，请使用多维表格节点的链接。',
  LINK_RESPONSE_INVALID: '表格链接解析返回了无效或不匹配的结果，请检查连接端实现。',
  EMPTY_RESPONSE: '飞书响应缺少必要的列表信息。', REMINDERS_UNAVAILABLE: '请先在连接端配置提醒调度器、会话和消息权限。',
  KEY_INVALID: '连接密钥无效、已撤销或格式错误（401）。', ORIGIN_DENIED: '连接服务未登记此扩展的来源（403）。',
  PROBE_FAILED: '写入、读回或删除自检失败，请检查私人自检日志。', PROBE_CLEANUP: '自检记录清理结果不确定，请对照私人日志核实。',
  ACCESS_KEY: '连接端的 access.key 缺失或无效，请检查初始化、文件所有者与权限。',
  TABLE_MISMATCH: '表格链接与连接服务授权的目标不一致，请核对连接配置；更换表格应使用独立资料库。',
  AUTH_VERIFY: '连接账号或应用身份验证失败，请核对凭证与配置的身份。', API_TRANSPORT: '飞书请求失败，请检查网络和当前凭证。',
  API_REJECTED: '飞书拒绝了操作，请根据数字错误码检查权限和字段值。', API_RESPONSE: '连接适配器返回了无效响应。',
  SCHEMA_INVALID: '表格字段缺失或类型不兼容。', STATE_LOAD: '无法读取有效的连接状态，请检查 stateDir、文件内容与权限。',
  STATE_SAVE: '无法保存连接状态，请检查磁盘空间与写入权限。', LOCK_BUSY: '连接状态正被占用，请稍后重试；崩溃恢复前须停止所有持锁进程。',
  OPERATION_FAILED: '连接操作失败，请根据步骤和参考编号排查。',
};
const commonChinese = new Map([
  ['Enter the connection access key in Settings.', '请在设置中填写连接访问密钥。'],
  ['Invalid connection access key.', '连接密钥格式不正确。'],
  ['This offline build has no connection configured.', '当前为离线版，尚未配置连接地址。'],
  ['Connection failed or timed out. Check its availability and HTTPS configuration.', '连接失败或超时，请检查服务是否可用及 HTTPS 配置。'],
  ['Connection operation failed. Check its authorization, permissions and private logs.', '连接操作失败，请检查授权、权限与连接端私人日志。'],
  ['Connection address changed. Verify it and enter its access key again.', '连接地址已更换，请核对地址并重新输入密钥。'],
  ['Connection account or table differs from this collection.', '连接账号或表格与当前资料库不一致。'],
  ['Could not complete the operation.', '无法完成操作。'],
  ['Unsupported or invalid connection response.', '连接返回了无效或不支持的响应。'],
  ['This connection does not support table reading and writing.', '当前连接不具备表格读写能力。'],
  ['Invalid table snapshot; local data was preserved.', '表格同步数据无效，本机数据已保留。'],
  ['The server returned an invalid response.', '连接服务返回了无效响应。'],
  ['The server returned an empty response.', '连接服务返回了空响应。'],
  ['The server response is too large.', '连接响应过大，已停止处理。'],
  ['Sync request exceeds 20 MiB.', '同步请求超过 20 MiB，请减少本次同步内容。'],
  ['Configure a connection before updating linked records.', '请先配置连接，再修改已关联的记录。'],
  ['Delete linked items in Feishu Bitable, then sync.', '请先在飞书多维表格中删除关联记录，再同步。'],

]);
export function localizeError(error, language) {
  const message = typeof error === 'string' ? error : error?.message || translate(language, 'genericFailure');
  if (language !== 'zh') return message;
  const table = tableErrors.get(message);
  if (table) return translate(language, table);
  for (const [code, original] of Object.entries(diagnosticMessages)) {
    if (message.startsWith(original)) return (diagnosticChinese[code] || original) + message.slice(original.length)
      .replace(/: expected /g, '：预期 ').replace(/, actual /g, '，实际 ').replace(/\bmissing\b/g, '缺失');
  }
  return commonChinese.get(message) || message;
}
