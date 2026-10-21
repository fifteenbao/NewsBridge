# Connection contract v1 / 连接接口 v1

NewsBridge separates browser capture from authenticated Feishu operations. Integrate with an existing tool; the project does not start a service, install a provider, or provision hosting. A messaging bot alone does not satisfy this contract.

NewsBridge 将浏览器收藏与飞书授权操作分开。接入已有工具即可；项目不启动服务、不安装指定工具、不创建托管环境。仅能发消息的机器人不满足此接口。

## Adapter / 适配器

The [runnable Feishu custom-app adapter](../examples/adapter.js) implements token acquisition, verified app identity and scoped API calls with native fetch. It is optional: existing tools can implement these same callbacks:

仓库提供可运行的飞书自建应用适配器，包括获取凭证、验证应用身份和调用固定接口；也可将以下接口绑定到已有工具，无需采用参考适配器。

```js
const adapter = {
  capabilities: { tableRead: true, tableWrite: true, messages: false },
  async getIdentity() {
    // Verify active credentials with the existing tool before returning identity.
    return { connectionId: verifiedStableIdentity };
  },
  async request(method, path, { params, data } = {}) {
    // Translate to the tool/SDK's authenticated Feishu operation.
    return { code: 0, data: normalizedResponseData };
  },
};
```

`getIdentity()` must verify the active principal/application, and its stable identifier must match config.connectionId. Do not simply echo the config value. Both user and bot authentication can be adapted if they have the required table/message permissions. Normalize successful responses to `{code: 0, data: {...}}`; reject failed operations. Adapter/provider exceptions are sanitized by the connection module.

getIdentity 必须验证实际使用的账号/应用，其稳定标识应匹配 connectionId，不能直接照抄配置。用户或机器人身份均可适配，前提是具备需要的权限。成功响应统一返回上述格式，失败时拒绝操作；模块会隐藏适配器的原始错误。

The connection module selects these operations; the browser never chooses arbitrary API paths:

由模块选择以下操作，浏览器不能指定任意 API 路径：

| Method / 方法 | Feishu path / 路径 | Required response data / 必需数据 |
| --- | --- | --- |
| GET | `/open-apis/bitable/v1/apps/{base}/tables/{table}/fields` | `items: [{field_name, type, property?}], has_more?, page_token?` |
| GET | `/open-apis/bitable/v1/apps/{base}/tables/{table}/records` | `items: [{record_id, fields}], has_more?, page_token?` |
| POST | `/open-apis/bitable/v1/apps/{base}/tables/{table}/records` | `record: {record_id, fields}` |
| PUT | `/open-apis/bitable/v1/apps/{base}/tables/{table}/records/{record}` | `{}` or provider result / 空对象或原响应 |
| POST, optional / 可选 | `/open-apis/im/v1/messages` | `message_id: "om_..."` |

List requests use `page_size: 100` and an optional `page_token`; pass both to the provider. The module stops on incomplete or cyclic pagination. Record creation sends only the eight reading fields, in `data.fields`. Updates write only `阅读状态`. Message delivery uses `receive_id_type: "chat_id"` and `data: {receive_id, msg_type: "post", content, uuid}`. Preserve the UUID, structured content and destination exactly; adapters must not turn this into an unrelated free-form chat action.

分页参数必须传递给底层连接。模块在分页异常时停止；新建仅使用八个阅读字段，更新仅修改阅读状态。发送消息必须保留 UUID、结构化内容和目标会话，不可转成无去重能力的普通聊天调用。

## Runtime, storage and locking / 运行模块、存储与锁

```js
import { createConnector } from '../connector/runtime.js';

const connector = createConnector({
  config,    // A private copy of connector/config.example.json
  adapter,   // Existing authenticated tool
  store,     // { async load(), async save(state) }
  exclusive, // async (work) => result; shared lock around await work()
});
```

Config keys are storageProvider (feishu default, or google), connectionId, baseToken, articleTableId, chatId, remindersEnabled, reminderTime (10:00 default), timeZone and language. For Google the compatibility baseToken is a Spreadsheet ID and articleTableId is a numeric gid. Use `chatId: ""` and `remindersEnabled: false` for sync only. Defaults for omitted timezone/language are Asia/Shanghai and en. Store credentials outside config using the host's existing credential management.

配置字段见示例。仅同步时 chatId 留空并关闭 remindersEnabled。凭证由宿主现有的安全存储管理，不写入公开源码或配置示例。

`store.load()` returns `{version: 1, scopes: {}}` initially and the complete saved state thereafter. It must return an isolated value, not a shared mutable reference. `save()` atomically and durably replaces that state and resolves only after persistence. Protect it as private data: receipts may include article links and message content.

初始状态如上。load 返回隔离的快照，save 必须原子且持久化保存完整状态，完成后才能返回。发送记录可能含链接与消息内容，应作为私人数据保护。

`exclusive(work)` must share one lock across browser requests, scheduled jobs and every process/instance using the same collection/state. Hold it until work and all external effects finish. Fail or wait when busy; never run an expired owner concurrently with a new owner. For distributed hosts use a lock/transaction implementation appropriate to that environment. The module also serializes calls within one instance, but that alone does not protect multiple instances. In-memory state is for tests only.

锁必须覆盖浏览器请求、定时任务，以及共享同一数据的所有进程/实例，持续到外部操作完成。多实例环境由宿主实现合适的共享锁；单进程队列不能代替它。内存存储只能用于测试，不能用于持久化提醒。

## Browser protocol / 浏览器协议

Expose the following authenticated POST endpoints (relative to `baseUrl`) in your existing HTTPS environment. Configure a `baseUrl`: an HTTPS address with an optional application path, for example `https://connection.example.com/newsbridge/`. It must not contain credentials, a query or a fragment. Both root and nested paths are supported; a missing trailing slash is normalized. Requests and responses use JSON with a 20 MiB limit. The reference host authenticates approved browser signatures; see [pairing](PAIRING.md). POST v1/pair accepts only a public key, requires the configured extension origin, and grants no table access until operator approval. Existing data operations use X-NewsBridge-Pair, Time, Nonce and Signature headers. CORS alone is not authentication; Bearer is only a lower-level injectable compatibility mode, not the reference-host default.

在现有 HTTPS 环境提供以下相对于 baseUrl 的接口，使用 `baseUrl` 配置 HTTPS 地址，可带应用子路径，例如 `https://connection.example.com/newsbridge/`。支持根目录或多级目录，末尾斜杠会自动补齐；不得携带凭证、查询参数或片段。JSON 大小上限 20 MiB。参考服务使用已确认的浏览器签名，详见配对指南。v1/pair 只提交公钥，管理员核对指纹确认前不能访问表格；其他操作须带四个 X-NewsBridge-* 签名头。CORS 不能代替认证；Bearer 仅为底层可注入的兼容模式，不是参考服务默认方式。

| Path / 路径 | Request / 请求字段 | Result / 结果 |
| --- | --- | --- |
| `v1/health` | `{tableUrl?: "https://…/base/… or /wiki/…"}` | `connected, capabilities, configuration, schema` |
| `v1/sync` | `{items: [...]}` | `enabled, base, created, bindings, articles, topics, notifications` |
| `v1/read` | `{base, recordId, status: "待阅读" | "已读" | "跳过"} or legacy read boolean` | Status write acknowledged / 状态写入确认 |
| `v1/preferences` | `{language: "en" or "zh", table?: "baseToken/tableId", tableUrl?: "https://…", remindersEnabled?: boolean}` | Saved preferences / 保存偏好 |
| `v1/pending` | `{}` | `{pending: null or {...}}` |
| `v1/resolve` | `{uuid, outcome: "sent" or "not-sent"}` | Delivery reconciliation / 发送结果确认 |

Every request may include `expectedIdentity: {connectionId, base}`. Reject a mismatch before using its data. Every successful response contains `ok: true`, `protocolVersion: 1`, and that same `identity`. `base` is `baseToken + "/" + articleTableId`. The browser pins the first verified identity and refuses silent changes of account or table.

请求可携带预期身份，必须先校验再处理数据；每个成功响应必须包含协议版本和身份。浏览器固定首次验证的身份，拒绝静默切换账号或表格。

Health capabilities require tableRead and tableWrite; messages is optional. Configuration returns baseToken, articleTableId, chatId, language, timeZone, remindersEnabled, remindersAvailable and `reminderOwner: "external"`. No credentials are returned. The provided runtime produces these results directly.

健康检查返回能力和只读配置，不返回凭证。仓库提供的运行模块会直接生成符合协议的结果。

A capture contains `id, title, url, savedAt` (ISO date), and `read` (boolean). Previously linked captures also carry `feishuBase` and `feishuRecordId`. Sync bindings are `{id, recordId}`; normalized articles have `recordId, title, url, read, status, content, category, recommendation, note, savedAt` (milliseconds/null), and `topicIds` (array). The eight-field table returns `topics: []`. Existing Bitable values are authoritative. See [bitable.js](../src/lib/bitable.js) and [knowledge.js](../src/lib/knowledge.js) for the complete mapping.

收藏上传字段和同步响应由上述结构定义。已有表格记录优先，八字段模式的 topics 为空数组，完整映射见实现文件。

### Base URL and origin / 连接地址与 origin

With `baseUrl: "https://connection.example.com/newsbridge/"`, health is `https://connection.example.com/newsbridge/v1/health`, not `/v1/health` at the domain root. Client requests append `v1/<action>` relative to the normalized base URL. Changing the base path requires separate browser pairing, even on the same host.

示例配置的健康检查路径为 `/newsbridge/v1/health`，浏览器按目录追加 `v1/<action>`，不会跳到域名根目录。同域名下更换路径也需要重新输入密钥，避免旧密钥被静默转发给其他应用。

Use the same external `baseUrl` on the handler and extension. Mount this subtree in the existing router without stripping its prefix. If a proxy strips it, the host integration must restore the configured external URL before calling the handler, using trusted routing configuration. The handler rejects sibling/root routes; it never guesses forwarded headers or redirects a request to another path.

连接端与扩展必须使用相同外部 baseUrl。路由应保留目录前缀；代理若移除了前缀，宿主应依据可信配置恢复外部 URL 后再调用处理器，不能使用任意请求头推断地址。处理器拒绝其他目录，不通过重定向修正地址。

`origin` means scheme, host and port only. The build derives Chrome host permissions and CSP from it. [Chrome ignores the path in host permissions](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns), so permissions use `https://connection.example.com/*`. A subdirectory is a routing boundary, not an independent browser security origin. Fixed client routes, exact handler paths and dedicated authentication constrain this integration; do not claim path-only Chrome access.

origin 只包含协议、主机与端口，打包程序据此生成 Chrome 域名权限与 CSP。Chrome 的 host_permissions 会忽略路径，所以权限仍是该主机下的 `/*`。子目录解决路由共存，不形成独立浏览器安全来源；实际操作由固定请求路径、路由校验和已确认的签名认证约束，不能宣称 Chrome 权限只覆盖该目录。

For unambiguous routing, paths accept slash-separated ASCII letters, digits, underscores, hyphens and dots within a segment. Empty interior segments, dot traversal, percent-encoded segments and backslashes are rejected.

路径使用普通字母、数字、下划线、短横线，以及段内的点号；拒绝中间空段、目录跳转、百分号编码和反斜杠，避免不同路由器产生不同解释。

## Optional Fetch handler / 可选的 Fetch 接口处理器

```js
import { createHttpHandler } from '../connector/http.js';
const handleRequest = createHttpHandler({
  baseUrl: privateConfig.baseUrl,
  extensionId: privateConfig.extensionId,
  pairing, // createPairing({config, store, exclusive}); see examples/host.js
  authenticate: pairing.authenticate,
  connector,
});
// Mount handleRequest(Request) -> Promise<Response> in your existing router.
```

The supplied handler uses standard Request/Response objects, exact extension-origin checks, input bounds and a per-instance concurrency limit. `authenticate(request)` verifies approved signatures and persists nonce replay protection before dispatch. The reference pairing implementation shares the same store and exclusive lock as the connector. The host remains responsible for TLS, timeouts, admission/rate limits and cross-instance locking. If using a proxy, construct the external request URL only from trusted routing data. Do not trust arbitrary forwarded headers.

此处理器不启动监听端口，直接挂载到已有路由。宿主负责签名认证、撤销配对、TLS、超时、限流与跨实例锁。代理环境只能从可信路由配置恢复外部 URL，不信任任意转发头。

Only `/v1/*` actions above are exposed. There is no HTTP daily-send endpoint, arbitrary API relay or shell-command endpoint. Error responses include `{ok: false, error, diagnostic}`. The browser renders only allowlisted diagnostic codes and metadata, never arbitrary provider messages. Use the reference to correlate the browser error with `onDiagnostic` output.

接口不提供定时发送入口、任意 API 转发或命令执行。错误包含安全的 diagnostic（编号、步骤、数字平台错误码、引用编号），页面与 onDiagnostic 私有日志使用同一个引用编号；不记录令牌、原始响应或任意异常文本。

## Scheduling and delivery / 调度与发送

Register `connector.daily()` in the user's existing scheduler every minute/few minutes for the saved daily time (10:00 default). Repeated checks after that time are safe when the same persistent store/lock is used. This method derives the date from the configured timezone; the browser cannot supply a date to dispatch or trigger delivery. Enable reminders only after that scheduling is configured. A host that sleeps or stops cannot guarantee an on-time reminder.

每日任务由已有调度器触发。日期取自配置时区；浏览器不能指定日期或触发发送。调度验证完成后再启用提醒。宿主休眠或停止时不能保证准点送达。

Before a send, the module persists the UUID and exact content, then calls the adapter. It marks receipts only on a confirmed message ID. An uncertain result retries the same UUID within the existing one-hour window; later or changed batches pause for manual reconciliation. Adapters must preserve the provider's UUID deduplication behavior. Never mark articles read just because they were delivered.

先持久化请求，再调用发送；只有明确的消息 ID 才确认送达。不确定时按同一 UUID 重试，超过窗口或素材变化则暂停。适配器必须保留平台去重行为，不能因发送成功就标记已读。

## Preflight and diagnostics / 预检与诊断

`health` reads field metadata and checks all eight required names and types before returning `schema: {valid: true, checkedFields: 8}`. Sync repeats this check before creating records. A read-only health check establishes schema/read access, **not proof of write permission**; capabilities are adapter declarations. Verify a reversible write with authorized test content separately. Missing or wrong types return `SCHEMA_INVALID` with every affected field, expected numeric types and actual type (null means missing or ambiguous). No fields are automatically changed.

health 会读取字段元数据并一次报告八个字段的缺失或类型错误；同步在写入前再次检查。只读预检不等于已验证写权限，写权限需用获准的测试记录单独确认。不会自动改表头或字段类型。

Supply `onDiagnostic(diagnostic)` to createConnector. It receives only code, stage, a generated reference, optional numeric providerCode/httpStatus and known schema fields. Default core callback is a no-op; the reference host writes sanitized JSON to stderr. Never add raw exception objects or credentials to this callback. An adapter may throw `DiagnosticError` from `src/lib/diagnostics.js`; generic exceptions become API_TRANSPORT/AUTH_VERIFY. Unsuccessful `{code, data}` results preserve only a numeric code. STATE_LOAD/STATE_SAVE identify persistence failures; LOCK_BUSY identifies contention. Pending-state validation failures also stop without resetting receipts. Delivery failures retain the pending UUID.

通过 onDiagnostic 接入现有日志。核心默认不写日志，参考宿主输出已脱敏 JSON。适配器可抛 DiagnosticError；普通异常隐藏原始内容。STATE_LOAD/STATE_SAVE 分别检查状态文件格式、权限或磁盘；LOCK_BUSY 检查持锁进程。不得通过清空状态解决 pending 失败，否则会丢失发送去重记录。

The reference host can start with an empty extensionId for local CLI setup/checks, but browser pairing and signed HTTP access require the actual registered extension ID. Fill it and recreate/restart the handler before pairing. Origin is browser isolation, not a secret: signatures and operator-approved public keys provide authentication. The separate lower-level Bearer compatibility handler can permit authenticated no-Origin diagnostics; that behavior is not the paired reference host.

参考服务允许 extensionId 暂留空以便本机 CLI 初始化／检查，但浏览器配对及签名 HTTP 请求必须配置真实扩展 ID 并重建处理器。Origin 只是来源隔离，真正认证来自管理员确认过的公钥及请求签名。底层独立 Bearer 兼容处理器可允许已鉴权的无 Origin 诊断，不等于配对参考服务。

## Eight-field codec / 八字段编解码

The adapter passes API field values through; the core writes plain strings to text fields and decodes returned rich-text arrays. Do not JSON-stringify text arrays or wrap the entire fields object in a string. [Feishu record creation documentation](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create) defines the wire values; the following table specifies NewsBridge's mapping.

适配器保留 API 字段值结构，由核心将文本写为字符串、将返回的富文本数组提取为纯文本。不要把富文本数组或 fields 对象再次 JSON 字符串化。下表为本项目实际规则：

| Field / 字段 | Accepted type / 允许类型 | New capture writes / 新收藏写入 | Read normalization / 读取 |
| --- | --- | --- | --- |
| 标题 | 1 text / 文本 | title string (URL fallback) / 标题字符串 | string or concatenate array text / 字符串或数组 text 拼接 |
| 链接 | 15 URL, 1 text | 15: `{text: title, link: url}`; 1: URL string | object.link or text; unsafe URL becomes empty / 不安全链接置空 |
| 内容 | 1 text / 文本 | content string, default empty / 默认空 | string or rich-text text / 富文本提取纯文本 |
| 类别 | 3 single, 4 multiple / 单选、多选 | 3: `"待分类"`; 4: `["待分类"]` | string or joined options with 、 / 多选以顿号拼接 |
| 阅读状态 | 3 single / 单选 | `"待阅读"`, `"已读"` or `"跳过"` | 待阅读、阅读中 → read=false; all others → true, excluded from unread reminders / 其他状态不提醒 |
| 推荐指数 | 2 number/rating / 数字、评分（Rating） | omitted, no invented rating / 不自动评分 | number or null / 数字或空 |
| 笔记 | 1 text / 文本 | empty string / 空字符串 | string or rich-text text; formatting not copied / 不复制排版 |
| 时间 | 5 date / 日期 | Unix milliseconds from savedAt / 毫秒时间戳 | milliseconds or null; adapters must normalize custom date formats / 自定义日期须先转换 |

Text reads accept strings or arrays containing strings / `{text: "..."}`; other segments contribute no text. Text is capped at 64,000 characters. Existing Feishu content and notes are never rewritten from a stale browser copy; explicit read changes update only 阅读状态. Health validates numeric field types; option permissions, advanced table access rules and write authorization still need separate verification. Wiki links resolve through the optional authenticated adapter resolver; the extension never uses a wiki node token as a base token.

读取文本允许字符串或含字符串、text 对象的数组，最多 64,000 字符；不识别的富文本片段忽略。已有内容与笔记以飞书为准，状态修改只写阅读状态。预检不保证单选选项变更权限或高级权限可写。知识库链接由可选的已鉴权适配器解析，不将知识库 node_token 当成 baseToken。

Rating uses type 2 (`ui_type: Rating`); type 20 is a formula and is not accepted as 推荐指数. See [official field reference](https://github.com/larksuite/openclaw-lark/blob/main/skills/feishu-bitable/references/field-properties.md).

评分属于 type=2，type=20 是公式，预检不将公式当作评分接受。

## Setup feedback additions / 设置反馈补充

`preferences.remindersEnabled` is optional. Persist it with language, preserving omitted preferences. The effective value is the host's enabled reminder capability AND the saved preference is not false. Reject true with REMINDERS_UNAVAILABLE when the host has not configured reminders. Health exposes remindersAvailable (host capability) and remindersEnabled (effective saved state). A browser preference never invokes daily(); the scheduler reads it under the same lock. Disabling does not discard pending UUIDs or delivery receipts.

提醒偏好省略时保留原值；服务端能力未启用则拒绝开启。health 同时返回可用性与实际开关状态。修改开关不发送消息、不清空历史或待确认状态，调度器使用同一共享锁读取最新值。

Diagnostics qualify the stage with the operation, for example `sync.records.list`, `health.fields`, or `pending.state.load`. Adapter-supplied allowlisted diagnostics and numeric providerCode/httpStatus survive wrapping; raw provider messages remain excluded. CLI checks emit this structured data to stderr. Empty tables are successful syncs, not EMPTY_TABLE errors. The reference operator-only probe can GET/DELETE just its newly created record; no browser endpoint or general adapter request gains delete access.

诊断步骤包含操作前缀，保留底层数字错误码和 HTTP 状态；普通空表是成功结果。显式往返自检的读取/删除仅针对其新建记录，浏览器协议没有新增删除或任意 API 调用能力。

## Share-link resolution / 分享链接解析

The parser accepts /base/{token} and /wiki/{nodeToken}, with an optional single valid table=tbl… value. Copy/view parameters are stripped. With a base-only link, the runtime accepts only config.baseToken and fills config.articleTableId. It neither lists other tables nor selects an arbitrary table. With a wiki link, add this optional adapter method:

```js
async resolveWikiNode(nodeToken) {
  // Authenticated read-only lookup using your existing connection.
  return { nodeToken: verifiedNodeToken, objType: 'bitable', objToken: verifiedBaseToken };
}
```

The runtime verifies the active identity, returned node token, Bitable object type, matching configured base and any table= value. The reference adapter implements GET /open-apis/wiki/v2/spaces/get_node?token={nodeToken}; the general request method still cannot relay arbitrary wiki API paths. Return no node titles or other metadata to Chrome. This method is optional for /base/ users and requires appropriate wiki node read permission for /wiki/ users.

runtime 接受 base 和 wiki 分享链接，table 参数可省略；只匹配固定配置目标。Wiki 查询使用已有凭证，由适配器实现可选方法；不扩展普通 API 转发范围，不返回其他节点的标题与元数据。仅使用 base 链接时无需知识库权限。

On health/preferences with tableUrl, success includes `resolvedTable: {url, baseToken, articleTableId, base, source}`. url is the sanitized input URL, base equals the pinned identity base, and source is explicit-link, configured-table or wiki-node. Chrome validates this descriptor before pinning identity; preferences resolve again before persistence. LINK_RESOLVER_UNAVAILABLE identifies a missing adapter method, LINK_NOT_BITABLE a different object type, LINK_RESPONSE_INVALID a malformed result, and TABLE_MISMATCH an unauthorized target. Wiki API failures preserve numeric codes and the wiki.resolve stage. No automatic reconfiguration or migration occurs.

解析结果在 health/preferences 成功响应中返回，并由 Chrome 验证；保存偏好前连接端会再次检查链接。缺少解析能力、非多维表格、响应无效、目标不匹配分别使用上述诊断编号。不会自动重配同步目标。

Reading updates accept either status (待阅读 / 已读 / 跳过) or the earlier boolean read, never both. They update only 阅读状态. 跳过 is represented as read=true plus status=跳过 in the normalized snapshot, so it is distinguished from completion while excluded from unread selection. Chrome preserves that status when merging. Captures skipped offline create a record with 跳过 when later synced. Update the connection runtime/policy alongside the extension for this status.

状态修改接受三态 status 或旧的 read 布尔值，两者不能同时提供，只写阅读状态字段。跳过在同步快照中保留 status，并使用 read=true 退出未读选择；不会删除或覆盖笔记。离线跳过的收藏后续创建时也保留“跳过”。需要同步更新连接端运行模块和策略。


## V0.3.0 providers and association / 表格类型与关联

See [self-hosting](SELF-HOSTING.md) / [中文部署](SELF-HOSTING.zh-CN.md). Browser requests may include provider=feishu|google; the host routes only preconfigured profiles and strips that routing field before dispatch. The runtime also validates it against its own storageProvider if supplied. A single-provider host rejects the other provider. Every result retains the verified account/table identity; selecting a provider never bypasses identity pinning or provision credentials.

浏览器请求可带 provider=feishu|google，宿主仅路由预先配置的类型，核心同时校验类型。响应仍包含已验证的身份与目标表格；选择类型不能跳过身份锁定，也不授予凭证。

The Google reference translates the existing restricted Feishu-shaped internal operations to Sheets API; it is not an arbitrary API relay. It supplies header-derived field descriptors, rec<metadataId> record IDs, literal eight-column values, metadata-targeted reading-status updates and optional separately verified Feishu messaging. Schema health is read-only. Operator prepare adopts imported rows; check --write verifies a disposable record. General spreadsheet creation/deletion, arbitrary ranges and formulas are not browser actions.

Google 参考适配器将受限的内部飞书形态操作翻译成 Sheets API，校验八列表头，以 rec<metadataId> 表示稳定行身份，按元数据更新状态。飞书消息需另行验证应用身份。prepare 与写入自检仅供运维执行，不开放浏览器任意 API、区域、公式或表格删除操作。

preferences accepts optional reminderTime (HH:mm) and timeZone (IANA) alongside existing keys. health.configuration returns storageProvider, reminderTime and the effective timezone. Profiles retain separate durable preferences/receipts. The scheduler polls; browser preference changes do not create scheduled jobs or trigger a send. Messages remain Feishu chats for either storage provider.

preferences 新增可选 reminderTime（HH:mm）、timeZone（IANA）；health 回显实际值与 storageProvider。每种类型独立保存偏好与发送记录；调度器轮询，浏览器保存设置不建任务也不直接发消息。两种表格的提醒均发到已配置飞书会话。

Disconnect is a Chrome-local atomic archive/reset. It does not clear server state, pending deliveries, revoke credentials or delete remote data. Reassociation pins a newly verified identity and restores only its matching archive. The frontend permits re-association on the same preconfigured HTTPS host; changing origins still needs private packaging.

取消关联是 Chrome 本机的原子归档／重置，不删除服务端状态、未确认消息、授权或远端数据；重新关联后只恢复匹配身份的归档。跨 HTTPS 域名仍需重新生成私人扩展包。


## Settings endpoint / 设置页连接地址

CONNECTION_BASE_URL is an optional prefilled fallback, empty in public source. Settings persists connectionEndpoint in Chrome-local storage. The public package declares optional HTTPS hosts and asks for only the selected host on Check/Save; the client verifies permission before sending. CSP permits HTTPS transport, while URL validation, granted host permission and the saved endpoint constrain the service route. Changing the endpoint requires disconnect/reassociation and separate pairing. This does not remove service-side extensionId or credential verification. HTTP localhost is not supported by this transport. A private build can still prefill an endpoint and keep its required fixed-origin permission, which cannot be revoked at runtime.

CONNECTION_BASE_URL 仅为可选预填默认值，公开源码留空。设置页将地址保存为 Chrome 本机 connectionEndpoint，检查／保存时按具体 HTTPS 主机申请可选权限，发送前再校验授权。CSP 允许 HTTPS，地址校验、实际主机授权与已保存地址限定服务路由。换地址需取消关联并独立配对，不取消服务端 extensionId 校验或认证；仍不支持 HTTP localhost。私人固定地址包的必需域名权限无法运行时撤销。

The only language selector is in the header. It updates UI immediately; Save settings sends that same language through the existing preferences operation for reminders. Parsed table IDs remain internal: provider and its adjacent link input determine the match, then host identity/schema validation confirms authorization.

只保留页眉语言选择，界面立即变化，保存设置时通过现有 preferences 将相同语言用于提醒。解析出的表格 ID 只在内部使用，不显示为输入项；类型及紧邻的链接输入确定目标，最终由宿主身份与字段检查验证授权。
