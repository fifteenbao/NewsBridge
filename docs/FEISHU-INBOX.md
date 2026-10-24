# 飞书收录与阅读卡片

飞书可选，Chrome、数据库和 CSV 可独立使用。需已发布的自建应用及对应消息权限，桌面登录不代表服务已获授权。

## 配置

在私有配置填写 `feishu.appId`，提醒需额外填写 `feishu.chatId`：

```json
"feishuInbox": {
  "enabled": true,
  "allowedChatIds": ["oc_REPLACE_ME"],
  "allowedOpenIds": ["ou_REPLACE_ME"]
}
```

私有环境提供 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_EVENT_ENCRYPT_KEY`、`FEISHU_EVENT_VERIFICATION_TOKEN`，所有位置使用同一应用。不要在 Chrome、聊天或公开文件粘贴凭证。

将 `<baseUrl>events/feishu` 配为加密 HTTP 事件／卡片回调地址。先完成 URL 验证，订阅私聊文本事件 `im.message.receive_v1` 和卡片动作 `card.action.trigger`。回调须含加密 JSON、验证 Token、有效时间戳／nonce／签名、schema 2.0 和配置的应用 ID。会话与操作用户必须同时符合白名单；使用阅读卡片时也需将提醒会话加入白名单。

配置参考[飞书卡片回传交互](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-callback-communication)。使用当前回调格式，不是旧版 v1 负载；仓库测试模拟事件，实际配置仍需验证。

## 收录

只处理授权用户私聊文本，每条最多十个安全 HTTP(S) 链接。忽略机器人、群聊、其他用户和非文本消息。初始标题为链接，不请求正文或执行 AI。

事件持久化排队后确认接收，既有调度器运行 `ingest`，使用与 Chrome 相同的 URL 去重写入 SQLite，再确认新增／已存在数量。写入失败保留待处理且不发送成功确认；发送失败不撤销已存素材。Chrome 下次同步获取新记录。

`daily` 也会先处理收录队列；建议独立定期运行 ingest。排队成功不代表已完成收录。

## 阅读操作

启用回调后，提醒卡片提供打开原文、已读、稍后（24 小时）、跳过。打开不自动标已读；已读／跳过更新 SQLite；稍后保持未读，24 小时内不再参与提醒。Chrome 下次同步更新状态，表格编辑不驱动这些操作。

按钮必须匹配已持久化的消息 ID、会话、请求 UUID 和记录 ID，事件去重与状态变更在同一事务。伪造或无有效绑定的动作不会写库。保留最近 1000 条卡片消息绑定，超过保留范围的卡片不能继续改状态。

## 不确定发送结果

收录确认先保存 UUID 再发送；一小时内使用同一 UUID 重试，超过窗口停止并等待人工核对：

```sh
node examples/run.mjs inbox-pending private/host.json --env private/host.env
node examples/run.mjs inbox-resolve private/host.json --receipt-id RECEIPT_ID --outcome sent --env private/host.env
```

确认消息已存在再选 `sent`，确认未发送才选 `not-sent`，后者允许下次 ingest 发新请求。每日提醒使用独立的 `pending` 日志及设置页高级诊断。不要删除数据库或发送记录强制重试。

处理送达结果不改变阅读状态。收录保留上限 2000 条消息，满额报错，不静默丢弃。
