# Setup / 配置指南

[English](README.md) | [中文](README.zh-CN.md)

## 1. Install locally / 本地安装

Run `npm run build` with Node.js 22+ and load `dist/newsbridge/` at `chrome://extensions` → Developer mode → Load unpacked. Alternatively unzip the generated `dist/newsbridge.zip`. The source root is also loadable. Keep the chosen directory at a stable path. Chrome 106+ is required; no runtime service is needed for local capture.

使用 Node.js 22+ 执行 `npm run build`，在 Chrome 扩展管理页开启开发者模式，加载 `dist/newsbridge/`；也可以解压生成的 ZIP 或直接加载源码根目录。保持加载目录不变。要求 Chrome 106+，本地收藏无需后台服务。

## 2. Inspect the existing environment / 检查现有环境

Ask your agent to follow [AGENT-SETUP.md](docs/AGENT-SETUP.md). It must verify authenticated identity, Bitable field/record reads, record creation, status updates, and an available HTTPS endpoint implementing [the contract](docs/CONNECTION.md). Chat-only access is insufficient. Missing capabilities must be reported; they do not authorize installing new infrastructure.

让 Agent 按上述说明检查已有连接的账号、表格读取、新建记录、状态更新能力，以及能否提供规定的 HTTPS 接口。仅能聊天发消息不够；缺少能力时明确报告，不擅自部署新基础设施。

Import the [table template](templates/Daily-Briefing-飞书阅读模板.xlsx) and check the [eight fields](KNOWLEDGE-SETUP.md). Keep configuration outside Git, for example `private/connection.config.json`, based on [config.example.json](connector/config.example.json). Its connectionId is the stable identity verified by the adapter, not an arbitrary label. IDs and credentials stay private.

导入模板并核对八个字段。以配置示例为基础，在 Git 忽略的 `private/connection.config.json` 中填写参数。connectionId 必须对应适配器实际验证的稳定身份，不能只是随意起的名称。账号、表格 ID 与凭证只在本地配置。

```sh
npm run doctor -- --config private/connection.config.json
```

Doctor checks local format only; it does not log in, contact Feishu, test an adapter, or verify a scheduler.

Doctor 仅检查本地格式，不登录、不访问飞书，也不验证适配器和调度是否可用。

## 3. Prepare a private connected build / 生成私人连接包

After your existing tool implements the contract, build for its HTTPS base URL, including an optional application path:

已有工具实现接口后，为其 HTTPS 连接地址打包，可包含应用子路径：

```sh
npm run build -- --base-url https://connection.example.com/newsbridge/
```

Replace the placeholder privately. Load `dist/newsbridge-connected/`. Host permissions use the exact origin; requests use the configured base path; public source stays unchanged. The private ZIP is `dist/newsbridge-connected.zip` and must not be published. The script overwrites only its generated output. A ZIP is unzipped before loading; it is not a Web Store installation.

私下替换示例域名，加载 `dist/newsbridge-connected/`。仅申请该主机的域名权限，请求使用配置的目录前缀，公开源码保持不变。带真实域名的 ZIP 不应公开。脚本只覆盖生成目录；ZIP 需解压再加载，不是商店安装。

To keep the real address out of commands and public source, put `{"baseUrl":"https://connection.example.com/newsbridge/"}` (with your actual private address) in Git-ignored `private/endpoint.json`, then build from that file:

也可以把真实连接地址保存在 Git 忽略的 `private/endpoint.json`，文件格式为上述 baseUrl 对象；无需将实际地址写进命令或公开源码：

```sh
npm run build -- --config private/endpoint.json
```

Configure the same `baseUrl` in the existing connection handler and preserve the path prefix in routing. Chrome host permissions do not isolate subdirectories; see [the routing and security explanation](docs/CONNECTION.md#base-url-and-origin--连接地址与-origin).

连接端使用相同 baseUrl，路由保留目录前缀。Chrome 域名权限不能按子目录隔离，详见接口文档的路径与安全说明。

Give the resulting 32-character extension ID to the existing connection's origin validator. In Settings enter its dedicated access key, choose **Save settings**, then **Check connection** and **Sync reading library**. The key is an opaque 32–512 character base64url credential issued by the host environment; do not reuse a Feishu access token. Changes to the endpoint require re-entering the key. Changing identity/table requires a separate Chrome profile to avoid mixing collections.

将生成的扩展 ID 填入连接端的来源校验。在 Settings 输入连接专用密钥，保存设置、检查连接并同步。密钥由宿主环境签发，使用 32–512 位 base64url 字符，不复用飞书令牌。更换地址后需重新填写密钥；换账号或表格时使用独立 Chrome 配置，避免混合资料库。

## 4. Verify and optionally schedule / 验证并按需设置提醒

Verify a capture appears once in Bitable, existing notes survive sync, read/unread changes work in both directions, and deleted records are not recreated. Use a disposable record for write checks. The connected tool owns Feishu authorization and renewal.

用临时测试素材验证收藏不重复、笔记不被覆盖、双向状态同步和删除后不重建。飞书授权及续期由已有连接工具负责。

For reminders, verify message access to the configured chat, durable receipt storage and a lock shared by all requests and scheduled jobs. Register `connector.daily()` in the existing scheduler at 10:00 in the configured timezone, then set `remindersEnabled: true`. Calling it after 10:00 may send a real message; do not use it as a read-only connection check. If no scheduler is available, keep reminders disabled.

提醒需验证会话发送权限、持久化发送记录，以及所有请求与定时任务共用的锁。在已有调度器注册每天 10 点的 `connector.daily()`，再开启 remindersEnabled。10 点后调用可能真实发消息，不可用于只读检查；没有调度器就保持关闭。

If a send is uncertain, inspect the conversation and resolve it in Settings. Do not erase receipts to force a retry. Back up private state using your existing environment's tools.

发送不确定时先核实会话，再在设置中确认，不清空记录强行重试。使用已有环境的工具备份私有状态。

## Runnable reference and startup order / 可运行参考与启动顺序

These optional examples use Node 22+ and a POSIX local filesystem. They do not deploy anything or start a listener. The custom-app adapter is one supported reference route, not a dependency imposed on other agents/tools. It uses [Feishu's custom-app tenant token API](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal). Have an authorized app, table read/write scopes and table access ready; message delivery additionally needs bot/message permissions and target-chat membership.

参考实现需要 Node 22+、POSIX 本机文件系统，不会部署或启动监听服务。自建应用只是可运行的参考方式，不限制其他工具实现协议。准备已授权应用、表格读写权限及目标表格访问权；提醒另需机器人发消息权限与目标会话成员资格。

1. Copy `examples/host.example.json` to Git-ignored `private/host.json`. Set baseUrl (your HTTPS base path), connector baseToken/articleTableId and `connectionId: "app:<your app ID>"`. Keep reminders disabled. stateDir is resolved **relative to this config file**, so `./state` means `private/state`. Keep that directory and its parents under a trusted OS account; never put it on a shared network filesystem or inside the publicly served directory.
2. Run `node examples/run.mjs init private/host.json`. This explicitly creates a 0700 state directory, 0600 state.json and random 0600 access.key. Re-running preserves existing state/key; invalid existing data fails. Do not regenerate or delete receipts during ordinary restarts.
3. Supply FEISHU_APP_ID and FEISHU_APP_SECRET through the host's existing secret mechanism. Do not paste secrets into commands, source or Chrome. `getCredentials()` reads at call time, after environment setup, and may be replaced with your secret manager callback. Module-level `const token = process.env...` captures the old value if imports run before configuration, and also misses rotation. It is not inherently invalid with environment populated before process startup, but this reference deliberately avoids that ordering dependency. No automatic dotenv loader is included.
4. Run `node examples/run.mjs check private/host.json`. This verifies current app identity and all eight field types, without sending or writing table records. Run `node examples/run.mjs pending private/host.json` for a safe pending-state check. Diagnose failures by stage/code/reference. `npm run doctor` remains an offline format check.
5. In your **existing HTTPS host**, call `createHost(await loadHostConfig(path))` from `examples/host.js` and mount its handleRequest. Preserve the configured external URL and prefix. The host still owns TLS, timeouts and admission limits; these examples supply no standalone web server. An empty extensionId permits startup and authenticated non-browser checks while blocking Chrome access.
6. Build with `npm run build -- --config private/host.json`, extract the connected ZIP and load its folder at chrome://extensions. Copy Chrome's real ID into private/host.json and restart/recreate the host handler. Recheck the ID if Chrome reports access denied; do not replace it with a wildcard.
7. The extension opens Settings on first installation; otherwise right-click its icon → Settings. Paste the direct Feishu table URL and securely copy the **connection access.key**, not App Secret/Feishu token. Save/check verifies the pasted target matches the service's authorized table before saving connected preferences. The offline package saves the link locally but cannot connect using a table link alone. Then sync and verify a permitted test capture and read-status update.
8. Only if reminders are requested, configure chatId and the existing 10:00 scheduler, then enable remindersEnabled. The explicit command `node examples/run.mjs daily private/host.json` **can send messages**. It is not a health check. All browser and scheduler processes must use the same stateDir and exclusive lock.

中文顺序：①复制私人配置并设置 HTTPS 地址、应用身份和表格 ID；stateDir 相对于配置文件。②运行 init 创建状态文件和专用 access.key。③通过现有密钥管理注入环境，适配器在调用时读取，避免模块导入早于环境加载。④运行 check 预检，pending 排查待确认发送。⑤将参考宿主挂载到已有 HTTPS 环境，extensionId 可暂留空但此时 Chrome 被拒绝。⑥打包、安装扩展、填真实 ID 并重启处理器。⑦设置页粘贴多维表格直接链接与连接专用密钥，保存校验、再同步。⑧有需要才启用定时提醒；daily 会真实发送，不能用于健康检查。

### Persistence and shared lock / 持久化与共享锁

[examples/file-state.js](examples/file-state.js) provides exclusive file creation for cross-process locking on a **single host/local filesystem**, private files, isolated JSON loads, fsync + atomic rename + directory fsync on save, and timing-safe access-key checks. Missing state is an error until explicit init. Lock contention fails with LOCK_BUSY rather than running concurrently. Crashed owners leave state.lock: **stop every process using this stateDir and confirm no external operation remains active before manually removing it**. Never steal a lock just because it is old; pending-message reconciliation must survive recovery. Unexpected temporary files may remain after a crash; preserve state and inspect before cleanup. Back up state.json with the owning processes stopped or under the same lock.

参考锁仅适用于单机本地文件系统；多机、网络盘或无共享磁盘实例必须换成对应环境的共享事务/锁。锁冲突返回 LOCK_BUSY，不自动超时抢锁。进程崩溃后，停止所有相关进程并确认外部操作已结束，才能手动移除 state.lock；不能按文件年龄抢锁，更不能清空发送状态。文件保存使用同步落盘、原子替换和目录同步；备份也须停机或持同一把锁。不要在持锁函数内递归调用 connector。

These examples are exercised with mocked Feishu responses and real child-process lock tests. They are not evidence of a live deployment or app permission grant. The reference adapter exchanges credentials per call for clarity; production adapters may cache tokens with identity-scoped expiration and refresh, keeping credentials entirely on the host.

验证覆盖飞书模拟响应与真实子进程锁冲突，未连接真实账号验证。参考适配器每次换取凭证，生产实现可按身份安全缓存及刷新；飞书凭证始终留在连接端。
