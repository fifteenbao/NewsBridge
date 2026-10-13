# Architecture / 架构

## Connection and boundaries / 连接与边界

```text
Chrome extension (captures, cache, daily alarms)
  └─ Native Messaging / stdin and stdout
      └─ on-demand Node.js helper (policy, identity check, private journal)
          └─ authorized local lark-cli workspace
              └─ official Feishu APIs (table and configured conversation)
```

Chrome starts `com.newsbridge.helper` for each operation. The helper uses no HTTP server, TCP listener, cloud login service, scheduled OS service, or agent connector. `nativeMessaging` is required; `host_permissions` is absent and extension network connections are blocked by its content policy. The CLI still performs outbound authenticated API requests.

Chrome 按需启动桥接程序，不使用本地 HTTP/TCP 监听、托管登录服务、系统常驻任务或 Agent 连接器。扩展无域名访问权限，网络策略禁止扩展发起连接；真正的飞书 API 请求由 CLI 发出。

The native registration allows one exact extension origin; the process checks that origin again. The helper accepts only `health`, `sync`, `read`, `pending`, and `resolve`. Requests cannot select shell commands, CLI paths, workspaces, API paths, recipients, or credentials. Local configuration pins those choices. The helper verifies the CLI user open_id on every operation and before every write; the extension pins its cached collection's application/account identity.

只允许精确扩展来源和五种固定操作；请求不能指定命令、路径、工作目录或接收人。配置固定账号、应用、表格和会话，操作与写入前校验 CLI 用户身份，浏览器缓存也绑定应用与账号。

## Source map / 源码位置

| File | Responsibility / 职责 |
| --- | --- |
| `src/service-worker.js` | Capture, serialized changes, daily alarms / 收藏、串行变更、每日调度 |
| `src/lib/native-bridge.js` | Native transport / 本机通信 |
| `helper/native-host.js`, `helper/protocol.js` | Origin guard and bounded framing / 来源校验、分帧与大小限制 |
| `helper/config.js`, `helper/cli.js` | Private config and constrained CLI calls / 私有配置、限定 CLI 调用 |
| `src/lib/api-policy.js` | Configured table/chat and field restrictions / 表格、会话、字段限制 |
| `src/lib/bitable.js` | Field validation, pagination, captures, status / 字段、分页、收藏、状态 |
| `src/lib/notifications.js` | Daily selection, pending UUID, receipts / 每日选取、待确认请求、发送记录 |
| `helper/journal.js` | Private durable journal and process lock / 私有持久记录、进程锁 |
| `helper/install-native-host.js` | User-level host registration / 用户级注册 |

## Scheduling and synchronization / 调度与同步

The worker uses a calendar-time alarm for local 10:00, preserving wall-clock time across daylight-saving changes. Startup and a 15-minute alarm attempt same-day catch-up after 10:00; they do not replay older dates. Chrome/device availability and working CLI authorization are required. A first installation after 10:00 can trigger catch-up.

按设备本地时间 10 点调度，夏令时变化后仍使用当地 10 点。启动与每 15 分钟检查处理当天补发，不追发旧日期；首次安装已过 10 点也可能补发。浏览器、设备与 CLI 授权需有效。

Capture and manual sync upload new links and refresh existing data without sending. Existing record IDs take precedence over URLs; deleted bound records are not recreated. Existing Feishu fields are preserved. Only explicit `待阅读`/`阅读中` with safe public HTTP(S) URLs are eligible. Each message includes up to 20 items, oldest first; one item is enough and the final remainder is included. Feishu is re-read before every send, but edits can still race with delivery after that read.

收藏和手动同步不发消息。已有记录按记录 ID 关联，删除后不重建；现有字段以飞书为准。每条最多 20 条，从早到晚推送，余数也发送。每次发消息前重读飞书，读取之后的外部修改仍可能与发送交错。

The daily journal records completion, including an empty run. Additions after completion wait until tomorrow. Sending does not mark articles read, and unread items may be reminded again the next day. Status toggles write only `阅读状态`; Bitable changes reach Chrome at the next sync, not via a live subscription.

空批次也记录当天已完成，之后新增留到次日；提醒不标已读。状态按钮仅修改“阅读状态”，飞书变更在下一次同步读取。

## Delivery recovery

Before sending, save a pending request with its UUID, immutable message content, date, record IDs, and source links. After a confirmed `message_id`, save successful receipts and clear that pending request. The private journal is written using a temporary file, fsync, atomic rename, and directory fsync. One process lock covers the complete operation across Chrome profiles using the same helper directory. Dead locks are only reclaimed after a two-minute grace period; malformed locks/journals stop operations.

发送前持久保存 UUID、固定内容、日期、记录 ID 与链接；确认成功后写发送记录并清除待确认批次。通过临时文件、同步写盘和原子替换保存，进程锁串行执行整个操作。失效进程的锁保留至少两分钟；损坏文件停止处理。

Within the provider's one-hour UUID deduplication window, retry the original request unchanged. After the window, a different date, or changed links/status, automatic retries pause. See [Feishu's send API](https://open.feishu.cn/document/server-docs/im-v1/message/create).

在飞书一小时去重窗口内复用原 UUID；超时、跨日或状态/链接变化后暂停重试。

1. Check the target Feishu conversation and compare the pending batch's content/time. / 核对目标会话的内容和时间。
2. Open Settings. Confirm **Delivered** only if it arrived, or **Not delivered** only if you verified it did not. / 核实后选择已送达或未送达。
3. The next scheduled check continues with current Feishu data. Confirmation does not mark articles read or send immediately. / 下一次定时检查继续，确认不改阅读状态、不立即发送。

Do not delete all receipts to recover one request. A crash between a provider effect and local persistence can leave the outcome uncertain. Independent devices/helper directories have independent journals; configure one sender per target. Bitable record creation has no message UUID: exact URL matching recovers a visible previously created record, but uncertain creation or concurrent external writers can still produce duplicates. Inspect Feishu before retrying an uncertain create.

不要清空整个记录。外部操作与本地保存之间崩溃可能产生不确定结果；不同设备不共享记录。素材创建没有消息 UUID，按链接匹配可恢复已可见记录，但不保证在不确定创建或外部并发写入时绝不重复，重试前应检查飞书。

## Replacing the transport / 后续替换

Keep capture, field mapping, status, daily selection, and receipt semantics separate from transport. `callKnowledge(action, payload)` is the extension boundary; the helper composes the pure table/notification services. A future transport must preserve identity pinning, operation restrictions, private durable receipts, and uncertain-send recovery. Introducing another platform or credential architecture requires an explicit decision under [AGENTS.md](../AGENTS.md).

后续替换连接方式时保留字段、状态、每日推送和发送恢复语义；新增平台或凭证管理方式须先明确决策。
