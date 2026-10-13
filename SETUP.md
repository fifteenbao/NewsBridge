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

After your existing tool implements the contract, build for its exact HTTPS origin:

已有工具实现接口后，为其唯一 HTTPS 地址打包：

```sh
npm run build -- --origin https://connection.example.com
```

Replace the placeholder privately. Load `dist/newsbridge-connected/`. Only that exact origin is granted access; public source stays unchanged. The private ZIP is `dist/newsbridge-connected.zip` and must not be published. The script overwrites only its generated output. A ZIP is unzipped before loading; it is not a Web Store installation.

私下替换示例域名，加载 `dist/newsbridge-connected/`。只授权该域名，公开源码保持不变。带真实域名的 ZIP 不应公开。脚本只覆盖生成目录；ZIP 需解压再加载，不是商店安装。

Give the resulting 32-character extension ID to the existing connection's origin validator. In Settings enter its dedicated access key, choose **Save settings**, then **Check connection** and **Sync reading library**. The key is an opaque 32–512 character base64url credential issued by the host environment; do not reuse a Feishu access token. Changes to the endpoint require re-entering the key. Changing identity/table requires a separate Chrome profile to avoid mixing collections.

将生成的扩展 ID 填入连接端的来源校验。在 Settings 输入连接专用密钥，保存设置、检查连接并同步。密钥由宿主环境签发，使用 32–512 位 base64url 字符，不复用飞书令牌。更换地址后需重新填写密钥；换账号或表格时使用独立 Chrome 配置，避免混合资料库。

## 4. Verify and optionally schedule / 验证并按需设置提醒

Verify a capture appears once in Bitable, existing notes survive sync, read/unread changes work in both directions, and deleted records are not recreated. Use a disposable record for write checks. The connected tool owns Feishu authorization and renewal.

用临时测试素材验证收藏不重复、笔记不被覆盖、双向状态同步和删除后不重建。飞书授权及续期由已有连接工具负责。

For reminders, verify message access to the configured chat, durable receipt storage and a lock shared by all requests and scheduled jobs. Register `connector.daily()` in the existing scheduler at 10:00 in the configured timezone, then set `remindersEnabled: true`. Calling it after 10:00 may send a real message; do not use it as a read-only connection check. If no scheduler is available, keep reminders disabled.

提醒需验证会话发送权限、持久化发送记录，以及所有请求与定时任务共用的锁。在已有调度器注册每天 10 点的 `connector.daily()`，再开启 remindersEnabled。10 点后调用可能真实发消息，不可用于只读检查；没有调度器就保持关闭。

If a send is uncertain, inspect the conversation and resolve it in Settings. Do not erase receipts to force a retry. Back up private state using your existing environment's tools.

发送不确定时先核实会话，再在设置中确认，不清空记录强行重试。使用已有环境的工具备份私有状态。
