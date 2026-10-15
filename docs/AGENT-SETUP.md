# Agent-assisted setup / Agent 配置说明

Read [README](../README.md), [SETUP](../SETUP.md), and [the connection contract](CONNECTION.md). Configure the user's existing environment; do not rewrite core extension code to accommodate each installation.

先阅读上述文档。优先配置用户已有环境，不为每次安装重写扩展核心代码。

1. **Inspect, without exposing secrets.** Determine the available authenticated Feishu / Google tools, verified identity, table permissions, existing HTTPS routing, durable storage, shared locking, and optional scheduler. Do not scan unrelated credential files or infer authorization from a desktop login.
2. **Report the fit.** Distinguish local-only capture, table sync, and scheduled reminders. A chat integration is not proof of table access. If something is missing, say what; do not silently install software, open ports, create accounts, deploy hosting or expand permissions.
3. **Adapt the existing tool.** Implement the small adapter in private integration code, following CONNECTION.md. Normalize pagination and errors. Preserve fixed-table restrictions and message UUIDs. Verify identity using actual authorization, not a constant copied from config. Do not claim a named product is supported until tested.
4. **Write private configuration.** Use `private/` or the environment's own private storage. Leave reminders disabled initially. Run `npm run doctor -- --config <private-path>` for local format checks; this does not validate live capabilities.
5. **Generate the installation artifact.** Use `npm run build` and configure the HTTPS service address in Settings. The user grants the selected host from Check/Save; never request the entire optional HTTPS range. Public source must retain no required host permission and no private endpoint. Optional fixed-origin private builds remain available. Give the user the output directory/ZIP and load-unpacked instructions. Never publish the connected build as a generic public release.
6. **Verify the contract.** Check health and pinned identity; read fields and records. With user-authorized disposable content, verify capture deduplication, status updates, preservation of existing notes, and deletion handling. An auth or timeout failure must preserve local data. Never send test chat messages without authorization.
7. **Enable reminders if requested and supported.** Confirm the target chat and durable state/locking before registering the existing scheduler. Do not use daily() as a health check: it can send messages. Explain whether sleep/offline periods delay delivery. Keep reminders disabled when requirements are missing.
8. **Hand off evidence.** Report configured capabilities, installation path, local tests versus live checks, and anything still missing. Do not include keys, tokens, private domains or personal account details in public documentation.

中文执行要点：

1. 只检查相关能力，不暴露密钥，也不把桌面登录当成 API 授权。
2. 分清本地收藏、表格同步、定时提醒三个层次；缺能力就报告，不擅自部署或扩大权限。
3. 在私人接入代码中实现适配器，保留分页、账号校验、目标限制和消息去重。
4. 生成私人配置，初始关闭提醒；doctor 只做格式检查。
5. 生成离线安装包或唯一授权域名的私人连接包，公开源码不包含私人信息。
6. 用已授权的临时素材验证状态同步、去重、笔记保留与删除处理；不擅自发送测试消息。
7. 确认现有调度、共享锁和持久化存储后才启用每日提醒。
8. 交付安装路径与验证结果，明确模拟测试和真实验证的区别。

Use the optional runnable examples and ordered initialization in [SETUP.md](../SETUP.md). Never read late-loaded credentials into module-level constants. Run schema preflight, preserve structured diagnostics and verify the shared lock across processes. Empty extensionId allows authenticated setup checks only; register the installed extension before browser use. A pasted table URL must match the host's authorized table; it cannot grant table access or rebind an existing collection.

参考 SETUP 的可执行步骤：先初始化状态和密钥，再加载凭证、预检字段、安装扩展及登记 ID。延迟注入的凭证不得在模块级提前缓存；保留诊断编号并验证跨进程锁。设置页链接不能代替飞书授权，也不能静默重绑已有资料库。


For an explicitly requested self-hosted setup, follow [SELF-HOSTING.md](SELF-HOSTING.md) / [中文部署指南](SELF-HOSTING.zh-CN.md). Select only the user-authorized provider and preconfigured profiles. Google prepare writes headers only on a blank target and adopts row metadata; run it only with table-write authorization. Provider switching uses Settings disconnect first; do not copy linked caches across identities. Schedule periodic checks using the persisted custom time/timezone; browser settings do not install jobs. Actual deployment, credential/account creation and test messages remain subject to the user's explicit scope.

明确要求自建时按双语部署指南操作，仅启用用户授权的类型。Google prepare 会写空表表头与行身份，仅在有表格写入授权时执行。切换先取消关联，不跨身份复制关联缓存；定时任务轮询持久化时间／时区，界面不自动创建任务。部署、账号／凭证创建和测试消息仍以用户明确授权范围为准。
