# Setup / 配置指南

[English](README.md) | [中文](README.zh-CN.md)

**Self-hosting Feishu / Google:** [English deployment guide](docs/SELF-HOSTING.md) · [中文自建部署指南](docs/SELF-HOSTING.zh-CN.md). V0.3.0 supports provider selection, disconnect/reassociation and custom daily time/timezone.

**飞书 / Google 自建服务：** 详见上述双语部署指南。V0.3.0 支持类型选择、取消关联再切换，以及自定义每日时间与时区。

## 1. Install locally / 本地安装

Run `npm run build` with Node.js 22+ and load `dist/newsbridge/` at `chrome://extensions` → Developer mode → Load unpacked. Alternatively unzip the generated `dist/newsbridge.zip`. The source root is also loadable. Keep the chosen directory at a stable path. Chrome 106+ is required; no runtime service is needed for local capture.

使用 Node.js 22+ 执行 `npm run build`，在 Chrome 扩展管理页开启开发者模式，加载 `dist/newsbridge/`；也可以解压生成的 ZIP 或直接加载源码根目录。保持加载目录不变。要求 Chrome 106+，本地收藏无需后台服务。

### Keep the installation path and extension ID / 固定安装目录与扩展 ID

For the exact ID copy/paste location and restart steps, see [English](docs/SELF-HOSTING.md#fill-in-the-chrome-extension-id) / [中文](docs/SELF-HOSTING.zh-CN.md#填写-chrome-扩展-id). The ID goes in top-level extensionId in the service’s private/host.json. Configure the service address once; switching tables on that service requires no ZIP download.

扩展 ID 填在连接服务设备 private/host.json 的最外层 extensionId；复制、填写及重启步骤见上述链接。同一服务地址只需配置一次，切换表格不必重复下载压缩包。localhost 指 Chrome 所在电脑，当前 V0.3.0 尚不支持本机 HTTP 模式。

**Unpacked extension IDs can change when the folder path changes.** This public manifest has no fixed key. Keep the same installation folder and Chrome profile; replace files there and click Reload for updates. A fixed folder helps preserve the ID, but is not a promise across computers/profiles. After moving or re-extracting elsewhere, copy the actual ID from chrome://extensions (also shown in the settings footer), update the connection's private extensionId allowlist, and recreate/restart its handler. Otherwise the handler returns **403 ORIGIN_DENIED**. Pairing cannot fix an incorrect extensionId whitelist. [Chrome documents the key mechanism for maintaining an ID](https://developer.chrome.com/docs/extensions/reference/manifest/key).

**未固定 key 的已解压扩展，换解压目录可能改变扩展 ID。** 更新时在同一 Chrome 配置中覆盖固定安装目录，再点击“重新加载”。这不能保证跨设备或跨 Chrome 配置的 ID 一致。移动目录或解压到新位置后，请从 chrome://extensions（或设置页页脚）复制实际 ID，更新连接端私人配置的 extensionId 白名单，并重建/重启处理器。否则会报 **403 ORIGIN_DENIED**；重新配对不能解决来源白名单不匹配。不要把白名单改成通配符。

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

## 3. Configure the endpoint in Chrome / 在插件内填写连接地址

Install the public extension (source folder or `npm run build` → `dist/newsbridge/`). In Settings enter **Connection service address**, the HTTPS base URL provided by your existing host, including its application path. For example use https://connection.example.com/newsbridge/ with placeholders replaced privately. You do not need to edit CONNECTION_BASE_URL, download a different ZIP or rebuild for each server address.

安装公开扩展（源码目录或 npm run build 生成的 dist/newsbridge/）。在设置页填写**连接服务地址**，使用自己的 HTTPS baseUrl，可包含子目录。无需修改 CONNECTION_BASE_URL，也不用为每个地址重新下载或打包。实际地址保存在当前 Chrome 配置的扩展本地存储，不进入公开源码或安装包。

Click Check connection or Save settings to request access to that exact HTTPS host. The manifest declares HTTPS hosts as optional so a user can choose their server; no such host is granted at installation. The client verifies the selected host permission before sending credentials or captures. Rejecting permission keeps local capture available. Chrome host permissions do not isolate application subdirectories; the client and host handler still require the exact configured base path.

点击检查或保存时，Chrome 仅申请所填 HTTPS 主机的访问权限；安装时不授予所有网站权限。权限拒绝则不发起连接，仍可本地收藏。域名权限不隔离子目录，但客户端及服务端仍校验完整 baseUrl 和路径。不支持 HTTP 或 localhost 模式。

Copy the actual ID from chrome://extensions into top-level extensionId in the service's private/host.json and restart its handler. See the exact steps in the [deployment guide](docs/SELF-HOSTING.md#fill-in-the-chrome-extension-id). Enter the table link, request pairing, confirm its fingerprint on the server, check again, save and sync. See [pairing instructions](docs/PAIRING.md). Saving an address does not itself deploy a server or configure provider credentials.

从 chrome://extensions 复制实际扩展 ID，填入**服务端** private/host.json 最外层 extensionId，并重启处理器，具体步骤见[中文部署指南](docs/SELF-HOSTING.zh-CN.md#填写-chrome-扩展-id)。再填写表格链接、发起配对，按[配对指南](docs/PAIRING.md)在服务端核对指纹确认，再检查、保存、同步。填写地址不会自动部署服务或授权飞书／Google。

Before changing an associated address/provider/account, disconnect in Settings. This archives linked captures by endpoint and verified table identity, clears the active association and attempts to revoke the old optional host permission. Pair the browser with the new endpoint; its old pairing is never transferred automatically. Disconnect does not revoke provider credentials or stop server reminders. A prefilled private build remains optional for operators who want a fixed domain; its required host permission cannot be removed at runtime, and another domain requires the configurable public build.

更换已关联的地址、类型或账号前先取消关联。按地址及账号／表格身份归档，清除当前关联并尝试撤销旧的可选主机权限；新地址需独立配对，不转移原配对认证。取消关联不撤销飞书／Google 凭证、不停止服务端提醒。可选私人预填包仍可用于固定域名，但其安装时必需域名权限不能运行时撤销；换域名需使用公开可配置包。

## 4. Verify and optionally schedule / 验证并按需设置提醒

Verify a capture appears once in Bitable, existing notes survive sync, read/unread changes work in both directions, and deleted records are not recreated. Use a disposable record for write checks. The connected tool owns Feishu authorization and renewal.

用临时测试素材验证收藏不重复、笔记不被覆盖、双向状态同步和删除后不重建。飞书授权及续期由已有连接工具负责。

For reminders, verify message access to the configured chat, durable receipt storage and a lock shared by all requests and scheduled jobs. Poll `connector.daily()` every minute/few minutes with the existing scheduler; it waits for the daily time/timezone saved in Settings (10:00 Asia/Shanghai by default), then set `remindersEnabled: true`. Calling it after the configured time may send a real message; do not use it as a read-only connection check. If no scheduler is available, keep reminders disabled.

提醒需验证会话发送权限、持久化发送记录，以及所有请求与定时任务共用的锁。在已有调度器每分钟或每几分钟检查 `connector.daily()`，按设置页保存的每日时间／时区判断（默认 10:00 Asia/Shanghai），再开启 remindersEnabled。到达配置时间后调用可能真实发消息，不可用于只读检查；没有调度器就保持关闭。

If a send is uncertain, inspect the conversation and resolve it in Settings. Do not erase receipts to force a retry. Back up private state using your existing environment's tools.

发送不确定时先核实会话，再在设置中确认，不清空记录强行重试。使用已有环境的工具备份私有状态。

## Runnable reference and startup order / 可运行参考与启动顺序

These optional examples use Node 22+ and a POSIX local filesystem. Imports do not deploy or start a listener. The separate opt-in examples/serve.mjs entry is documented in the self-hosting guide. The custom-app adapter is one supported reference route, not a dependency imposed on other agents/tools. It uses [Feishu's custom-app tenant token API](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal). Have an authorized app, table read/write scopes and table access ready; message delivery additionally needs bot/message permissions and target-chat membership.

参考实现需要 Node 22+、POSIX 本机文件系统，不会部署或启动监听服务。自建应用只是可运行的参考方式，不限制其他工具实现协议。准备已授权应用、表格读写权限及目标表格访问权；提醒另需机器人发消息权限与目标会话成员资格。

1. Copy `examples/host.example.json` to Git-ignored `private/host.json`. Set baseUrl (your HTTPS base path), connector baseToken/articleTableId and `connectionId: "app:<your app ID>"`. Keep reminders disabled. stateDir is resolved **relative to this config file**, so `./state` means `private/state`. Keep that directory and its parents under a trusted OS account; never put it on a shared network filesystem or inside the publicly served directory.
2. Run `node examples/run.mjs init private/host.json`. This explicitly creates a 0700 state directory and 0600 state.json. The reference host uses browser pairing, not access.key. Re-running preserves existing state; invalid existing data fails. Do not regenerate or delete receipts during ordinary restarts.
3. Supply FEISHU_APP_ID and FEISHU_APP_SECRET through the host's existing secret mechanism. Do not paste secrets into commands, source or Chrome. `getCredentials()` reads at call time, after environment setup, and may be replaced with your secret manager callback. Module-level `const token = process.env...` captures the old value if imports run before configuration, and also misses rotation. It is not inherently invalid with environment populated before process startup, but this reference deliberately avoids that ordering dependency. Use `--env private/host.env` on the reference CLI to explicitly load a file, or provide the environment before starting the process. No file is implicitly discovered; existing process environment values take precedence.
4. Run `node examples/run.mjs check private/host.json`. This verifies current app identity and all eight field types, without sending or writing table records. Run `node examples/run.mjs pending private/host.json` for a safe pending-state check. Diagnose failures by stage/code/reference. `npm run doctor` remains an offline format check.
5. In your **existing HTTPS host**, call `createHost(await loadHostConfig(path))` from `examples/host.js` and mount its handleRequest. Preserve the configured external URL and prefix. The host still owns TLS, timeouts and admission limits; these examples supply no standalone web server. An empty extensionId permits startup and authenticated non-browser checks while blocking Chrome access.
6. Build with `npm run build -- --config private/host.json`, extract the connected ZIP and load its folder at chrome://extensions. Copy Chrome's real ID into private/host.json and restart/recreate the host handler. Recheck the ID if Chrome reports access denied; do not replace it with a wildcard.
7. The extension opens Settings on first installation; otherwise right-click its icon → Settings. Enter the HTTPS service address and table link. Click Pair and check, confirm the fingerprint once on the service machine using the [pairing guide](docs/PAIRING.md), check again and save. Status shows the approved pairing; a table link alone cannot authenticate. Then sync and verify a permitted test capture and read-status update.
8. Only if reminders are requested, configure chatId and the existing scheduler polling the custom daily time, then enable remindersEnabled. The explicit command `node examples/run.mjs daily private/host.json` **can send messages**. It is not a health check. All browser and scheduler processes must use the same stateDir and exclusive lock.

中文顺序：①复制私人配置并设置 HTTPS 地址、应用身份和表格 ID；stateDir 相对于配置文件。②运行 init 创建私人状态文件。③通过现有密钥管理注入环境，适配器在调用时读取，避免模块导入早于环境加载。④运行 check 预检，pending 排查待确认发送。⑤将参考宿主挂载到已有 HTTPS 环境，extensionId 可暂留空但此时 Chrome 被拒绝。⑥打包、安装扩展、填真实 ID 并重启处理器。⑦设置页填写地址和表格链接，发起配对、在服务端核对指纹确认，再检查、保存和同步。⑧有需要才启用定时提醒；daily 会真实发送，不能用于健康检查。

### Persistence and shared lock / 持久化与共享锁

[examples/file-state.js](examples/file-state.js) provides exclusive file creation for cross-process locking on a **single host/local filesystem**, private files, isolated JSON loads, fsync + atomic rename + directory fsync on save, and durable pairing and replay protection. Missing state is an error until explicit init. Lock contention fails with LOCK_BUSY rather than running concurrently. Crashed owners leave state.lock: **stop every process using this stateDir and confirm no external operation remains active before manually removing it**. Never steal a lock just because it is old; pending-message reconciliation must survive recovery. Unexpected temporary files may remain after a crash; preserve state and inspect before cleanup. Back up state.json with the owning processes stopped or under the same lock.

参考锁仅适用于单机本地文件系统；多机、网络盘或无共享磁盘实例必须换成对应环境的共享事务/锁。锁冲突返回 LOCK_BUSY，不自动超时抢锁。进程崩溃后，停止所有相关进程并确认外部操作已结束，才能手动移除 state.lock；不能按文件年龄抢锁，更不能清空发送状态。文件保存使用同步落盘、原子替换和目录同步；备份也须停机或持同一把锁。不要在持锁函数内递归调用 connector。

These examples are exercised with mocked Feishu responses and real child-process lock tests. They are not evidence of a live deployment or app permission grant. The reference adapter exchanges credentials per call for clarity; production adapters may cache tokens with identity-scoped expiration and refresh, keeping credentials entirely on the host.

验证覆盖飞书模拟响应与真实子进程锁冲突，未连接真实账号验证。参考适配器每次换取凭证，生产实现可按身份安全缓存及刷新；飞书凭证始终留在连接端。

## Required identity / 必须匹配的应用身份

**For `examples/adapter.js`, connectionId MUST equal `app:<FEISHU_APP_ID>`**, including the `app:` prefix. Example: `FEISHU_APP_ID=cli_example` requires `connectionId: "app:cli_example"`. This rule belongs to the reference custom-app adapter; other adapters use their own verified stable identity. An arbitrary label, a user ID, or the app ID without its prefix fails identity verification. AUTH_VERIFY means check both credentials and this binding, not just table permissions.

**参考适配器的 connectionId 必须写为 `app:<飞书应用 App ID>`**。前缀不可省略，不能用昵称或用户 ID。其他适配器按自己的真实身份验证规则实现。AUTH_VERIFY 时先核对应用凭证与身份绑定，再排查表格权限。

## Environment and private files / 环境与私人文件

Use `private/` for your host config, environment file, state and approved pairing identities. It is ignored by this repository's `.gitignore`; this only prevents ordinary Git tracking, **not OS access or files already tracked by Git**. Do not force-add it, publish it, serve it through HTTPS, or include it in a release. Example builds package only extension assets, and skip hidden filesystem metadata. Use the host's existing secret manager where available.

private/ 用于本地配置、环境文件、状态与密钥，已被 Git 忽略，但 Git 忽略不能替代操作系统权限，也不会自动撤回已经跟踪的文件。不要强制提交或通过网站提供访问；已有密钥管理可直接替代环境文件。

```sh
mkdir -p private
chmod 700 private
cp examples/host.example.json private/host.json
chmod 600 private/host.json
# Create private/host.env in your editor or secret manager, then restrict it:
chmod 600 private/host.env
node examples/run.mjs init private/host.json
node examples/run.mjs audit private/host.json
node examples/run.mjs check private/host.json --env private/host.env
```

Do not overwrite an existing private/host.json with the copy command. The environment file uses `FEISHU_APP_ID=...` and `FEISHU_APP_SECRET=...`; fill actual values privately. `--env` paths are relative to the current working directory; stateDir is relative to host.json. Environment loading happens before credential callbacks run. Files are not loaded unless explicitly named. Check the file path/load error before treating missing credentials as a permissions issue.

已有 host.json 时跳过复制命令。环境文件使用上述两个变量，真实值仅在私人文件填写。--env 路径相对于当前工作目录，stateDir 相对于 host.json；两者不要混淆。凭证在调用时读取，环境文件加载失败会单独提示，不归为飞书权限错误。

| Path / 路径 | Requirement / 要求 |
| --- | --- |
| private/ and stateDir | Owned by the current service uid; 0700 recommended; no group/other access. stateDir cannot be a symlink. / 当前服务用户所有，无组或其他用户权限，不使用目录软链接 |
| state.json | Regular files, current uid, 0600 recommended (no group/other bits), nlink=1, no symlink. / 普通文件、同一 uid、单硬链接、无软链接 |
| host.json and host.env | Keep 0600 under private/; never publish. / 私人配置不发布 |
| state.lock | Held across all instances/jobs using this state; never steal based on age. / 所有相关进程共用同一锁，不按年龄抢锁 |

`audit` checks the current state directory and files, ownership, link count, state format and pairing state under the same exclusive lock. A symlinked ancestor, ACLs, backups and network-filesystem guarantees remain the operator's responsibility. init does not reset or silently chmod existing files. Use the correct owning account to fix permissions; do not recursively chmod unrelated files. A missing/unreadable environment file gets an environment error; an unapproved browser gets PAIR_REQUIRED.

audit 只检查配置指定的状态目录和文件，不宣称审计整台设备。目录上层软链接、ACL、备份与共享文件系统由环境管理方检查。init 不自动重置或放宽现有权限；应由正确账户修复指定文件，不要递归修改无关目录。

## Empty tables and optional write test / 空表与显式写入自检

**An empty table is supported; no seed record is required.** It still needs all eight correctly typed fields. Empty record responses with omitted items and explicit empty metadata normalize to an empty article list. Incomplete nonempty/paginated responses remain errors, so they cannot silently erase a local snapshot.

**无需先建一条记录，零记录表可直接同步。** 八个字段仍须完整。代码兼容飞书省略 items 的空结果；真正缺失分页数据时继续报错，不把不完整结果当空表。

After the read-only check passes, explicitly test the configured table's URL/text write encoding and permissions:

```sh
node examples/run.mjs check private/host.json --env private/host.env --write
```

This creates **one** marked `NewsBridge self-test <UUID>` record, sets it read, reads back its title/link/content/note/status, and deletes that same new record. It never sends a chat message. It requires create/read/delete rights and holds the shared lock. A private `state.json.probe` journal is saved before creation. If creation times out, the process crashes, or deletion cannot be confirmed, further probes stop with a cleanup error. Inspect the journal's marker/base/recordId and the table, remove only the matching test record if present, then clear only the probe journal under the same lock with all users of that state stopped. Never clear reading receipts or delete unrelated records. When readback fails but cleanup succeeds, the command still reports a failed test.

--write 会真实创建一条带 UUID 的已读测试记录，读回字段并删除同一条记录，不发消息。它需要删除权限，且全程持共享锁。创建前写私人 probe 日志；超时、崩溃或删除不确定时禁止再次测试。请对照标记、表格和记录 ID 只清理对应测试记录，然后停用相关进程、持锁清除 probe 项；不得清空阅读/发送记录。普通 Check connection、check 和 audit 都不会写飞书记录。

## Settings feedback / 设置页反馈

The page shows browser pairing status and its fingerprint; no access-key input remains. HTTP 401 means pairing/signature is missing, revoked or invalid; 403 means the extension origin is not registered. Compare the browser fingerprint before service-side approval. See [pairing](docs/PAIRING.md).

Table feedback progresses through format validation, matching server configuration, and verified read/schema access. It never claims write permission from a read-only request. Parsed table ID fields are not displayed; Check connection / Retry retries it. Sync stays disabled until approved pairing, a saved endpoint, a successful check and a matching table are available. The footer displays the configured baseUrl, extension version and negotiated protocol version.

The **Daily unread reminders** switch saves a real server-side preference. The host must first enable reminder capability after configuring its existing scheduler, chat and permissions. Users can then pause/resume it without recreating the host; daily() checks the saved preference on every run. The switch cannot provision a scheduler or send immediately; an in-flight run holds the shared lock and finishes before a preference change takes effect. The header language changes the interface immediately; Save settings applies the same language to reminders. There is no separate reminder-language selector.

页面显示配对状态与指纹，首次须由服务端确认；401 与 403 分别提示配对认证和扩展来源问题。表格反馈区分格式、配置匹配和读取/字段权限；不把读取成功当作写入成功。自动解析的 Base/Spreadsheet 与 Table/gid ID 不显示为输入项；未连接时同步按钮置灰；页脚显示地址、扩展和协议版本。提醒开关保存到服务端，可暂停/恢复已有调度器的发送；不能创建调度器或立即发送，已经持锁执行的任务先完成再应用变更。仅保留页眉语言选择：界面立即切换，保存后同步到提醒语言。

## Interface language and parsed identifiers / 界面语言与 ID 解析

Interface language initially follows Chrome (English or Simplified Chinese) and can be changed in Settings. The choice is stored only in the current Chrome profile, takes effect immediately and makes no connection request. Save settings persists the header language as the reminder preference as well. Labels, hints, button text and known diagnostic messages use the chosen interface language; diagnostic codes, request references and provider codes remain intact for troubleshooting.

界面语言首次按 Chrome 的语言选择英文或简体中文，可在设置中立即切换，单独保存在本机；切换即时更新界面，点击保存后将相同语言同步到提醒偏好。已知错误提示会翻译，诊断编号、步骤及平台数字码保留以便排查。

A direct Bitable link with table= fills both IDs immediately. A base-only share link fills Base token and matches the same base’s configured Table ID after connection verification. A wiki share link resolves on the connection during its check. Identifiers stay internal; the page shows match/access feedback rather than separate identifier inputs. Invalid links stop validation; a mismatch with the server keeps sync disabled. The chat_id is shown only in the reading-reminders section and comes from the host configuration. There is no chat ID in a Bitable link. For sync without reminders use chatId empty and remindersEnabled false; no conversation is required.

含 table= 的直接链接即时解析两个 ID；只有 /base/ 的分享链接在检查连接后匹配同一多维表格下已配置的数据表；/wiki/ 分享链接由连接端在检查连接时解析。解析成功不等于获得权限，无效链接会清空旧值，与连接端不匹配时仍禁止同步。会话 ID 只显示在阅读提醒区，由连接端配置返回，表格链接不包含此 ID。只同步时 chatId 留空、remindersEnabled 关闭即可。



### Feishu share links / 飞书分享链接

Ordinary “copy link” URLs with `from=from_copylink` are supported. Nonessential copy/view parameters are removed before storage or resolution. When table= is absent, NewsBridge uses **the configured Table ID in the same base**, not an arbitrary first table. If you intend a different data table, include its table= value and explicitly configure a separate authorized collection.

知识库和多维表格的普通复制链接均可输入，from=from_copylink 等复制/视图参数会移除。未包含 table= 时使用同一多维表格下连接端已配置的目标数据表，不随机选第一张表；若实际想使用其他数据表，请带上 table= 并配置独立的已授权资料库。

Wiki links require the optional `adapter.resolveWikiNode(nodeToken)` and current credentials with node read access. The reference adapter calls [Get Wiki node information](https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/get_node) through the fixed Feishu API endpoint, with the node token as a query parameter. It verifies obj_type=bitable and uses obj_token as the base, then checks the configured base/table. Permission failures retain the numeric provider code and health.wiki.resolve stage. Non-Bitable nodes and mismatched targets stop without saving preferences or uploading records. Update the connection runtime/adapter along with the extension to support this interface.

知识库链接需连接适配器提供只读节点解析，并获得该节点读取权限。参考适配器仅调用固定的飞书节点查询接口；确认对象类型为 bitable，再以真实 obj_token 核对授权目标。缺少读取权限、节点不是多维表格或目标不匹配时会明确报错，不保存新偏好、不上传记录。此能力需同时更新插件与连接端运行模块/适配器；只有插件更新无法增加连接端的解析能力。

## Create the eight-field table / 一键创建八字段表

The optional operator command uses the reference custom-app credential environment (no required CLI/provider). Prepare private/host.json and its credentials first; the output directory must be private (0700) and owned by the current account. To create a **new Bitable and reading table**, run:

```sh
node scripts/create-table.mjs private/host.json --env private/host.env --new-base --output private/new-host.json
```

To create a new reading table inside the configured existing base, omit --new-base. The command creates a table with exactly 标题、链接、内容、类别、阅读状态、推荐指数、笔记、时间, predefines 待阅读/阅读中/已读/跳过 and 待分类 options, verifies the field schema, and runs sync with zero captures against the newly created zero-record table. **It inserts no seed record.** It needs the corresponding app/base/table creation and read permissions; those are separate from ordinary record synchronization permissions. API permission failures include numeric codes and setup.app.create/setup.table.create stages.

一键脚本使用参考自建应用的现有凭证，不依赖特定 CLI 或托管平台。--new-base 新建多维表格及八字段阅读表；不加该参数则在配置指定的现有多维表格中创建新数据表。脚本设置三种基础阅读状态及阅读中状态，验证字段和零记录同步，不写入种子记录；需要相应创建和读取权限，缺少权限会显示平台数字错误码。

The script never overwrites the input or an existing output config. It writes a new 0600 host config with a separate stateDir and reminders disabled, plus a private .progress.json journal before external effects. After success it prints init and check --write commands. Initialize the generated config, then mount it in your chosen existing environment and disconnect the current collection in Settings before associating this new collection. If new Bitable creation adds a default table, the script leaves it intact. Share/access membership for a bot-owned base must be configured through your existing permission workflow; the command does not automatically grant other users access.

输入配置和已有输出文件不会被覆盖，新配置使用独立状态目录并默认关闭提醒。脚本在外部操作前记录私人进度，成功后打印初始化及写入自检命令。将新配置初始化后接入已有环境，关联新资料库前在设置页取消当前关联。飞书自动创建的默认表不会被删除；应用拥有的新表需按既有授权流程向用户开放，脚本不自动修改协作者。

On timeout/failure, inspect the output's .progress.json and the actual Bitable before retrying: table/base creation is not automatically retried or rolled back. If a create result was lost, locate the requested name before deciding to retry. Do not delete unrelated tables. Only a successful live run proves an empty table works with the actual app permissions; repository tests mock Feishu. For a temporary verification, use --new-base, complete the read-only empty check and optional explicit write probe, then remove only that temporary base/table in Feishu after checking its identity. No live table has been created by the assistant.

超时或失败时，先对照私人进度日志与飞书实际结果，不自动重试或回滚创建操作。只有在真实已授权环境运行成功，才算完成真实空表验证；仓库测试使用模拟响应。可用 --new-base 创建临时空表，检查通过后按需运行显式写入自检，再核对 ID 并仅删除这张临时表。助手没有执行真实建表或删除。

The explicit empty normalization is in src/lib/bitable.js: omitted items with total=0 or has_more=false normalize to []. This is followed by the same schema, pagination and snapshot checks as a populated table; an incomplete nonempty response remains an error.

空表分支位于 src/lib/bitable.js：省略 items 但明确 total=0 或 has_more=false 的结果归一化为 []；字段及分页校验照常执行，不把不完整的非空响应当空表。

## Navigation, capture and skip / 导航、收藏与跳过

Clicking the icon opens Save this page plus Home / Collection / Settings. Settings is a separate #settings view; without a successful configured connection, the default options view is Settings. Explicit navigation to local collection/home remains available. Header navigation and interface language are shared across views. The Collection shows only unread, undeleted entries. Choose Read or Skip to remove an item from the unread list; Skip persists 阅读状态=跳过 and excludes reminders, preserving the record. A failed remote update preserves the local state. To restore a linked read/skipped item, set 阅读状态 to 待阅读 in Feishu and sync. Offline statuses remain locally stored and are uploaded when a connection is configured.

点击图标打开“收藏当前页”和“首页 / 收藏 / 设置”菜单。设置是独立的 #settings 视图，未配置成功时默认进入该页，仍可主动导航到本机收藏或首页；页头共享导航与语言选择。收藏仅显示未读且未删除的内容；已读或跳过后退出列表。跳过同步为飞书阅读状态“跳过”，不删除记录、不进入提醒；远端失败时保留原本机状态。关联内容可在飞书改回“待阅读”再同步恢复显示；离线状态保存在本机，连接配置后上传。
