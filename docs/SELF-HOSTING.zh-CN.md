# NewsBridge 自建部署指南（飞书 / Google 表格）

[English](SELF-HOSTING.md) · [配置指南](../SETUP.md)

Chrome 将收藏通过 HTTPS 发给**你自己的连接服务**，由服务端持有凭证并调用飞书／Google API。插件自动使用已确认的浏览器身份签名，不复用飞书桌面客户端或 Google 网页登录。Google 表格使用 Sheets API，不使用 Apps Script。两种表格的提醒目前都发送到**已配置的飞书会话**，尚不支持 Google 邮件提醒。

以下参考实现需要 Node.js 22+ 和 POSIX 文件系统，不需要安装 npm 运行依赖。同一机器上的服务和定时任务共用私人状态目录、跨进程文件锁。多机器须提供持久化数据库和共享锁，不能简单复制状态文件。导入示例不会自动监听端口、部署或创建定时任务。

类型切换和自定义提醒需同时使用 V0.3.0 连接服务源码与扩展。

## 1. 选择配置

在仓库根目录创建权限为 0700 的 private/，选择一个示例复制为新的 private/host.json；已有配置不要覆盖：

- 飞书：examples/host.example.json。
- Google：examples/host.google.example.json。
- 两种都配置、在设置页切换：examples/host.dual.example.json。

真实参数只填在私人文件。connector 指定 CLI 的默认类型；存在 connections 时，该映射才是实际启用的 feishu／google 配置，默认类型也必须在映射中存在。各配置的 storageProvider 应与映射名称一致。一个已确认的浏览器身份授权该服务已配置的两种表格，适合单个可信用户；它不是多用户账号系统。

| 参数 | 飞书 | Google |
| --- | --- | --- |
| storageProvider | feishu | google |
| connectionId | **app:<真实 appId>**，例如 app:cli_EXAMPLE | **google:<服务账号真实 client_email>** |
| baseToken | 多维表格 app token | 链接 /d/ 与 /edit 之间的 Spreadsheet ID |
| articleTableId | tbl… | gid 指定的数字工作表 ID，**0 也有效** |
| chatId | 不开提醒时留空 | 同左；提醒仍使用飞书会话 |
| remindersEnabled | 会话权限和调度准备好后才设 true | 同左，另填 messageConnectionId: "app:<真实飞书 appId>" |
| reminderTime / timeZone | 每日 HH:mm / IANA 时区，默认 10:00 / Asia/Shanghai | 同左 |

baseUrl 是公开 HTTPS 地址，可包含子目录，例如 https://connection.example.com/newsbridge/；私人扩展包使用相同地址。extensionId 可暂留空，用于初始化和运维检查；填入实际扩展 ID 前，浏览器请求会被拒绝。stateDir 相对 host.json 所在目录解析。port 可选、默认 8787，仅用于手动启动的回环服务。

host.json、host.env 和服务账号 JSON 使用 0600，归服务运行用户所有，不用软链接或硬链接。private/、状态、备份和凭证不进 Git、不随扩展发布。状态目录及文件要求私人权限、同一所有者和单硬链接，可用 audit 检查。Windows 环境应另实现安全持久化接口，而不是绕过这些 POSIX 检查。

## 2A. 飞书连接

创建或使用自己的飞书自建应用，按组织流程开通权限和发布。基础同步需要多维表格字段／记录读取、新建记录、更新记录，并将目标表格以可编辑权限授权给应用。知识库链接另需节点读取权限。只有提醒需要消息发送权限及目标 oc_… 会话访问权限，不需要宽泛租户管理权限。

在 private/host.env 填写：

```dotenv
FEISHU_APP_ID=cli_REPLACE_ME
FEISHU_APP_SECRET=REPLACE_ME
```

适配器在实际调用时获取 tenant access token，校验 connectionId 必须等于 app:<appId>。取得令牌并不代表目标表格已授权。按[阅读表格说明](../KNOWLEDGE-SETUP.md)配置八个字段；新用户也可手动运行[一键建表脚本](../SETUP.md#create-the-eight-field-table--一键创建八字段表)，建表权限与普通同步权限分开。

## 2B. Google 连接

1. 在自己的 Google Cloud 项目启用 **Google Sheets API**。
2. 创建专用服务账号，按组织允许的方式取得 JSON 凭证，不启用域级委派。如果禁止下载服务账号密钥，应由既有环境提供认证适配器；仓库参考实现使用服务账号 JWT OAuth，不实现交互式用户 OAuth 或工作负载联合认证。
3. 把 JSON 放在私人绝对路径，权限 0600。仅将需要操作的 Spreadsheet 分享给该账号 client_email，角色为 Editor。Cloud IAM 角色不会自动赋予表格内容访问权，表格分享需单独完成。
4. 创建／打开普通网格工作表，至少两行、八列；初始分配的网格行数不超过 10,000。将 Spreadsheet ID 和 gid 填入配置；准备命令只操作指定工作表，不创建整个 Spreadsheet，也不猜第一张表。
5. 在 host.env 填写文件路径，不粘贴 JSON：

```dotenv
GOOGLE_SERVICE_ACCOUNT_FILE=/absolute/private/path/service-account.json
```

6. 执行 init 后，运行下方显式 prepare。A:H 完全为空时，命令填写八个表头；已有内容须按顺序使用：标题、链接、内容、类别、阅读状态、推荐指数、笔记、时间。表头冲突会停止，不改写用户内容。prepare 为导入行登记不可见的行元数据身份，**不增加第九列**。这是运维写操作，不是只读检查；准备期间避免其他人同时调整行结构。

八列使用普通单元格值：标题／链接／内容／类别／阅读状态／笔记为字符串，推荐指数为数字或留空。插件写入的时间为 Unix 毫秒；导入时间支持 ISO 8601 字符串或 Unix 毫秒，**不把 Google 原生日历序号解析为日期**。链接填纯文本 URL，不用 HYPERLINK 公式；写入使用字符串／RAW，收藏的 =… 文本不会变成公式。Google 没有飞书字段类型，检查的是表头结构。

记录身份来自行 developer metadata，状态更新通过 metadata data filter 定位。整行移动会保留身份；不要仅对某一列排序、删除元数据、合并数据单元格或替换工作表。手动新增／导入的行需要再执行 prepare，一次最多登记 1,000 条新身份；普通同步不自动接管未知行。空行忽略，零记录表可用；新收藏插在表头下一行。总网格最多 10,001 行（含表头），达到上限会停止新增；必要时删除多余空白网格行，但至少保留两行。

参考实现使用 spreadsheets scope。Google 权限不能限制到一个工作表，因此应只向专用服务账号分享必要文件；服务端另限制固定 Spreadsheet／gid 和固定 API 地址。不要把 JSON 密钥或 Google OAuth token 填入插件。

[Google 服务账号认证](https://developers.google.com/identity/protocols/oauth2/service-account) · [权限范围](https://developers.google.com/workspace/sheets/api/scopes) · [行元数据](https://developers.google.com/workspace/sheets/api/guides/metadata)

## 3. 初始化与验证

用服务和任务实际运行的同一用户，在项目根目录执行：

```sh
node examples/run.mjs init private/host.json
node examples/run.mjs audit private/host.json
# 仅 Google 需要；双类型配置明确指定 google：
node examples/run.mjs prepare private/host.json --env private/host.env --provider google
node examples/run.mjs check private/host.json --env private/host.env
node examples/run.mjs check private/host.json --env private/host.env --write
# 检查第二种类型：
node examples/run.mjs check private/host.json --env private/host.env --provider google --write
```

--env 只加载明确指定的文件，先于凭证回调执行；已有进程环境变量优先。host.env 中的文件路径不相对该文件解析，请用服务账号 JSON 的绝对路径。check 只读；check --write 创建一条带标记的临时记录、读回并清理。飞书删除该记录；Google 只清空临时记录的八个单元格并移除元数据，留下空行，不删除网格行或已有用户记录。清理不确定时保留私人 probe 日志，应核实对应临时记录后再重试，不盲目清空日志或提醒发送记录。

[浏览器配对](PAIRING.md)代替手填密钥：服务端填写扩展 ID，设置页发起配对，核对指纹确认一次，再检查连接。新的参考初始化不创建 access.key。


## 4. 接入现有 HTTPS 服务

已有路由支持 Fetch Request／Response 时，导入 examples/host.js 的 createHost()，将 host.handleRequest 接到配置的路径前缀。导入不监听端口。也可以**手动启动**可选参考服务：

```sh
node examples/serve.mjs private/host.json --env private/host.env
```

该入口只监听 **127.0.0.1**，不绑定公网地址。由自己的进程管理器维护，并通过既有 HTTPS 反向代理访问；防火墙不开放内部端口。这是服务器接收插件请求的端口，与验证本机桌面登录无关，不需要本机 Chrome helper。

已有 Nginx HTTPS 站点可参考以下 location；域名与证书按自己的环境单独配置：

```nginx
location /newsbridge/ {
    client_max_body_size 20m;
    proxy_read_timeout 200s;
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-NewsBridge-Pair $http_x_newsbridge_pair;
    proxy_set_header X-NewsBridge-Time $http_x_newsbridge_time;
    proxy_set_header X-NewsBridge-Nonce $http_x_newsbridge_nonce;
    proxy_set_header X-NewsBridge-Signature $http_x_newsbridge_signature;
}
```

上游端口后不要加斜杠，以保留子目录前缀。原样传递 Origin 和 Authorization；使用既有代理的限流，日志不记录认证头、请求正文或带凭证的 URL。处理器要求固定 HTTPS 地址、精确扩展来源和密钥，限制 JSON 大小和两个并发请求；CORS 不能替代认证。运维可不带 Origin，但仍须提供有效密钥。公开入口必须 TLS。异机代理不能访问这台机器的回环地址，应在该环境接入处理器并提供等效防护。

## 5. 安装、关联、取消关联与切换

### 直接在设置页配置地址

安装公开包，或运行 npm run build 并加载 dist/newsbridge/。在设置页填写**连接服务地址**（自己的 HTTPS baseUrl，可含子目录），无需编辑 CONNECTION_BASE_URL 或为每个服务器重打包。点击检查／保存时，Chrome 申请此具体主机的可选权限；安装时不获得所有网站访问权限。声明 https://*/* 是运行时选择域名的能力范围，不代表已授予该范围。拒绝权限后仍可本地收藏。[Chrome 可选权限](https://developer.chrome.com/docs/extensions/reference/api/permissions)

填写的地址须与服务端 baseUrl 一致。Base/Spreadsheet 和 Table/gid ID 自动解析且不再显示为输入项。选择飞书类型只显示飞书链接提示，选择 Google 则显示 Google 表格链接提示。页眉语言立即改变界面，保存后同步到提醒，不再提供第二个语言选项。

目前仍仅支持 HTTPS 公共主机，不支持 http://localhost:8787/；localhost 指 Chrome 所在电脑，不能代替远程服务器地址。连接地址不是表格链接，也不能代替服务端部署或授权。上文 127.0.0.1:8787 是服务器反向代理的内部入口，Chrome 访问其 HTTPS 地址。

### 填写 Chrome 扩展 ID

1. 用下方命令构建，打开 chrome://extensions，开启“开发者模式”，加载 dist/newsbridge/。
2. 找到 **NewsBridge** 卡片，复制卡片显示的 **ID**（32 个 a–p 字母），不要复制名称或版本。设置页页脚也显示实际扩展 ID。
3. 打开**连接服务设备上**的 private/host.json，将 ID 填到最外层 extensionId 字段，与 baseUrl、stateDir 同级；不是 connector 内部字段。
4. 保存后重启连接服务，或让已有路由重新加载配置并重建处理器。随后在扩展设置页检查连接。

配置位置示例（只展示结构，保留文件中的其他参数）：

```json
{
  "extensionId": "REPLACE_WITH_ACTUAL_CHROME_EXTENSION_ID"
}
```

只填写实际 ID，不加 chrome-extension:// 前缀。留空允许服务启动和带密钥的运维检查，但浏览器请求会被拒绝。填写错误、未重启，或加载目录变化后仍使用旧 ID，会导致 403 ORIGIN_DENIED；重新填写访问密钥不能解决该错误。


```sh
npm run build
```

固定目录加载 dist/newsbridge/。在 chrome://extensions 复制实际扩展 ID 到 host.json，重启／重建处理器。移动解压目录可能改变 ID，导致 **403 ORIGIN_DENIED**；升级时覆盖同一路径并重新加载，不放宽白名单。

在设置页选择飞书多维表格／Google Sheets，填写对应链接，发起配对并在服务端核对指纹确认，再次检查并保存，详见[配对指南](PAIRING.md)。飞书链接可不含 table=；Google 链接可不含 gid，此时只匹配同一 Spreadsheet 中服务端指定的工作表。两种表格链接都不能推导飞书提醒会话 ID。服务端必须预先配置所选类型，下拉框不创建凭证或授予权限。双类型配置可在同一 HTTPS 地址切换，无需重打扩展包。

切换已关联资料库前点击**取消关联**：按 HTTPS 地址及实际验证的账号／表格保存本机归档，清空当前关联列表与设置，不删除远端记录。未关联的本机收藏保留。重新连接完全相同的账号／表格会恢复对应归档；不同类型／表格使用独立列表，旧关联收藏不会误上传。归档受 Chrome 存储配额限制，保存失败保留原数据。卸载扩展可能清除本机归档，远端表格是持久化管理空间。

取消关联只影响本机，**不撤销服务端授权，也不停止服务端任务**。需要暂停提醒时先关闭开关并保存；未确认发送记录仍保存在服务端，重新连接后核实。服务端更换账号／表格也需要取消关联再连接。换 HTTPS 地址时先取消关联，在设置页填写新地址、授权其具体主机并独立配对，公开可配置包无需重新构建；私人预填包仍受固定域名限制。

## 6. 自定义每日提醒

两种表格都可配置飞书消息凭证、目标 chatId 和既有调度器，再启用服务端 remindersEnabled。Google 还须设置 messageConnectionId 为实际飞书应用身份；不使用提醒时，Google 收藏／同步不需要飞书应用。

设置页可修改开关、每日 HH:mm 和 IANA 时区，页眉语言保存后同时用于提醒，默认仍为 10:00 Asia/Shanghai。保存写入持久化的服务端偏好，检查连接回显实际值。不同类型分别保存偏好与发送记录。会话目标由服务端指定，浏览器不能随意改收件人。

让已有任务每分钟或每几分钟检查一次，不将调度器锁定在 10:00，界面改时间才会自动生效。例如已有 Linux cron 中手动加入下列任务，每种已启用类型各一条，真实路径私下替换：

```cron
* * * * * cd /absolute/path/NewsBridge && /absolute/path/node examples/run.mjs daily private/host.json --env private/host.env --provider feishu >> /private/path/newsbridge-job.log 2>&1
* * * * * cd /absolute/path/NewsBridge && /absolute/path/node examples/run.mjs daily private/host.json --env private/host.env --provider google >> /private/path/newsbridge-google-job.log 2>&1
```

仓库不会自动安装定时任务。日志目录使用私人权限并轮转；任务与 HTTP 服务共用 stateDir 及跨进程锁。当天配置时间后重复调用由发送记录去重；延迟／停机只补当前本地日期，不补历史日期。夏令时按 IANA 时区处理，当天完成后不重复发，但不保证精确到指定分钟。已读／跳过／删除记录不提醒，提醒不标记已读，仍未读的内容可在明天再次出现。发送结果不确定会保留 pending，需要核实；改时间或切换类型不会清除它。

## 验证边界

仓库测试使用离线 API 模拟，覆盖空表、身份隔离、字面值写入、行身份移动、状态同步及提醒时间，不证明真实账号权限、表格分享、HTTPS 代理或调度器已可用。请在自己的已授权环境执行显式检查，并用一条临时收藏验证后再开提醒；公开包不预置任何真实账号。
