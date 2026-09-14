# 2026-09-12：通知 Outbox 租约失效导致正式服务退出

## 现场证据

用户报告整个 Tailnet HTTP 地址无法访问。本机确认 4173 无监听，HTTP 连接被拒绝；
Tailnet 网卡仍持有原地址。正式进程日志以 `LeaseConflictError` 退出：
`WebPushOutboxDispatcher.run` 捕获投递/ack 失败后调用 `retryOutbox`，但旧租约已失效，
第二次异常未捕获，经 `runCoupledComponents` 使整个 daemon 退出。

数据库对应通知 Outbox 在 2026-09-12 09:55:50 UTC 创建，租约截止 09:55:55 UTC，
仍未 published。日志证明丢失租约；不能仅据此断言是系统休眠或某个网络请求导致。

停止现场有 3 项 queued Activation；所有 RunAttempt 已终态、RuntimeProcess 已 terminated、
Placement 和 exclusive lease 已 released。没有强杀进程或清除待办。崩溃后先完整备份原状态，
冷启动由原有 Kernel 恢复队列；空闲热重启的 queued-work guard 不适用于已经退出的进程。

## 修复与 owner

只修改 daemon 的 Web Push Outbox dispatcher。租约与重新领取仍归 Kernel：

- ack 已失去租约时不再尝试通过旧租约写 retry。
- 正常投递失败后仍安排 retry；retry 期间失去租约仅结束此次处理，继续领取后续工作。
- 只识别核心 `LeaseConflictError`，数据库等其他错误仍向上传递，未以吞掉所有异常隐藏故障。

这是现有 Kernel 租约 fencing 的接入修复，不移植 Raft 中央推送架构，也不创建第二套队列。
源码合同见 `RoomKernel.leaseNextOutbox`、`acknowledgeOutboxPublished`、`retryOutbox`、
`#requireOutboxLease`。

## 验证

新增三个故障路径测试：ack 失效后仍能领取后续工作；retry 时失效后仍能领取后续工作；
非租约错误仍失败。前两项在修复前均重现现场的未捕获 LeaseConflictError，修复后通过。
既有投递成功与 404/410 endpoint 清理测试通过。未运行付费 CLI 测试。

## 正式恢复与检查结果

已校验崩溃后完整备份 `~/.rah/backups/post-crash-push-f4b42f4a-6191-4d25-ab23-9c0d96fed6d8`，
然后用既有 launcher 冷启动原 `~/.rah/state`，没有强杀或改写任务状态。继续使用已核验冻结 Web
构建 `8408ff18191e2238b503b67726a94c2b3787e094932c51bc8fdc8d9d37840895`，仅后端代码改变。

原故障 Outbox 在 2026-09-12 13:21:25 UTC 被第二次领取并 published。遗留三项 Activation
恢复后观察到一项完成、两项 leased；这是恢复原工作，不是新建付费测试任务。
正式 Tailnet HTTP 恢复监听；内置浏览器可见原频道、四个 DM 与历史消息，Chromium 正式
刷新门禁通过。WebKit 能加载成员和消息，但连续刷新门禁仍报告一次 messages/social 的
access-control pageerror，因此不声明 iOS/WebKit 完整验收。该导航期附属数据错误与此次
已证实的进程退出分别记录，不用一次成功刷新掩盖。

`npm run check` 根测试 1563 项，1544 通过、17 跳过；两项失败仍是既有 interaction icon
hash 和 Skills globe 顺序断言，没有新增失败。类型检查、格式和 diff 检查通过；本批没有
Web 源码改动，复用经验证的 frozen assets，未重建或更换前端。未提交 commit。
