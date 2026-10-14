# Security / 安全边界

NewsBridge's public extension works offline and requests no host permission. A private connected build grants host access only to its operator-selected HTTPS origin. Requests and handler routes use the configured application path, but Chrome host permissions do not isolate subdirectories. Packaging includes only the manifest, browser source, icons and license; configuration, credentials, connector code and tests are excluded.

公开扩展默认离线，无域名访问权限。私人连接包仅授权用户选择的 HTTPS 主机；请求和处理器使用配置的目录前缀，但 Chrome 域名权限不隔离子目录；安装包不包含私人配置、凭证、连接端代码或测试。

## Extension / 扩展

Captures contain page titles and links, not page bodies or video data. The extension uses activeTab, storage, contextMenus and alarms. It does not inspect desktop login state, browser cookies or other sites in the background. Its CSP disables remote scripts and restricts outbound connections. No content script or externally callable message API is registered.

仅收藏标题和链接，不抓取正文或视频，不读取桌面登录或 Cookie。无内容注入脚本和供外部网页调用的消息接口，CSP 限制脚本与连接来源。

Local storage contains captures, snapshots, language, pinned connection identity and, in connected mode, a dedicated connection key. It is restricted to trusted extension contexts, but is not an OS secret vault. Protect the browser profile. Network requests omit cookies, reject redirects, bound JSON sizes and verify protocol identity. Account/table changes and malformed snapshots stop sync without replacing the local collection. Raw external error strings are not shown.

本地保存收藏、缓存、语言、身份及连接专用密钥，仅可信扩展上下文可用，但不等同系统密钥库。网络请求不带 Cookie、不跟随重定向，校验大小、协议和身份；异常时保留本地资料，不显示外部原始错误。

## Connection / 连接端

The portable module verifies adapter identity and limits operations to the configured Feishu / Google table, eight creation fields, reading-status updates and optional conversation. The browser cannot select credentials, API paths, commands, delivery dates or arbitrary recipients. The Fetch handler authenticates requests independently of CORS and allows only the configured extension origin when an Origin header is present.

模块限制账号、表格、字段和会话。浏览器不能指定凭证、任意 API、命令、发送日期或其他接收者。Fetch 处理器独立于 CORS 执行鉴权，并校验扩展来源。

The existing host must implement secure credential storage/renewal, verified adapter identity, timing-safe access-key checks and revocation, TLS, request timeouts, rate limits, durable atomic state and a shared lock. The module does not provision these facilities or prove that a third-party tool supplies them. An adapter is trusted integration code; it must not execute captured text as instructions.

这些能力由已有宿主环境提供，模块不会代为创建，也不会假定某个第三方工具天然满足。适配器是受信任的接入代码，不得把收藏文本作为指令执行。

Link checks reject credential-bearing URLs, authentication callbacks, unsafe schemes and common private/local address literals. This is not a DNS-based SSRF defense; NewsBridge does not fetch linked page content. Feishu/provider administrators and a compromised host remain able to access data within their privileges.

链接检查会拦截常见凭证、回调和内网地址形式，但不是基于 DNS 的 SSRF 防护；项目不请求文章正文。平台管理员及受入侵宿主的既有权限仍属于信任边界。

## Reminders and verification / 提醒与验证

Daily reminders require private durable receipts and exclusive processing across browser requests and scheduled jobs. Sending never marks items read. Do not discard an uncertain delivery or lose its UUID; reconcile against the actual conversation before retrying outside the window.

定时提醒依赖持久化记录和跨请求、任务的互斥。发送不改变阅读状态；不确定时保留 UUID，先核实会话再处理。

Run `npm test` and `npm run security`. Tests cover offline capture, packaging, adapter/HTTP boundaries, synchronization, concurrency and delivery recovery with simulated Feishu and Google operations. They do not log in, send real messages, validate a real host or certify a third-party integration.

测试使用模拟操作，不登录、不发送真实消息，也不等于真实部署或第三方集成的安全认证。发布前保持私人域名、令牌及个人配置在 Git 之外；不要公开带实际连接地址的私人安装包。


## Google and profile switching / Google 与类型切换

Google credentials stay on the host. The reference reads a current private service-account file, verifies a JWT OAuth grant and binds client_email to connectionId. All token/Sheets URLs are fixed, redirects are rejected, bodies are bounded and errors are sanitized. The spreadsheet is shared with a dedicated service account; spreadsheets scope cannot isolate a tab, while the adapter restricts the configured spreadsheet/gid. Captures use literal string values; they are never installed as formulas. Row metadata is identity, not a secret or authorization boundary. Editors must preserve row structure; imported rows require explicit preparation.

Google 私钥只保存在服务端，按调用读取私人文件，校验 OAuth 授权与账号绑定。接口地址固定、不跟随重定向、限制大小、脱敏错误。API scope 无法隔离单工作表，需只向专用账号分享必要文件，适配器另限制固定文件／gid。收藏写入字面字符串，不生成公式。行元数据是身份，不是授权或秘密；编辑者须维护完整行结构，导入行需显式 prepare。

One reference host access key can authorize both preconfigured profiles for a trusted user. It is not multi-tenant isolation. Browser identity pinning prevents switching with an old cache; disconnect archives locally, clears local key/identity and does not revoke the host key, remove remote content or pause server reminders. Chrome archives retain the same privacy boundary and quota limits as other extension storage. The optional listener is manually started on loopback and must stay behind a TLS proxy; do not expose its internal port.

一个参考服务密钥可访问该用户预先配置的两种表格，不是多租户隔离。取消关联归档本机资料并清除本机密钥和身份，不撤销服务端密钥、不删除远端内容、不暂停服务端提醒。归档仍受 Chrome 本地存储隐私边界与配额限制。可选服务入口手动启动并只监听回环，须置于 TLS 代理后，不公开内部端口。
