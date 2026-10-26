# 配置 ReadFlow

[使用与安装](README.md) · [部署参数](docs/SELF-HOSTING.md) · [飞书消息](docs/FEISHU-INBOX.md)

先完成数据库和 Chrome 连接，再按需启用飞书。收藏、阅读状态和 CSV 不需要飞书账号。

## 1. 初始化数据库

参考服务需要单机 POSIX 环境、Node.js **22.13+**（内置 `node:sqlite`），无需安装 npm 依赖。部分 Node 版本会显示 SQLite 实验性提示。从仓库根目录操作：

```sh
mkdir -m 700 private
cp examples/host.example.json private/host.json
chmod 600 private/host.json
```

修改 `private/host.json`：`baseUrl` 填已有 HTTPS 服务地址，可保留应用子路径；`stateDir` 填 `./state`，相对配置文件解析。`extensionId` 可先留空，安装插件后补齐。`private/` 已被 Git 忽略，真实配置和凭证不得提交。

```sh
node examples/run.mjs init private/host.json
node examples/run.mjs check private/host.json
node examples/run.mjs audit private/host.json
```

初始化创建 `state/readflow.sqlite` 及固定资料库身份，不覆盖已有内容。收藏、配对和任务状态保存在 SQLite；`state.json` 仅为初始化／权限检查文件。目录须为 0700、文件 0600，归运行服务的 uid 所有，不允许符号链接或多重硬链接（nlink 必须为 1）。`audit` 检查权限，`check` 检查数据库，不验证飞书权限。

## 2. 接入 HTTPS

将 `createHost(config).handleRequest` 接入已有 HTTPS 服务，或显式启动仅监听本机回环地址的参考服务，再由已有 HTTPS 代理转发：

```sh
node examples/serve.mjs private/host.json
```

代理与配置参数见[自建部署](docs/SELF-HOSTING.md)。不要直接向公网开放回环监听端口。导入代码不会自动启动服务或安装调度。

## 3. 安装并配对 Chrome

按 [README](README.md#安装-chrome-插件) 安装。将 `chrome://extensions` 显示的真实扩展 ID 填入服务端 `extensionId`，重启服务。

**保持安装文件夹固定。移动解压目录可能改变扩展 ID，需要更新服务端白名单，否则会收到 `403 ORIGIN_DENIED`。扩展 ID 不是认证密钥。**

在插件设置填写 HTTPS 服务地址，在 Step 2 点击“连接服务器，获取指纹”，授权该主机。点击“复制确认任务”，交给服务端 agent；核对完整指纹和扩展 ID 后批准：

```sh
node examples/run.mjs pair-list private/host.json
node examples/run.mjs pair-approve private/host.json --pair-id REQUEST_ID --fingerprint DISPLAYED_HEX
```

收到批准回复后，在 Step 3 点击“已获批准，完成连接”，验证授权并自动保存。无需填写飞书表格地址或密钥。先收藏一条测试链接，验证数据库同步和 CSV。拒绝、撤销与重连见[配对说明](docs/PAIRING.md)。

## 4. CSV 导出

设置中的“下载 CSV”先同步本机待发送收藏，再下载数据库全部素材。列为标题、链接、阅读状态、时间、标签、笔记。不需要飞书凭证、表格链接或表格权限。

## 5. 可选：飞书链接收录

按[飞书指南](docs/FEISHU-INBOX.md) 配置链接收录，使用 `ingest` 处理队列。每日阅读提醒暂时移除，不配置 reminderTime、remindersEnabled 或 daily 调度；已有 daily 调度请停用。未经用户授权不要发送测试消息或安装定时任务。

## 备份

停止所有服务和任务进程，复制完整私有状态目录，保留所有权和权限，再重启。CSV 只是内容导出，不包含配对和任务状态。数据库缺失时启动应失败，不得静默新建主库替代。

## 交给 agent 配置

将项目目录和需求提供给自己的 agent，要求它先读 `AGENTS.md` 和本文：

1. 只检查相关运行环境、HTTPS、私有存储和调度能力，不扫描无关凭证；新增平台、账号或费用前先征求同意。
2. 按上述顺序初始化、检查、安装和配对。核对完整指纹后才批准，不通过重置数据库来掩盖错误。
3. 在授权范围验证收藏去重、标签／笔记修改、离线重试、已读／跳过和 CSV，区分模拟测试与真实验证。
4. 询问是否需要飞书链接收录，仅启用所需消息权限。分析由已有对话型 agent 承担，不部署新 agent 或模型接口。
5. 交付服务地址、固定安装目录、验证结果、备份位置和未完成事项。配置助手不等于内置 AI Review。

现有对话型 agent 的调用方式需另行对接，不能仅凭会话 ID 宣称已支持自动分析。不要为 ReadFlow 配置模型密钥或多维表格权限。

## 已有 agent 分析

已有 Hermes 可以复用本服务，独立配对一次即可查询收藏及保存用户确认的回顾；不添加模型密钥或 Chrome 设置项。按 [agent 接入指南](docs/AGENT.md) 操作。请先阅读其资料访问范围和确认信任边界。
