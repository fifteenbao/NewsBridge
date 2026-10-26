# 浏览器配对

无需手填连接访问密钥。浏览器生成 P-256 签名身份，管理员确认后服务端只保存公钥。扩展 ID 限定来源，但它是公开信息，不是认证密钥。

## 首次连接

按 [SETUP](../SETUP.md#3-安装并配对-chrome) 初始化数据库、登记扩展 ID、填写服务地址并核对指纹。配对不要求飞书凭证或表格链接。Step 2 获取指纹后，点击“复制确认任务”交给服务端 agent。收到批准回复，再点击 Step 3“已获批准，完成连接”；之后自动签名。

## 拒绝与撤销

```sh
node examples/run.mjs pair-reject private/host.json --pair-id YOUR_PAIR_REQUEST_ID
node examples/run.mjs pair-revoke private/host.json --pair-id YOUR_APPROVED_PAIR_ID
```

待批准请求十分钟过期；最多三个待批准和十六个已批准设备。过期后重新执行 Step 2 获取申请并批准。撤销后设备不能发送认证请求。

插件“取消关联”清除当前关联、归档收藏并移除可选主机权限，但保留按地址保存的配对身份以便重连。**彻底撤销访问须在服务端运行 `pair-revoke`。** 重装、切换 Chrome 配置文件或更换服务地址／路径可能需要重新配对。资料库身份变化需先取消旧关联，避免混合两个主库。

## 密钥与代理

浏览器私钥保存在可信扩展上下文的本机存储中，需保护 Chrome 配置文件；不是系统密码保险箱。飞书 App Secret 只在服务端。参考服务不创建或接受 `access.key`，只接受已确认签名身份。

代理需原样传递 Origin、Content-Type 与四个签名头。Nginx 示例：

```nginx
proxy_set_header X-ReadFlow-Pair $http_x_readflow_pair;
proxy_set_header X-ReadFlow-Time $http_x_readflow_time;
proxy_set_header X-ReadFlow-Nonce $http_x_readflow_nonce;
proxy_set_header X-ReadFlow-Signature $http_x_readflow_signature;
```

不记录正文或签名头。待批准配对只能提交公钥，不能读写资料库。HTTPS 和精确来源白名单始终保留；配对不会部署服务、授予飞书权限或安装调度。
