# Browser pairing / 浏览器配对

NewsBridge does not ask users to enter a connection access key. The browser generates its own P-256 signing identity; the host stores only the public key after explicit operator approval. An extension ID restricts the intended browser origin, but is public and is not an authentication secret.

NewsBridge 不需要手填连接访问密钥。浏览器自动生成 P-256 签名身份，服务端经管理员确认后只保存公钥。扩展 ID 用于限定来源，公开 ID 本身不是认证凭证。

## First connection / 首次连接

1. Initialize the private server state and configure provider credentials/table access as in the self-hosting guide. Copy the actual Chrome extension ID into top-level extensionId of the service's private/host.json, then restart the handler.
2. In extension Settings enter the HTTPS connection service address and table link. Click **Pair and check** and grant that exact host's Chrome permission. The page displays a pairing fingerprint and approval command.
3. On the service machine, inspect requests with `node examples/run.mjs pair-list private/host.json`. Compare the **complete fingerprint and extension ID** with your own extension page. Do not approve an arbitrary pending request just because its ID matches.
4. After comparing, run the command shown in the extension page, for example:

```sh
node examples/run.mjs pair-approve private/host.json --pair-id YOUR_PAIR_REQUEST_ID --fingerprint YOUR_64_HEX_FINGERPRINT
```

5. Click **Pair and check** again. Once approved, health verifies identity/table access. Save settings, then sync. Subsequent requests sign automatically; no secret needs to be copied into Chrome.

中文步骤：先初始化服务状态和平台授权，将 Chrome 的真实扩展 ID 填入服务端最外层 extensionId 并重启。在插件填写 HTTPS 地址、选择类型及表格链接，点击“配对并检查”，授权该主机。服务端执行 pair-list，核对**当前插件页面的完整指纹和扩展 ID**，再运行页面给出的 pair-approve 命令。不要只看公开 ID 就确认陌生请求。确认后再点一次“配对并检查”，保存设置即可同步，日后自动签名，无需复制秘密到插件。

## Reject and revoke / 拒绝与撤销

```sh
node examples/run.mjs pair-reject private/host.json --pair-id YOUR_PAIR_REQUEST_ID
node examples/run.mjs pair-revoke private/host.json --pair-id YOUR_APPROVED_PAIR_ID
```

Unapproved requests expire after ten minutes; the queue holds at most three pending and sixteen approved devices. An expired request needs a new Check and approval. Revoked devices cannot send authenticated requests. Disconnect only clears the active local association, archives captures and removes the saved optional host permission; it retains the browser's per-endpoint pairing identity for reconnecting. To revoke access, use pair-revoke on the server. Reinstalling/removing the extension or changing Chrome profiles may require a new pairing. Changing server address/path also requires pairing that endpoint.

未确认请求十分钟后过期，最多保留三条待确认、十六个已确认设备。过期后重新检查并确认。服务端撤销后旧设备无法发送有效请求。“取消关联”只清除当前本机关联、归档收藏并移除已保存主机的可选权限，保留该端点的本机配对身份以便重连；彻底撤权需在服务端执行 pair-revoke。卸载、换 Chrome 配置或换地址／子路径可能需要重新配对。

## Security and hosting / 安全与服务配置

Each signed request binds the method, full URL/path, timestamp, random nonce and SHA-256 body digest. The host verifies the approved public key, a ±60-second clock window and a durable replay journal before dispatching. Keep client/server clocks accurate. Modified bodies/URLs, missing approval, replay and revoked keys are rejected. HTTP state and scheduled jobs still share the same private store and lock. Back up approved keys and delivery receipts together; do not clear state to bypass pairing or pending messages.

请求签名绑定方法、完整 URL、时间戳、随机 nonce 及正文摘要；服务端校验确认过的公钥、正负一分钟时间窗口及持久化防重放记录后才执行。请校准两端时间。修改正文或地址、未确认、重放或已撤销的请求会被拒绝。HTTP 服务与任务仍共用私人状态及锁，备份时保留配对与发送记录，不清空状态绕过认证或待确认消息。

The browser private signing key is automatically stored in trusted extension-local storage. Protect the Chrome profile: this storage is not an OS secret vault. Provider App Secrets and Google credentials remain on the host and never enter the extension. New reference-host initialization does not require or create access.key. Generic lower-level transport fixtures may still exercise Bearer authentication; the reference host uses approved signatures and does not accept Bearer keys.

浏览器签名私钥自动保存在可信扩展上下文的本机存储中，应保护 Chrome 配置文件；它不是系统密码保险箱。飞书 App Secret、Google 凭证仍只在服务端。参考服务初始化不再需要或创建 access.key；底层通用传输测试仍覆盖 Bearer 兼容接口，但参考服务只接受已确认设备的签名，不接受 Bearer 密钥。

The proxy must pass Origin, Content-Type and the four X-NewsBridge-* headers unchanged. For Nginx add:

```nginx
proxy_set_header X-NewsBridge-Pair $http_x_newsbridge_pair;
proxy_set_header X-NewsBridge-Time $http_x_newsbridge_time;
proxy_set_header X-NewsBridge-Nonce $http_x_newsbridge_nonce;
proxy_set_header X-NewsBridge-Signature $http_x_newsbridge_signature;
```

Do not log bodies or signing headers. Pairing requests are public-key-only and cannot read or write tables until approved. Exact extension-origin filtering and HTTPS remain required. Pairing does not deploy a host, configure provider access or install a reminder scheduler.

代理需原样传递 Origin、Content-Type 与上述四个签名头，不记录请求正文或签名头。未确认配对只提交公钥，不能读取或写入表格；精确来源限制和 HTTPS 仍保留。配对不代替部署、平台授权或提醒调度配置。
