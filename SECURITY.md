# Security / 安全

NewsBridge uses an on-demand Native Messaging helper and an authorized local lark-cli. It does not run a local network server or require a hosted login service. This removes a listening endpoint; it does not make a local device or its authorized software inherently trustworthy.

NewsBridge 使用按需启动的本机桥接程序和已授权 CLI，不开放本地监听端口，也不需要托管登录服务。这减少了一个网络入口，但不能保证设备或已授权软件绝对安全。

## Data and credentials / 数据与凭证

- Chrome stores captures, language preferences, collection identity, and table snapshots. / Chrome 保存收藏、语言偏好、资料库身份和表格缓存。
- lark-cli manages credentials under its own local policy. NewsBridge does not request or store App Secrets or access/refresh tokens. / 凭证由 CLI 管理，不写入扩展或桥接配置。
- `helper/knowledge.config.json` contains pinned identifiers and local paths; `helper/notification-state.json` contains private delivery metadata and pending message content. Both are excluded from Git and must be regular files owned by the current user with no group/other access (`600`). Final-component symlinks are rejected. / 配置和发送记录均为私有文件，记录可能包含待发送内容。
- Captured titles/links are written to the configured table. Selected titles, links, summaries, categories, and notes are sent to the configured conversation, visible to its participants. / 启用同步与消息后，数据进入相应表格和会话。

NewsBridge has no analytics. The [official CLI's security notice](https://github.com/larksuite/cli#security--risk-warnings-read-before-use) states that its default API risk-control signals include OS type and device hardware model. That behavior belongs to lark-cli; NewsBridge does not disable its protections. Feishu processes authentication and API data under its policies.

本项目没有统计追踪；官方 CLI 默认随 API 请求发送操作系统类型和设备硬件型号作为风控信号。项目不会关闭该防护。飞书按自身政策处理认证和业务数据。

## Enforced controls / 已实施防护

| Boundary / 边界 | Control / 防护 |
| --- | --- |
| Browser access / 浏览器访问 | No `host_permissions`, content scripts, external messaging, or page injection; extension connections blocked by CSP / 无域名权限、内容脚本或网页注入 |
| Native caller / 本机调用来源 | One exact registered extension origin, checked again by the host / 注册与程序双重来源检查 |
| Browser mutations / 浏览器变更 | Only the extension's own top-level Settings page; bounded requests; background serialization / 限定自身设置页，校验大小并串行执行 |
| Operations / 操作 | Fixed five native actions; no arbitrary CLI/shell/API dispatch / 五种操作，无任意命令入口 |
| API writes / API 写入 | Configured table/chat only; creates restricted to eight reading fields; updates only 阅读状态 / 限定表格、会话、字段 |
| Identity / 身份 | Pinned app/user collection identity; CLI open_id checked on each call and before writes / 绑定身份并校验 |
| Process execution / 进程执行 | Fixed absolute executable/workspace, `shell: false`, 60-second CLI timeout, 2 MiB CLI output cap; article data on stdin / 固定路径、禁用 shell、限制时间与输出、正文走标准输入 |
| Native protocol / 通信 | 20 MiB aggregate limit, ordered output chunks below Chrome's per-frame ceiling, strict UTF-8/JSON / 大小、顺序与格式检查 |
| Delivery / 发送 | Persist pending UUID before send; confirm message ID; durable private journal; cross-process lock / 发送前记录请求、确认后记成功、私有持久记录与进程锁 |
| Content / 内容 | Render as text; reject unsafe schemes, credentials/auth query parameters, local/private literal addresses / 安全文本渲染和危险链接拦截 |
| Errors / 错误 | Generic safe messages; no raw CLI/provider output in logs or protocol errors / 不输出原始错误载荷 |

## Limits / 局限

Native Messaging grants access to an installed local program. The host and CLI run with the user's OS rights. Keep the repository, launcher, registration, CLI executable and workspace under your control; another program running as the same OS user can modify them or impersonate process arguments. There is no sandbox or cryptographic isolation from that user. Account checks reduce accidental switching but are not atomic with a separate CLI configuration change.

桥接程序和 CLI 使用当前系统用户的权限。相同系统用户下的其他程序可能修改源码、注册或工作目录，也能伪造进程参数；本方案不是对该用户的隔离沙箱。账号校验能减少误切换，但不能与并发 CLI 配置变更构成原子操作。

No ports are opened by NewsBridge. Other applications and CLI versions may have their own network behavior. This project is configured for Feishu; API-region selection follows the CLI's authorized application/workspace and is not a promise of tested support for every Lark region.

本项目不打开端口；其他程序或不同 CLI 版本可能有自己的网络行为。当前配置面向飞书，不代表所有 Lark 地区已验证。

Public-link filtering does not resolve DNS, detect every credential format, or validate publisher claims. Bitable records and notes may contain sensitive text: anything selected for reminders is sent to the configured chat. NewsBridge does not fetch article bodies or execute their content.

链接过滤不解析 DNS、无法识别全部凭证格式，也不判断内容真伪。笔记可能含敏感文字，参与提醒时会进入目标会话；扩展不抓正文、不执行文章内容。

A fresh read is not a transaction with Feishu. Independent senders can duplicate reminders; ambiguous record creation can duplicate table entries. UUID deduplication is time-limited; expired/changed pending messages require manual verification. Preserve journals and backups. Chrome alarms can be delayed; no cloud or OS scheduler guarantees delivery while Chrome/device is unavailable.

重读飞书不等于事务，不同发送端可能重复提醒，创建结果不确定时也可能出现重复记录。去重窗口有限，超时或变化需人工核实。浏览器/设备不可用时不保证准时送达。

## Checks and reporting / 检查与报告

```sh
npm test
npm run security
```

The security script checks repository credential patterns, private-file paths, browser permissions, and unsafe code sinks; it is not a comprehensive audit. Test scope and live-validation limits are recorded in [the review report](docs/SECURITY-AUDIT.md).

扫描不等于完整安全审计。测试范围与实际验证限制见检查报告。

Do not post tokens, private configs/journals, or full provider responses in public issues. Describe a suspected vulnerability with sanitized reproduction steps and use private contact details if the repository owner supplies them. No dedicated disclosure mailbox is currently listed.

公开反馈请脱敏，不提交凭证、私有配置、发送记录或完整响应。如仓库维护者提供私密联系方式，请优先私下报告漏洞；当前未列专用邮箱。
