# 连接约定

参考服务使用 `database` 主库；飞书表格仅为可选手动出口。

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
| `v1/export` | `{}` | 显式导出到服务端固定表格 |
| `v1/pending` | `{}` | 查看送达不确定的提醒 |
| `v1/resolve` | `{uuid,outcome}` | 核实会话后确认 sent／not-sent |
| `v1/pair` | 公钥 | 已登记扩展提交待批准请求，无资料库访问权 |

普通操作可携带 `provider` 和 `expectedIdentity`。成功响应包含 `{ok:true,protocolVersion:1,identity}`，身份为 `{connectionId:"db:<persistent-id>",base:"<persistent-id>/library"}`。修改导出目标不改变资料库身份；新数据库会改变身份。

同步返回 `enabled`、`base`、`articles`、`topics:[]`、`bindings`、`metadataBindings` 和 `captureMetadata`。文章包含 recordId、title、url、status/read、content、category、recommendation、note、savedAt（毫秒）、tags、remark。浏览器内部历史字段 `feishuRecordId`／`feishuBase` 现在表示数据库绑定，不是飞书行 ID 或凭证。

新收藏包含本机 id、安全 HTTP(S) URL、title、ISO savedAt。标签／备注显式修改使用 `{metadataUpdate:{id:UUID,fields:{tags,remark}}}`：省略字段不变，空值明确清除。最多 20 个标签、每个 50 字符，备注最多 2000 字符。重复编辑只确认、不重复应用；URL 去重和事务保证双入口共用一条记录。

健康检查报告 `configuration.storageProvider="database"`、提醒可用性／偏好和可选 `exportAvailable`／`exportUrl`。插件只显示服务端导出链接，不用表格链接重新配置主库。数据库检查成功不代表飞书授权成功。

## 导出编码

目标须有 [SETUP](../SETUP.md#创建阅读表) 的十列。文本写入纯字符串；匹配已有导出行时可读取并归一化富文本数组。超链接类型 15 写 `{text,link}`，文本类型 1 写字符串。类别单选写字符串、多选写数组；标签为字符串数组；阅读状态为单选字符串；时间为 epoch 毫秒；推荐指数为数字或 null。内容、笔记、备注均为文本。类型不匹配时在写入前停止。

按 URL 新增／更新并覆盖十个管理列；目标存在重复 URL 时停止并报告。保留其他行，不反向导入、不定时导出、不远程删除。部分失败不修改主库，手动重试先重新列出目标，不盲目重试不确定的创建操作。

CSV 使用 UTF-8 BOM、CRLF、带引号单元格及双写引号，处理公式前缀。包含全部记录，不仅未读；不含凭证、配对密钥和任务状态。

## 调度与事件

导入模块不启动监听或调度。既有调度器调用 `ingest`／`daily`。`events/feishu` 使用独立加密事件认证和用户／会话白名单；卡片操作验证消息／记录／请求绑定并按事件 ID 去重。详见[飞书指南](FEISHU-INBOX.md)。

诊断须结构化且不带凭证，数据库错误不得泄露 SQL 路径或秘密输入。HTTP 成功、落库、表格导出、消息送达和已读是不同结果。
