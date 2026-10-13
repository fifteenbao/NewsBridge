# Architecture / 架构

NewsBridge has three boundaries: browser collection, a portable connection contract, and the user's existing authenticated Feishu environment.

NewsBridge 分为浏览器收藏、可移植连接接口，以及用户已有的飞书授权环境。

```text
Chrome: capture + local list + status controls
    │ authenticated HTTPS, exact operator-selected origin
    ▼
Existing tool/router → connector.dispatch(action, payload)
    │ verified adapter identity + fixed table/field restrictions
    ▼
Existing Feishu access → Bitable and optional chat messages

Existing scheduler → connector.daily()
Both dispatch and daily share durable state and an exclusive lock.
```

No provider, executable, service manager, OS path or personal domain is required by the core. The public extension is offline; a private build supplies an HTTPS base URL (optionally with an application path) and derives host permissions/CSP from its origin. Client and handler retain the path prefix. Core source remains unchanged.

核心不依赖指定工具、服务管理器、系统路径或私人域名。公开包默认离线，私人构建记录可带子路径的 baseUrl，并从 origin 生成域名权限和 CSP，请求与处理器保留路径前缀，不修改公开源码。

- `src/`: browser capture, local cache, status controls and connection client.
- `connector/`: verified adapter calls, portable dispatch, optional Fetch handler and daily reminder entry point; no listener or scheduler is started.
- `src/lib/bitable.js`: field validation, pagination, safe record creation and normalized snapshots.
- `src/lib/notifications.js`: unread selection, persistent pending requests and receipts, same-day completion.
- `scripts/build-extension.mjs`: allowlisted extension assets and ZIP generation, with no OS packaging utility.
- `examples/adapter.js`: binding template for an existing authorized environment.

Feishu owns existing notes and status. The browser uploads captures, not arbitrary API commands. A local linked status changes only after a successful remote update. Identity includes the verified connection and table, so switching either cannot silently transfer a collection.

飞书保有已有记录的笔记和状态。浏览器上传收藏而非任意 API 指令；关联状态在远端写入成功后更新。身份同时限定连接和表格，避免静默转移资料库。

## Delivery recovery

The host supplies private durable storage and locking. A scheduled send first persists its UUID, content, record IDs and links. Confirmed delivery writes receipts separately from reading status. A lost response leaves the exact request pending. After its retry window or a content/status change, verify the chat before resolving **Delivered** or **Not delivered** in Settings. Never erase the journal to force a resend.

宿主提供私有持久化存储和锁。先保存请求再发送，送达记录与阅读状态分开。不确定结果保留原请求；超过窗口或内容/状态改变后先核实会话，再确认结果，不清空记录强制重发。

See [the contract](CONNECTION.md) for request/response details and [security boundaries](../SECURITY.md) for host responsibilities.
