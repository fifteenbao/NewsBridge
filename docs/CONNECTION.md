# 连接约定

参考服务使用 `database` 主库；CSV 为文件出口，飞书为消息及后续外部 agent 讨论入口。

## 地址与认证

`baseUrl` 是完整公开 HTTPS 服务地址，可带应用子路径，统一以斜线结尾。`origin` 仅包含协议、主机和可选端口，不带路径。例如 `https://connection.example.com/readflow/` 的 origin 是 `https://connection.example.com`，API 前缀为 `/readflow/v1/`。不得去掉应用路径，地址不得包含凭证、查询或片段。

Chrome 仅授权该 origin。服务端登记精确扩展 ID；移动安装目录可能改变 ID。P-256 配对须管理员核对完整指纹。请求通过 `X-ReadFlow-*` 签署完整 URL、正文哈希、时间戳和 nonce，共享持久化 nonce 防止重放。批准接口不对 HTTP 暴露，详见[配对](PAIRING.md)。

接口均用 POST JSON，响应设置 `Cache-Control: no-store`。请求体最大 20 MiB，最多两个并发操作。浏览器不能传入任意飞书 API 路径。

## 操作

| 路径 | 输入 | 效果 |
| --- | --- | --- |
| `v1/health` | `{provider:"database"}` | 检查数据库及可选配置，不调用飞书 |
| `v1/sync` | `{items:[...]}` | 上传待同步收藏，返回完整主库快照，不写表格 |
| `v1/read` | `{base,recordId,status}` | 数据库设为待阅读／已读／跳过 |
| `v1/preferences` | `{language,reminderTime,timeZone,remindersEnabled}` | 保存偏好，不安装调度器 |
| `v1/csv` | `{}` | 返回数据库 `{csv,filename,count}` |
| `v1/pending` | `{}` | 查看送达不确定的提醒 |
| `v1/resolve` | `{uuid,outcome}` | 核实会话后确认 sent／not-sent |
| `v1/pair` | 公钥 | 已登记扩展提交待批准请求，无资料库访问权 |

普通操作可携带 `provider` 和 `expectedIdentity`。成功响应包含 `{ok:true,protocolVersion:1,identity}`，身份为 `{connectionId:"db:<persistent-id>",base:"<persistent-id>/library"}`。修改导出目标不改变资料库身份；新数据库会改变身份。

同步返回 `enabled`、`base`、`articles`、`topics:[]`、`bindings`、`metadataBindings` 和 `captureMetadata`。文章包含 recordId、title、url、status/read、savedAt（毫秒）、readAt（毫秒或 null）、tags、remark。浏览器内部历史字段 `feishuRecordId`／`feishuBase` 现在表示数据库绑定，不是飞书行 ID 或凭证。

新收藏包含本机 id、安全 HTTP(S) URL、title、ISO savedAt。标签／笔记显式修改使用 `{metadataUpdate:{id:UUID,fields:{tags,remark}}}`：省略字段不变，空值明确清除。最多 20 个标签、每个 50 字符，笔记编辑最多 2000 字符（内部字段仍为 `remark`）。重复编辑只确认、不重复应用；URL 去重和事务保证双入口共用一条记录。

健康检查报告 `configuration.storageProvider="database"` 及提醒可用性／偏好，不报告表格目标。数据库检查成功不代表飞书消息或外部 agent 已授权。

## CSV 编码

CSV 使用 UTF-8 BOM、CRLF、带引号单元格及双写引号，处理公式前缀。包含全部记录，不仅未读；不含凭证、配对密钥和任务状态。

## 调度与事件

导入模块不启动监听或调度。既有调度器调用 `ingest`／`daily`。`events/feishu` 使用独立加密事件认证和用户／会话白名单；卡片操作验证消息／记录／请求绑定并按事件 ID 去重。详见[飞书指南](FEISHU-INBOX.md)。

诊断须结构化且不带凭证，数据库错误不得泄露 SQL 路径或秘密输入。HTTP 成功、落库、CSV 导出、消息送达和已读是不同结果。

旧记录的 `note` 与 `remark` 在数据库打开时以事务合并到 `remark`，相同文字只保留一次。界面统一叫“笔记”，历史非空内容／类别／评分仍留在数据库，不作破坏性删除。

ReadFlow 不提供模型调用和分析结果回写接口。后续与已有 agent 的对接需明确触发方式、素材身份、授权及幂等性后实现；不将机器人消息自动当作收藏或分析结果。

## 已读时间与 agent

服务器仅在状态从其他值变为“已读”时设置 readAt（服务器当前 UTC Unix 毫秒），重复点击不刷新。改成未读／跳过时当前 readAt 清空；reading_events 继续保存之前的状态变更和时间。飞书卡片按同一规则处理，重复事件不计数。旧已读记录和本机已读状态导入没有可信时间，保留未知，不补成今天；尚无阅读耗时数据。CSV 末列增加“标记已读时间”，以 ISO UTC 输出，未知为空。

`v1/agent/*` 使用独立配对密钥和受限权限，不接受浏览器身份；详见 [agent 协议和 Hermes 操作](AGENT.md)。配对不等于每次保存确认，服务验证摘要和引用，由已授权 agent 负责核实用户对具体内容的确认。
