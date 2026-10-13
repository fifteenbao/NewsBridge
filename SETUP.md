# NewsBridge server setup / 服务器配置

[English overview](README.md#getting-started) | [中文概览](README.zh-CN.md#开始使用)

当前版本需要连接服务：Chrome 通过 HTTPS 同步飞书多维表格；服务器保存飞书授权、执行每日提醒。只收藏时素材可暂存在 Chrome，但同步需要服务可用。以下步骤适用于阿里云轻量应用服务器 Ubuntu 24.04，也可用于同类 Ubuntu 主机。

The current version requires a connection service for Feishu synchronization. Chrome can capture locally while offline; the server owns Feishu authorization and optional daily reminders. These instructions target Ubuntu 24.04, including Aliyun Simple Application Server.

```text
Chrome → HTTPS :443 → Nginx → 127.0.0.1:8787 → lark-cli → Feishu
                                 ↑
                       systemd daily reminder job
```

`newsbridge.example.com` 是占位域名，不能直接使用。所有真实域名、IP、账号和配置只保存在私人部署副本中，不提交开源仓库。`deploy/private/` 已被 Git 忽略。服务器需要维护系统更新、CLI 授权和证书续期；本方案没有阿里云专用 SDK。

Replace the example domain in private deployment copies only. Real domains, IPs, IDs and credentials must stay out of the public repository. `deploy/private/` is Git-ignored. Operators maintain system updates, CLI authorization and certificate renewal; no Aliyun-specific SDK is required.

## 1. 配置文件 / Configuration files

| 文件 / File | 用途 / Purpose |
| --- | --- |
| [server.config.example.json](server/server.config.example.json) | 服务配置模板；填写下表参数 / Server template; fill in the parameters below |
| [newsbridge-http.conf](deploy/nginx/newsbridge-http.conf) | 首次申请证书时使用，仅开放验证路径 / HTTP certificate bootstrap only |
| [newsbridge.conf](deploy/nginx/newsbridge.conf) | HTTPS 入口、限流与反向代理 / HTTPS, rate limiting and reverse proxy |
| [newsbridge-api.service](deploy/systemd/newsbridge-api.service) | 后台同步服务 / Background API service |
| [newsbridge-daily.service](deploy/systemd/newsbridge-daily.service) | 未读提醒任务 / Unread reminder job |
| [newsbridge-daily.timer](deploy/systemd/newsbridge-daily.timer) | 定时检查 / Scheduled checks |

| JSON 参数 / Key | 填写内容 / Value |
| --- | --- |
| `publicOrigin` | 自己的 `https://域名`，不带末尾 `/` / Your exact HTTPS origin, no trailing slash |
| `extensionId` | Chrome 扩展管理页中的 32 位 ID / Actual 32-character extension ID |
| `apiTokenHash` | 初始化脚本自动生成，不手填密钥 / Generated hash; never paste a plaintext key here |
| `appId` | 已授权飞书应用 ID，`cli_...` / Authorized Feishu App ID |
| `accountId` | 该应用下登录用户的 `open_id`，`ou_...` / User's open_id for that app |
| `larkCliPath` | 服务器上 CLI 可执行文件的绝对路径 / Absolute executable path on the server |
| `cliWorkspace` | `/srv/newsbridge/private/cli-state`，CLI 授权工作目录 / Authorized CLI workspace |
| `baseToken` | 多维表格 `/base/` 后的标识，不是访问令牌 / Bitable base identifier, not an access token |
| `articleTableId` | 表格链接 `table=` 后的 `tbl...` / Table identifier |
| `chatId` | 已配置的飞书 `oc_...`，只同步则填 `""` / Existing chat ID; empty string for sync only |
| `stateDir` | `/srv/newsbridge/private/state`，保存发送记录 / Private receipt directory |
| `port` | `8787`，仅监听服务器回环地址 / Server loopback only |
| `timeZone` | `Asia/Shanghai`，每天当地时间 10 点 / Local 10:00 reminder timezone |
| `language` | `en` 或 `zh`，可在扩展设置中更改 / Message language; editable in extension Settings |

知识库链接的 wiki 节点 ID 不一定是底层 baseToken。App Secret 和飞书令牌由 CLI 管理，不填入此 JSON。导入 [阅读模板](templates/Daily-Briefing-飞书阅读模板.xlsx) 后，检查 [八个字段及选项](KNOWLEDGE-SETUP.md)。

A wiki node ID may differ from the underlying base token. Keep App Secrets and Feishu tokens in CLI-managed storage, not this JSON. Import the template and verify its eight fields and select options.

## 2. DNS、端口与依赖 / DNS, ports and prerequisites

在域名服务商处添加 A 记录指向服务器公网 IPv4。只有正确配置 IPv6 时才添加 AAAA 记录。服务器出站需能访问飞书 HTTPS API、软件源及证书服务。

Point an A record to the server's public IPv4; add AAAA only if IPv6 is configured. Allow outbound HTTPS for Feishu, software installation and certificates.

阿里云控制台防火墙和操作系统防火墙都需允许 443；80 用于证书验证与续期；SSH 端口仅向自己的管理 IP 开放。**不要向公网开放 8787**。已有防火墙时修改现有规则，避免中断 SSH。[阿里云网络安全说明](https://www.alibabacloud.com/help/en/simple-application-server/network-security01)。

Allow inbound 443 and certificate validation on 80 in both cloud and OS firewalls. Restrict SSH to your management IP. Keep 8787 closed publicly and preserve your SSH access when editing rules.

下文命令在服务器上执行，特别标注“本机”的除外。需要有 sudo 权限的管理账号。先按 [Node.js 官方下载说明](https://nodejs.org/en/download) 安装支持的 LTS 版本（本项目要求 Node.js 22+）及 npm，安装到服务用户可访问的位置；避免依赖管理员家目录下的 nvm。

Run commands on the server unless marked local. Use a sudo-capable administrator. Install a supported Node.js LTS release (22+) and npm in a service-accessible location using the official instructions; avoid an administrator's private nvm directory.

```sh
node --version
command -v node
npm --version
sudo apt update
sudo apt install nginx rsync ca-certificates snapd
```

服务模板使用 `/usr/local/bin/node`。若 `command -v node` 返回其他路径，修改两个 `.service` 中的 `ExecStart` 为实际绝对路径。不要仅依赖交互终端 PATH。

Both service files assume `/usr/local/bin/node`. Set their `ExecStart` to the actual absolute Node path if different.

## 3. 上传源码并建立服务用户 / Upload and service account

**本机**：在项目根目录执行，替换 SSH 用户与 IP。上传的是此 NewsBridge 源码，不是原作者未经修改的项目。以下上传排除私人配置；私人模板另行通过 SSH/SFTP 传输。

**Local computer:** from this repository, replace the SSH user/IP and upload this NewsBridge source. Private configuration is excluded; transfer personal templates separately over SSH/SFTP.

```sh
rsync -av --exclude='.git' --exclude='node_modules' --exclude='private' \
  --exclude='.env*' --exclude='.dev.vars*' --exclude='*.config.json' \
  --exclude='browser-token.txt' --exclude='notification-state*' \
  ./ YOUR_SSH_USER@YOUR_SERVER_IP:newsbridge-upload/
```

**服务器**：以下创建新的专用账号与目录；若已存在同名账号，先检查其用途。源码由 root 持有，服务用户只写自己的私有目录。

**Server:** create a dedicated account and directories. If the account already exists, verify its purpose first. Keep source root-owned and private data writable only by the service user.

```sh
sudo useradd --system --user-group --home-dir /srv/newsbridge/private --shell /usr/sbin/nologin newsbridge
sudo install -d -o root -g root -m 755 /srv/newsbridge /srv/newsbridge/app
sudo install -d -o newsbridge -g newsbridge -m 700 /srv/newsbridge/private
sudo install -d -o newsbridge -g newsbridge -m 700 /srv/newsbridge/private/cli-state /srv/newsbridge/private/state
sudo rsync -a --chown=root:root --chmod=D755,F644 ~/newsbridge-upload/ /srv/newsbridge/app/
```

## 4. 在服务账号下授权飞书 / Authorize Feishu as the service user

进入专用账号的终端，使用固定工作目录；安装与后续授权都在此环境完成。按 [官方 lark-cli 安装与授权说明](https://github.com/larksuite/cli) 操作，安装后遵循其 PATH 提示，再确认可执行文件路径。记录安装版本，升级后重新验证连接。

Open a shell as the service user, install and authorize the official CLI in the workspace below, follow its PATH instructions, and record the executable path and installed version. Recheck connectivity after upgrades.

```sh
sudo -u newsbridge -H /bin/bash
cd /srv/newsbridge/private/cli-state
npx @larksuite/cli@latest install
# Follow the installer's PATH instructions before continuing.
command -v lark-cli
lark-cli config init
lark-cli auth login --scope "bitable:app im:message im:message.send_as_user"
lark-cli auth status
lark-cli api GET /open-apis/authen/v1/user_info --as user --format json
exit
```

先在飞书应用中开通并发布所需用户权限。只同步时仅申请多维表格权限；启用提醒需具备用户身份发消息权限并能访问目标会话。如 CLI 提示额外的登录信息权限，按提示补充。授权流程中，在自己的浏览器打开 CLI 给出的验证链接；无需给服务器安装桌面浏览器。

Enable and publish the required user scopes in the Feishu app. Sync-only deployments need only Bitable access; reminders also require user message permissions and conversation access. Follow any additional login-information scope prompt. Open the CLI's verification link in your own browser.

将上面返回的 `open_id` 填入 `accountId`，应用 ID 填入 `appId`；不要公开包含账号信息的输出。授权必须在相同服务账号、HOME 和工作目录下可用。无桌面服务器上的 CLI 凭证存储还需通过第 7 步的真实连接检查；若依赖交互式密钥环解锁，先按 CLI 官方说明解决，不关闭其安全保护，也不要复制个人电脑的登录文件。

Pin the returned open_id and App ID. Do not publish account output. Credentials must work under the same user, HOME and workspace in a noninteractive service. Verify this in step 7; resolve any headless keyring requirement using official CLI guidance without disabling protections or copying desktop login files.

## 5. 生成私有配置 / Initialize private configuration

先在本机用于安装的项目副本中配置自己的域名，再加载扩展，取得真实扩展 ID。配置脚本会修改该副本的 `manifest.json` 与服务地址；不要把含真实域名的副本提交到公开仓库。

In a private installation copy on your computer, configure the actual HTTPS origin, then load the unpacked extension at `chrome://extensions` and note its ID. This changes the copy's manifest and service target; do not publish that configured copy.

```sh
node scripts/configure-server.mjs https://newsbridge.example.com
```

服务器上初始化配置，随机服务密钥仅写入权限为 `600` 的 `browser-token.txt`，JSON 内只保存它的 SHA-256。脚本不会覆盖已有配置，也不会向终端打印密钥。

On the server, initialization writes a random service key to a mode-600 file and only its SHA-256 hash to JSON. It refuses existing files and does not print the key.

```sh
sudo -u newsbridge -H /usr/local/bin/node /srv/newsbridge/app/server/init-config.js
sudo -u newsbridge -H nano /srv/newsbridge/private/server.config.json
```

已有私人模板时，**用下列命令替代上面的初始化命令，不要重复执行两次**：通过 SFTP 上传模板，再安装到私有目录。模板应包含全部配置字段；`apiTokenHash` 占位符会自动替换。

For an existing personal template, use this alternative initialization instead. Upload it with SFTP first; its hash placeholder is replaced automatically.

```sh
sudo install -o newsbridge -g newsbridge -m 600 ~/server.config.example.json /srv/newsbridge/private/config-template.json
sudo -u newsbridge -H /usr/local/bin/node /srv/newsbridge/app/server/init-config.js --template /srv/newsbridge/private/config-template.json
sudo -u newsbridge -H nano /srv/newsbridge/private/server.config.json
```

按第 1 节填写所有 ID、实际域名与 CLI 路径，保留自动生成的 `apiTokenHash`。先让 `chatId` 为空，验证同步后再设置提醒目标也可以。配置文件权限保持 `600`、所有者为 newsbridge；路径都使用绝对路径，不使用 `~`。

Complete all IDs, actual origin and CLI path, preserving the generated hash. You may leave chatId empty for initial sync verification. Keep the file owned by newsbridge with mode 600 and use absolute paths.

## 6. HTTPS 与 Nginx / HTTPS and Nginx

在服务器私有部署副本中，将两个 Nginx 模板里的示例域名全部替换为实际域名，包括证书路径和转发的 Host。下面命令假设这两个文件已准备在 `~/newsbridge-nginx/`。若同一域名已被现有服务使用，合并 `/v1/` 路由及对应安全配置，不覆盖已有站点；先检查是否有同名接口冲突。

Prepare both Nginx templates in `~/newsbridge-nginx/`, replacing every example domain, including certificate paths and forwarded Host. For an existing site, merge the API route and security directives rather than replacing it; check for `/v1/` conflicts first.

新站点先启用 HTTP 验证入口，证书签发后才启用 HTTPS 文件。采用 [Ubuntu 的 Certbot webroot 流程](https://ubuntu.com/server/docs/how-to/security/obtain-tls-certificates/)，保持 80 可用于续期。若已有 Certbot，沿用现有安装方式，不并行安装另一个版本。

For a new site, install the HTTP bootstrap before obtaining a certificate, then enable HTTPS. Use Certbot webroot validation and keep port 80 available for renewals. Reuse an existing Certbot installation instead of installing a second one.

```sh
sudo install -d -m 755 /var/www/letsencrypt
sudo install -m 644 ~/newsbridge-nginx/newsbridge-http.conf /etc/nginx/sites-available/newsbridge
sudo ln -s /etc/nginx/sites-available/newsbridge /etc/nginx/sites-enabled/newsbridge
sudo nginx -t
sudo systemctl reload nginx
sudo snap install --classic certbot
sudo /snap/bin/certbot certonly --webroot -w /var/www/letsencrypt -d newsbridge.example.com
sudo install -m 644 ~/newsbridge-nginx/newsbridge.conf /etc/nginx/sites-available/newsbridge
sudo nginx -t
sudo systemctl reload nginx
```

每次 `nginx -t` 成功才执行下一条 reload。证书若采用不同名称，使用 Certbot 返回的实际路径。添加续期成功后的 reload hook，并测试自动续期：

Reload only after a successful configuration check. If Certbot uses a different certificate name, update the paths. Install a renewal hook and test renewal:

```sh
sudo install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
sudo install -m 755 /srv/newsbridge/app/deploy/nginx/reload-after-renewal.sh /etc/letsencrypt/renewal-hooks/deploy/newsbridge-nginx
sudo /snap/bin/certbot renew --dry-run
sudo systemctl status snap.certbot.renew.timer --no-pager
```

## 7. 启动与验证 / Start and verify

将两个 service 文件的 Node 路径改为实际路径后安装。检查通过后先启动 API：

Set the actual Node executable path in both service files before installation. Verify units and start the API first:

```sh
sudo install -m 644 /srv/newsbridge/app/deploy/systemd/newsbridge-api.service /etc/systemd/system/
sudo install -m 644 /srv/newsbridge/app/deploy/systemd/newsbridge-daily.service /etc/systemd/system/
sudo install -m 644 /srv/newsbridge/app/deploy/systemd/newsbridge-daily.timer /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/newsbridge-api.service /etc/systemd/system/newsbridge-daily.service /etc/systemd/system/newsbridge-daily.timer
sudo systemctl daemon-reload
sudo systemctl enable --now newsbridge-api.service
sudo systemctl status newsbridge-api.service --no-pager
sudo ss -lntp
```

确认应用只监听 `127.0.0.1:8787`，公网由 Nginx 接收 443。访问域名根路径返回 404 是正常的；项目不提供网站首页。无密钥的请求应返回 401，下面命令不读取飞书数据、不发送消息：

Confirm loopback-only application binding. Nginx accepts public HTTPS. A 404 at the site root is expected. This unauthenticated check must return 401 and performs no Feishu action:

```sh
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  --request POST --header 'Content-Type: application/json' --data '{}' \
  https://newsbridge.example.com/v1/health
```

通过私有终端或 SFTP 读取 `/srv/newsbridge/private/browser-token.txt`，填入扩展 Settings 的 **Server access key**，点击 **Save settings**，再点 **Check server connection** 和 **Sync reading library**。这一步确认真实 CLI 授权和服务环境可用。不要将密钥放入 URL、命令行参数、截图或公开日志。

Read browser-token.txt through your private terminal or SFTP and enter it in Settings → Server access key → Save settings. Then check the connection and sync. This verifies the actual noninteractive CLI setup. Keep the key out of URLs, command arguments, screenshots and public logs.

## 8. 每日提醒与维护 / Reminders and maintenance

确认同步正常、会话 ID 和发消息权限正确后启用定时器。**启用时若已过当天 10 点，下一次运行可能立即发送当天提醒。**

After confirming sync, chat ID and permissions, enable the timer. **If it is already after 10:00, its next run may send today's reminder.**

```sh
sudo systemctl enable --now newsbridge-daily.timer
sudo systemctl list-timers newsbridge-daily.timer --all
```

定时器每 15 分钟检查，程序在配置时区 10 点后才处理当天；共享发送记录避免重复完成同一天，即使没有未读素材也完成当天。停机后只补当天，已完成后新增的素材等到明天。仍未读的素材可在次日再次提醒；发送不改变阅读状态，Chrome 无需保持运行。

Checks run every 15 minutes; processing starts after local 10:00. A completed day, even an empty one, is not repeated. Catch-up covers only today; later captures wait until tomorrow. Still-unread items can recur the next day. Delivery never marks content read, and Chrome need not remain open.

只同步时不用启用定时器。配置变更后重启 API；定时任务每次启动重新读取配置。修改时区后，同步调整 timer 的时区以保持检查时间直观。暂停提醒：

Leave the timer disabled for sync-only use. Restart the API after config changes; daily jobs read fresh config each run. If changing timezone, also align the timer timezone. To pause reminders:

```sh
sudo systemctl disable --now newsbridge-daily.timer
```

查看状态与近期日志（分享前检查是否包含私人信息）：

Inspect status and recent logs; review them for private information before sharing:

```sh
sudo journalctl -u newsbridge-api -u newsbridge-daily --since today --no-pager
```

401：检查服务密钥；403：检查扩展 ID；502：检查 API、端口和 Node 路径；CLI 失败：在相同服务账号、HOME、工作目录下检查授权、权限和凭证存储。连接成功但表格报错时检查字段类型与编辑权限。发送结果不确定时，先核对飞书会话，再在扩展中确认结果，不清空发送记录。

For 401 check the key; 403 the extension ID; 502 the API and executable path. For CLI failures verify authorization and credential storage under the same service environment. For table errors check fields and edit access. Resolve uncertain delivery only after checking the conversation; preserve receipts.

备份私有目录和 CLI 使用的凭证存储时保持加密、限制访问；不要提交 Git。更换密钥：

Keep private data and CLI credential backups encrypted and access-controlled, outside Git. Rotate the service key with:

```sh
sudo -u newsbridge -H /usr/local/bin/node /srv/newsbridge/app/server/rotate-key.js
sudo systemctl restart newsbridge-api.service
```

随后将新的 browser-token.txt 填回扩展。更换云服务商时，保持相同服务运行要求、私有数据与 HTTPS 接口；域名变化时同时更新服务配置、Nginx 和个人安装副本中的扩展地址。无需接入其他托管平台。

Update the extension with the new key. Another host can run the same services and private data; a domain change requires matching updates to server config, Nginx and the private extension copy. No additional hosting platform is required.
