# Security / 安全边界

The public extension has no preconfigured endpoint and no required host permissions. It declares optional HTTPS hosts so Settings can request only the user-selected host from a click. CSP permits HTTPS connections; client validation and granted host permissions restrict normal service requests to the saved, normalized endpoint. Until the user configures and grants a host, captures stay local. Chrome host permissions do not isolate subdirectories; requests and server handlers enforce the full application base path.

公开扩展不预置连接地址、不要求安装时授予域名权限。HTTPS 主机声明为可选，由用户在设置页点击检查／保存，按具体主机授权。CSP 允许 HTTPS 连接，客户端校验与已授予主机权限限制服务请求到本机保存的完整地址；未配置和授权时仅本机收藏。Chrome 权限不隔离子目录，客户端及服务端仍校验完整路径。安装包不包含私人配置、凭证、连接端代码或测试。

## Extension / 扩展

Captures contain page titles and links, not page bodies or video data. The extension uses activeTab, storage, contextMenus and alarms. It does not inspect desktop login state, browser cookies or other sites in the background. Its CSP disables remote scripts and restricts outbound connections. No content script or externally callable message API is registered.

仅收藏标题和链接，不抓取正文或视频，不读取桌面登录或 Cookie。无内容注入脚本和供外部网页调用的消息接口，CSP 限制脚本与连接来源。

Local storage contains captures, snapshots, language, pinned connection identity and, in connected mode, an automatically generated browser signing identity. It is restricted to trusted extension contexts, but is not an OS secret vault. Protect the browser profile. Network requests omit cookies, reject redirects, bound JSON sizes and verify protocol identity. Account/table changes and malformed snapshots stop sync without replacing the local collection. Raw external error strings are not shown.

本地保存收藏、缓存、语言、身份及自动生成的浏览器签名身份，仅可信扩展上下文可用，但不等同系统密钥库。网络请求不带 Cookie、不跟随重定向，校验大小、协议和身份；异常时保留本地资料，不显示外部原始错误。

## Connection / 连接端

The portable module verifies adapter identity and limits operations to the configured Feishu / Google table, eight creation fields, reading-status updates and optional conversation. The browser cannot select credentials, API paths, commands, delivery dates or arbitrary recipients. The Fetch handler authenticates requests independently of CORS and allows only the configured extension origin when an Origin header is present.

模块限制账号、表格、字段和会话。浏览器不能指定凭证、任意 API、命令、发送日期或其他接收者。Fetch 处理器独立于 CORS 执行鉴权，并校验扩展来源。

The existing host must implement secure credential storage/renewal, verified adapter identity, approved browser public keys, signature verification, replay protection and revocation, TLS, request timeouts, rate limits, durable atomic state and a shared lock. The module does not provision these facilities or prove that a third-party tool supplies them. An adapter is trusted integration code; it must not execute captured text as instructions.

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

One approved browser identity can authorize both preconfigured profiles for a trusted user. It is not multi-tenant isolation. Browser identity pinning prevents switching with an old cache; disconnect archives locally, clears the active association and does not revoke the server pairing, remove remote content or pause server reminders. Chrome archives retain the same privacy boundary and quota limits as other extension storage. The optional listener is manually started on loopback and must stay behind a TLS proxy; do not expose its internal port.

一个已确认浏览器身份可访问该用户预先配置的两种表格，不是多租户隔离。取消关联归档本机资料并清除当前关联，不撤销服务端配对、不删除远端内容、不暂停服务端提醒。归档仍受 Chrome 本地存储隐私边界与配额限制。可选服务入口手动启动并只监听回环，须置于 TLS 代理后，不公开内部端口。


## Editable connection address / 可编辑连接地址

Check/Save requests the exact selected HTTPS origin from a user gesture; the optional https://*/* declaration does not grant all-sites access. Credentials and captures are sent only after the client checks permission. HTTP, private/local literal hosts, wildcard input, credentials in URLs and ambiguous paths remain rejected. Change an associated endpoint only after disconnecting: active local association reset and archive update happen together, and the old optional host grant is removed where possible. Pairing identities are scoped to the full endpoint, including its path; a new endpoint requires its own pairing approval. Archives include endpoint plus verified account/table identity, preventing a new server claiming the same identity from receiving an old archive automatically.

检查／保存从用户点击中申请具体 HTTPS 主机权限；可选声明不是全站授权。发送签名请求与收藏前校验主机授权，仍拒绝 HTTP、本机／私有地址字面量、通配符、带凭证或路径歧义的地址。换关联地址前先取消关联，原子清除当前关联并归档，尽可能撤销旧可选域名授权。配对绑定完整地址及子路径，新地址须独立确认配对；归档同时绑定地址和账号／表格身份，避免新服务器仅凭声称相同身份获得旧资料库。


See [browser pairing](docs/PAIRING.md) for the first approval, signature format, clock window, durable replay journal and revocation. The reference host does not accept Bearer keys; the lower-level injectable handler retains that separate compatibility mode for existing integrations. 浏览器只提交公钥等待确认，服务端不自动信任扩展 ID；参考服务不接受 Bearer 密钥，底层可注入处理器保留独立兼容模式供既有集成使用。
