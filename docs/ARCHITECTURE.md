# 架构

**服务端 SQLite 是唯一主库。**

```mermaid
flowchart LR
  Chrome[Chrome 收藏与待同步队列] -->|签名同步| Service[ReadFlow 服务]
  Chat[飞书私聊] -->|验证加密回调| Service
  Service <--> DB[(SQLite 资料库与运行状态)]
  Scheduler[既有调度器] -->|ingest / daily| Service
  Service -->|收录确认与阅读邀请| Chat
  Service -->|用户手动导出| Table[飞书多维表格副本]
  Service -->|用户手动下载| CSV[CSV 快照]
```

Chrome 先保存标题、链接、标签和备注，再尝试同步。首次可明确选择本机模式；服务临时离线时保留待同步队列。本机缓存不是第二主库或完整备份。已关联记录的状态修改须得到服务确认。

`examples/database.js` 管理记录、编辑与卡片操作 ID、运行状态。URL 唯一约束防止重复收藏，事务保证批次原子性，编辑 UUID 防止旧请求覆盖新修改。资料库身份不依赖飞书账号或导出表。

`connector/database-runtime.js` 提供数据库操作与调度入口。`examples/host.js` 组装数据库、跨进程锁、配对和可选飞书能力。`examples/feishu-service.js` 负责当前服务的表格导出和发消息。收藏、健康检查、状态和 CSV 不调用飞书。

`examples/feishu-inbox.js` 校验加密、签名、Token、应用及会话／用户白名单。事件持久化入队后确认接收，由任务实际落库并发送收录结果。卡片操作还需匹配已发送消息、请求和记录绑定。

既有调度器运行 `ingest` 和 `daily`；daily 先处理收录队列。发送 UUID 在发送前持久化，不确定结果仅在去重窗口内重试，超时需人工核对。送达不代表已读。

飞书表格只做手动单向导出：预检十个字段，按链接新增／更新，覆盖受管理列、保留其他行，不反向导入。CSV 导出全部记录并防范公式注入。插件两种导出操作都会先上传待同步收藏，失败则停止导出。

## 代码边界

- `src/`：Chrome 页面、后台与浏览器所需共享校验。安装包仅包含此目录、清单、图标和许可证。
- `connector/`：连接协议、运行时；`connector/lib/` 存放服务端字段、消息、导出工具，不进入 Chrome 安装包。
- `examples/`：可运行的 SQLite 参考服务、飞书集成与操作入口。
- `scripts/`：打包、环境检查、安全检查和可选建表。
- `test/`：本地及模拟接口测试。底层表格适配器仍有参考与测试用途，不作为当前服务主库。

参考实现面向单机 POSIX，无 npm 运行依赖。备份需停服务并复制完整私有状态目录。尚未实现多机集群、统一删除、正文抓取、视频转写和 AI Review。

[配置](../SETUP.md) · [接口](CONNECTION.md) · [安全](../SECURITY.md)
