# Security review / 安全检查记录

Review scope: NewsBridge 0.5.0 Native Messaging source, browser permissions, local configuration, CLI execution, synchronization, daily deliveries, persistence, and documentation. This is a repository review, not a penetration-test certificate.

范围包括本机通信、权限、配置、CLI 调用、同步、每日提醒和记录持久化；不属于渗透测试认证。

## Verified with offline tests / 离线测试验证

- Native frame fragmentation, Unicode, response chunking, invalid sizes/order, duplicate input, malformed JSON, and disconnected hosts. / 分片、编码、大小与格式错误。
- An actual native-host process launched in a temporary project copy using a mock executable: valid origin succeeds, another origin is rejected, and CLI error text stays withheld. / 临时目录真实进程通信，飞书端仍为模拟。
- CLI uses the fixed executable/workspace without a shell; article content travels over stdin; user/bot envelopes and failure responses are checked. / 固定调用路径、标准输入与响应校验。
- Identity mismatch blocks writes; a cached collection cannot silently move to another app/account. / 身份不符阻止写入和资料转移。
- Private-file modes, symlink rejection, corrupt-journal failure, durable saves, concurrent locks and old dead-lock recovery. / 私有文件、损坏记录和并发锁。
- Eight-field mapping, pagination, existing-note preservation, linked deletions, reading-state changes, and unsafe-link filtering. / 字段与同步规则。
- Daily 10:00 scheduling, daylight-saving transitions, startup catch-up, no send on manual capture/sync, repeated unread reminders next day, and independent read/delivery status. / 每日调度及状态独立。
- Pending UUID persistence, original-UUID retries, changed/expired pending requests, empty daily completion, and split messages. / 发送恢复与批次。

`npm test` and `npm run security` are the required verification commands. The latter rejects expanded extension access, suspicious credential literals, private configuration/journal files included in Git, and unsafe DOM/code-execution sinks. The extension has no runtime npm dependencies; installed Node.js and lark-cli remain dependencies outside this scan.

上述命令为必要检查；扫描不覆盖已安装 Node.js 和 CLI 的全部安全性。

## Implemented changes / 已落实措施

Removed the HTTP helper, permanent-service startup files, hosted OAuth source, direct browser API calls and domain permissions. Replaced transport with a tightly scoped Native Messaging helper; added private file validation, durable delivery journaling and cross-process locking. Kept default CLI protections and documented exactly which data leaves the device.

移除 HTTP 服务、常驻启动文件、托管登录源码、浏览器直连 API 和域名权限，改为限定操作的本机桥接，并加入私有记录、持久化和并发锁；说明数据流并保留 CLI 默认防护。

## Not live-validated / 尚未实际联调

No real Chrome host registration, authenticated Feishu API request, or message send was performed as part of these checks. The CLI command syntax was checked through local help; the integration test substitutes a mock executable. A real extension ID, private configuration, authorized workspace, table and chat are required to complete [SETUP.md](../SETUP.md). No remote deployment is needed or performed.

未注册真实 Chrome 桥接、未调用已授权飞书 API、未发送真实消息；进程测试使用模拟 CLI。本机命令语法通过帮助信息核对，真实使用仍需按配置指南安装和授权。

Residual risks include same-user device compromise, CLI credential/security behavior, external edits between reads/writes, bounded provider deduplication, independent senders, ambiguous record creation, DNS/private-link aliases, and Chrome/device availability. See [SECURITY.md](../SECURITY.md) for the practical boundaries.

剩余风险包括同用户权限下设备受损、CLI 凭证行为、外部并发修改、有限去重窗口、多发送端、创建结果不确定，以及浏览器/设备可用性。
