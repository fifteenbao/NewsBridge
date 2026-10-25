# ReadFlow 自建部署

参考实现使用单机 Node.js 22.13+、私有 SQLite 文件和已有 HTTPS 路由。不需要托管数据库、指定云平台或指定 agent；Chrome 收藏、数据库同步和 CSV 不需要飞书凭证。按 [SETUP](../SETUP.md) 的顺序初始化。

## 配置项

复制 `examples/host.example.json` 到私有目录，不提交真实配置。

| 字段 | 含义 |
| --- | --- |
| `baseUrl` | 完整 HTTPS 服务地址，保留应用子路径 |
| `extensionId` | Chrome 实际 32 位 a–p 扩展 ID，空值允许准备服务，但禁止浏览器配对 |
| `stateDir` | 相对配置文件的私有目录，HTTP 服务和任务必须共用 |
| `connector.storageProvider` | 固定 `database` |
| `connector.remindersEnabled` | 服务是否具备提醒能力；调度与发消息未配置前保持 false |
| `connector.reminderTime/timeZone/language` | 默认偏好，用户保存的设置优先 |
| `feishu.appId` | 可选应用 ID，与环境变量 `FEISHU_APP_ID` 一致 |
| `feishu.chatId` | 可选提醒目标会话 |
| `feishuInbox` | 可选的加密收录／卡片回调，限制确切会话与发送人 |

运行 `node examples/run.mjs init private/host.json` 初始化。不会重置已有数据库身份和内容。健康检查不调用飞书；启动时数据库缺失会报错，不会静默创建新主库。目录 0700、文件 0600，归服务用户所有，禁止符号链接和多重硬链接。

## HTTPS 路由

可将 `createHost(config).handleRequest` 接入已有路由，也可明确运行 `node examples/serve.mjs private/host.json`。参考服务仅监听本机回环地址 8787（可由 `port` 修改），Chrome 连接外层 HTTPS 反向代理。代理需保留完整子路径和 `X-ReadFlow-*` 请求头，限制请求体 20 MiB，支持 POST/OPTIONS，禁止缓存认证响应；不要向公网暴露回环服务端口。

导入模块不会部署进程、开端口、申请证书或安装调度。使用已有进程管理方式，以同一非特权 uid 运行 HTTP 与任务。修改配置后重启；Chrome 安装目录保持固定，以免扩展 ID 改变。配对前必须核对指纹。

## 可选飞书能力

通过服务环境或 `--env private/host.env` 提供 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`，只用于消息及回调。无需多维表格权限或模型 API 凭证；现有对话型 agent 自行管理分析所需环境。

发消息需要发送权限及固定会话；链接收录和卡片回调另需加密密钥、验证 Token 和白名单，见 [飞书指南](FEISHU-INBOX.md)。桌面登录或其他 agent 能聊天，不代表此服务已拥有 API 权限。

## 使用既有调度器

获用户授权后，用同一配置、stateDir、uid 和环境运行：

```sh
node examples/run.mjs ingest private/host.json --env private/host.env
node examples/run.mjs daily private/host.json --env private/host.env
```

按需要定期运行 ingest（例如每分钟）；daily 也可每分钟检查，到用户设定时间才发送，并先处理收录队列。服务能力与用户开关都开启后才会提醒。不要将 daily 用作健康检查，它可能发送真实消息。

## 备份与限制

停止 HTTP 和任务进程后，复制整个私有状态目录并保留权限。SQLite 使用 FULL 同步提交和 DELETE 日志。跨进程共享锁避免并发写；崩溃遗留锁需先确认记录的进程已退出，再清理。不能删除发送日志来强制重发。使用 `audit`、`pending`、`inbox-pending` 排查。

参考实现面向单机，资料库最多 10,000 条；收录队列保留最多 2,000 条消息记录，达到上限会报错而不是丢弃。交互卡片绑定保留最近 1,000 条消息，更旧卡片不能继续改状态。不提供多机集群及自动清理策略。CSV 是内容导出，不是运行状态备份。

仓库验证使用真实本地 SQLite 和模拟飞书 API；实际使用前仍须验证应用权限、反向代理和事件订阅。
