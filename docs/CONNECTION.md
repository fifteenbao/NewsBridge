# Connection contract v1 / 连接接口 v1

NewsBridge separates browser capture from authenticated Feishu operations. Integrate with an existing tool; the project does not start a service, install a provider, or provision hosting. A messaging bot alone does not satisfy this contract.

NewsBridge 将浏览器收藏与飞书授权操作分开。接入已有工具即可；项目不启动服务、不安装指定工具、不创建托管环境。仅能发消息的机器人不满足此接口。

## Adapter / 适配器

Use [the adapter template](../examples/adapter.js) to bind these callbacks to your existing environment:

使用模板，将以下函数绑定到现有环境：

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

Config keys are connectionId, baseToken, articleTableId, chatId, remindersEnabled, timeZone and language. Use `chatId: ""` and `remindersEnabled: false` for sync only. Defaults for omitted timezone/language are Asia/Shanghai and en. Store credentials outside config using the host's existing credential management.

配置字段见示例。仅同步时 chatId 留空并关闭 remindersEnabled。凭证由宿主现有的安全存储管理，不写入公开源码或配置示例。

`store.load()` returns `{version: 1, scopes: {}}` initially and the complete saved state thereafter. It must return an isolated value, not a shared mutable reference. `save()` atomically and durably replaces that state and resolves only after persistence. Protect it as private data: receipts may include article links and message content.

初始状态如上。load 返回隔离的快照，save 必须原子且持久化保存完整状态，完成后才能返回。发送记录可能含链接与消息内容，应作为私人数据保护。

`exclusive(work)` must share one lock across browser requests, scheduled jobs and every process/instance using the same collection/state. Hold it until work and all external effects finish. Fail or wait when busy; never run an expired owner concurrently with a new owner. For distributed hosts use a lock/transaction implementation appropriate to that environment. The module also serializes calls within one instance, but that alone does not protect multiple instances. In-memory state is for tests only.

锁必须覆盖浏览器请求、定时任务，以及共享同一数据的所有进程/实例，持续到外部操作完成。多实例环境由宿主实现合适的共享锁；单进程队列不能代替它。内存存储只能用于测试，不能用于持久化提醒。

## Browser protocol / 浏览器协议

Expose the following authenticated POST endpoints in your existing HTTPS environment. The base is an exact origin without a path or query. Requests and responses use JSON with a 20 MiB limit. Authenticate with a dedicated opaque base64url Bearer key (32–512 characters), never a Feishu token. Authenticate even when the Origin header is absent; CORS is not authentication.

在现有 HTTPS 环境提供以下接口，地址使用不带路径或查询参数的唯一 origin。JSON 大小上限 20 MiB。使用连接专用 Bearer 密钥，不使用飞书令牌；没有 Origin 头也必须鉴权，CORS 不能代替鉴权。

| Path / 路径 | Request / 请求字段 | Result / 结果 |
| --- | --- | --- |
| `/v1/health` | `{}` | `connected, capabilities, configuration` |
| `/v1/sync` | `{items: [...]}` | `enabled, base, created, bindings, articles, topics, notifications` |
| `/v1/read` | `{base, recordId, read}` | Status write acknowledged / 状态写入确认 |
| `/v1/preferences` | `{language: "en" or "zh"}` | Saved preferences / 保存偏好 |
| `/v1/pending` | `{}` | `{pending: null or {...}}` |
| `/v1/resolve` | `{uuid, outcome: "sent" or "not-sent"}` | Delivery reconciliation / 发送结果确认 |

Every request may include `expectedIdentity: {connectionId, base}`. Reject a mismatch before using its data. Every successful response contains `ok: true`, `protocolVersion: 1`, and that same `identity`. `base` is `baseToken + "/" + articleTableId`. The browser pins the first verified identity and refuses silent changes of account or table.

请求可携带预期身份，必须先校验再处理数据；每个成功响应必须包含协议版本和身份。浏览器固定首次验证的身份，拒绝静默切换账号或表格。

Health capabilities require tableRead and tableWrite; messages is optional. Configuration returns baseToken, articleTableId, chatId, language, timeZone, remindersEnabled and `reminderOwner: "external"`. No credentials are returned. The provided runtime produces these results directly.

健康检查返回能力和只读配置，不返回凭证。仓库提供的运行模块会直接生成符合协议的结果。

A capture contains `id, title, url, savedAt` (ISO date), and `read` (boolean). Previously linked captures also carry `feishuBase` and `feishuRecordId`. Sync bindings are `{id, recordId}`; normalized articles have `recordId, title, url, read, status, content, category, recommendation, note, savedAt` (milliseconds/null), and `topicIds` (array). The eight-field table returns `topics: []`. Existing Bitable values are authoritative. See [bitable.js](../src/lib/bitable.js) and [knowledge.js](../src/lib/knowledge.js) for the complete mapping.

收藏上传字段和同步响应由上述结构定义。已有表格记录优先，八字段模式的 topics 为空数组，完整映射见实现文件。

## Optional Fetch handler / 可选的 Fetch 接口处理器

```js
import { createHttpHandler } from '../connector/http.js';
const handleRequest = createHttpHandler({
  origin: privateConfig.origin,
  extensionId: privateConfig.extensionId,
  authenticate: verifyDedicatedAccessKey,
  connector,
});
// Mount handleRequest(Request) -> Promise<Response> in your existing router.
```

The supplied handler uses standard Request/Response objects, exact extension-origin checks, input bounds and a per-instance concurrency limit. `authenticate(request)` must verify/revoke the dedicated key through your existing secret store and return a boolean; use a timing-safe verifier. The host remains responsible for TLS, timeouts, admission/rate limits and cross-instance locking. If using a proxy, construct the external request URL only from trusted routing data. Do not trust arbitrary forwarded headers.

此处理器不启动监听端口，直接挂载到已有路由。宿主负责真实鉴权、撤销密钥、TLS、超时、限流与跨实例锁。代理环境只能从可信路由配置恢复外部 URL，不信任任意转发头。

Only `/v1/*` actions above are exposed. There is no HTTP daily-send endpoint, arbitrary API relay or shell-command endpoint. Error responses use `{ok: false, error}` without raw provider details. Inspect private host logs to diagnose an integration failure.

接口不提供定时发送入口、任意 API 转发或命令执行。错误不得包含原始平台详情，排错查看宿主私有日志。

## Scheduling and delivery / 调度与发送

Register `connector.daily()` in the user's existing scheduler for local 10:00. Repeated checks after 10:00 are safe when the same persistent store/lock is used. This method derives the date from the configured timezone; the browser cannot supply a date to dispatch or trigger delivery. Enable reminders only after that scheduling is configured. A host that sleeps or stops cannot guarantee an on-time reminder.

每日任务由已有调度器触发。日期取自配置时区；浏览器不能指定日期或触发发送。调度验证完成后再启用提醒。宿主休眠或停止时不能保证准点送达。

Before a send, the module persists the UUID and exact content, then calls the adapter. It marks receipts only on a confirmed message ID. An uncertain result retries the same UUID within the existing one-hour window; later or changed batches pause for manual reconciliation. Adapters must preserve the provider's UUID deduplication behavior. Never mark articles read just because they were delivered.

先持久化请求，再调用发送；只有明确的消息 ID 才确认送达。不确定时按同一 UUID 重试，超过窗口或素材变化则暂停。适配器必须保留平台去重行为，不能因发送成功就标记已读。
