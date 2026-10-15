# Architecture / 架构

NewsBridge has three boundaries: browser collection, a portable connection contract, and the user's existing authenticated Feishu / Google environment.

NewsBridge 分为浏览器收藏、可移植连接接口，以及用户已有的飞书 / Google 授权环境。

```text
Chrome: capture + local list + status controls
    │ authenticated HTTPS, exact operator-selected origin
    ▼
Existing tool/router → connector.dispatch(action, payload)
    │ verified adapter identity + fixed table/field restrictions
    ▼
Existing provider access → Feishu Bitable / Google Sheets
Optional Feishu messaging → configured chat

Existing scheduler → connector.daily()
Both dispatch and daily share durable state and an exclusive lock.
```

No provider, executable, service manager, OS path or personal domain is required by the core. The public extension starts without an endpoint; Settings saves a user-supplied HTTPS base URL and requests its optional host permission. A private build may optionally prefill a fixed endpoint. Client and handler retain the path prefix. Core source remains unchanged.

核心不依赖指定工具、服务管理器、系统路径或私人域名。公开包默认未配置连接，由设置页保存可带子路径的 baseUrl，并按用户点击申请具体主机可选权限；也可选用预填的私人固定地址包，请求与处理器保留路径前缀，不修改公开源码。

- `src/`: browser capture, local cache, status controls and connection client.
- `connector/`: verified adapter calls, portable dispatch, optional Fetch handler and daily reminder entry point; no listener or scheduler is started.
- `src/lib/bitable.js`: field validation, pagination, safe record creation and normalized snapshots.
- `src/lib/notifications.js`: unread selection, persistent pending requests and receipts, same-day completion.
- `scripts/build-extension.mjs`: allowlisted extension assets and ZIP generation, with no OS packaging utility.
- `examples/adapter.js`: runnable Feishu custom-app adapter.
- `examples/google-adapter.js`: Sheets API compatibility adapter, service-account OAuth, eight-column schema and metadata-based row identity.
- `examples/host.js`: fixed profile routing and shared persistence.
- `examples/serve.mjs`: optional, explicitly started loopback listener behind an existing HTTPS proxy.

The selected table owns existing notes and status. The browser uploads captures, not arbitrary API commands. A local linked status changes only after a successful remote update. Identity includes the verified connection and table, so switching either cannot silently transfer a collection.

所选表格保有已有记录的笔记和状态。浏览器上传收藏而非任意 API 指令；关联状态在远端写入成功后更新。身份同时限定连接和表格，避免静默转移资料库。

## Delivery recovery

The host supplies private durable storage and locking. A scheduled send first persists its UUID, content, record IDs and links. Confirmed delivery writes receipts separately from reading status. A lost response leaves the exact request pending. After its retry window or a content/status change, verify the chat before resolving **Delivered** or **Not delivered** in Settings. Never erase the journal to force a resend.

宿主提供私有持久化存储和锁。先保存请求再发送，送达记录与阅读状态分开。不确定结果保留原请求；超过窗口或内容/状态改变后先核实会话，再确认结果，不清空记录强制重发。

See [the contract](CONNECTION.md) for request/response details and [security boundaries](../SECURITY.md) for host responsibilities.


Settings can disconnect and re-associate with a configured provider. Local linked data is archived by verified identity and restored only for that identity; no remote deletes or server authorization changes occur. The Google adapter translates the current restricted Feishu-shaped internal operations rather than making the entire data core storage-agnostic. General provider support still requires an adapter implementing the documented normalization and security restrictions.

设置页可取消关联并重新连接已配置类型，本机关联数据按验证身份归档与恢复，不删除远端内容或改变服务端授权。Google 适配器翻译现有受限的内部飞书形态操作；数据核心尚未变成通用任意存储接口，其他平台仍须实现规定的归一化与权限限制。

Daily jobs poll using persisted custom time/timezone, language and enable/disable preferences (10:00 Asia/Shanghai default). Both providers can use optional Feishu chat delivery with a separately verified messaging app. See [self-hosting](SELF-HOSTING.md) / [中文自建部署](SELF-HOSTING.zh-CN.md).

每日任务按持久化的自定义时间、时区、语言与开关轮询，默认 10:00 Asia/Shanghai。两种表格均可通过另行验证的飞书应用发送可选会话提醒。
