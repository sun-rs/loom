# Worker message-check：自动确认的最小闭环方案

2026-09-11；只设计，未实现。本文不把 stdout 写入、notice receipt、进程退出视为模型读懂或工作完成。

## 上游证据与可知范围

Raft Computer 1.0.18 冻结提取物：`/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`，SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。

`messageCheckCommand`（729502）声明非阻塞 drain，返回前确认投递序列。`drainInbox`（677012–677039）最多 50 轮调用 `events.get({since:"latest"})`，收集 events；部分读取后发生失败会返回已有消息并标 hasMore。客户端无独立 ACK 请求。由此可移植“模型无需维护游标、工具有界取消息”的合同，不能推导服务端 ACK 事务、模型已读保证或恰好一次执行。

## 本地四层语义

1. `syncWorker`（`room-kernel.ts:4877`）以当前凭据的 Room、consumer、Activation.toSeq 读取；不确认。`room-sync.ts:35–62` 的默认起点是持久订阅游标，不是固定 Activation 起点。
2. 应用服务 `worker-application-service.ts:736–758` 记录本凭据实际发出的 cursor，ACK 入口 1043 起只接受已投递且未超出冻结范围的序号。`acknowledgeWorkerCursor` 更新 subscription_cursors，单调不回退。
3. Message/Room 的定向读取及 Task 新鲜度读取位置是另一层：允许成员读取并不自动确认 Inbox、完成 Activation 或扩大写权限。跨 Room / DM 读取不能拿其序号确认当前 Activation。
4. `completeActivation`（`room-kernel.ts:4727`）除确认至 toSeq，还验证终止证明和 `activationObligations.assertSatisfied`。工具自动确认不得跳过这些条件，更不能直接调用完成接口。

## 不能只做三行串接

`sync → stdout.write → acknowledge` 隐藏了模型游标，但尚未恢复闭环：确认后模型崩溃/执行失败，新运行默认 sync 从已确认位置开始，将跳过原消息。未满足 obligation 能挡住假完成，却不能自行让模型重新看到请求。

另外当前 `WorkerCliRuntime.stdout.write(value): unknown` 不能等待异步写失败或背压。调用返回不代表输出完整交给管道；即使回调成功，也只证明 OS/流接受了输出，不证明 CLI 外层工具、模型看过它。

## 建议：两个门面能力同批，底层所有权不变

- `worker message-check`：不接受手填 cursor，不接受任意 Room 参数。复用当前 Worker credential 的 sync/ACK；每页完整验证、渲染并等待输出写入回调，之后 ACK 这一页实际 cursorAfter。一页确认后再取下一页；显式限制轮数、累计字节和时间。达到预算输出“当前 Activation 还有未取完投递，再调用本命令”，不宣称全局无新消息。
- `worker message-check --replay`（命名待实现评审）：通过受鉴权服务端操作重读当前 Activation 的原始输入范围及未完成义务来源。范围由 Kernel 的既有 Activation/fromSeq/toSeq 与 obligation 记录决定，不能由模型提交序号；不把订阅游标倒退。重试启动必须先使用 replay，普通 check 仍表示 drain。

实施前必须以真实账本 fixture 确认 Activation.fromSeq 覆盖哪些事件：若普通 sync 的未确认前缀早于 fromSeq，重读合同必须明确覆盖该前缀/义务来源，不能只猜 `fromSeq-1` 足够。优先复用既有 canonical 状态及有界查询；若无法从既有状态恢复首次展示边界，再由 Kernel 增加持久投递回执，而不是 CLI 文件缓存或第二套私有游标。

此方案的最小性是保留所有现有内核确认、任务和执行围栏，仅增加复合工具编排、受限重读入口与可等待输出接口。不能为了少改一条路径，省掉重试恢复要求。

## 失败处理

- 获取失败/格式错误/超字节：该页不输出成功、不 ACK；先前页如已输出并确认需如实报告部分进度。
- 输出失败或关闭：不 ACK 当前页。写入超时同样保守失败；保留可重读。
- 输出完成、ACK 前崩溃：允许下次重复显示，同一 Message ID 可识别；业务幂等仍归 Kernel。
- ACK 成功但回执丢失：只重试同一 credential/同一 cursor 的 ACK，确认单调且可重复。不要盲目把整段读取当新业务执行；若原 credential 失效，用新激活凭据 replay，而非复用旧密钥。
- ACK 后模型未执行/运行失败：retry 经 replay 重新呈现原始请求及未完成义务；不能因已 ACK 而呈现空白然后停止。
- 到达冻结 toSeq 后又有 Room 消息：明确当前批次已取完，新增工作仍在 follow-up。不可 ACK 新序号，也不可用 notice 指纹替代投递 cursor。

不需要第一版添加 CLI 持久响应缓存。其隐私、失效和另一游标所有者风险高；先使用 canonical replay。若 stdout 已完整写入而下游工具仍丢响应，最多承诺可恢复的重复呈现，不能承诺模型恰好读一次。

## 兼容与提示词

保留 `sync` 和显式 `acknowledge` 的原协议及行为供旧 CLI/会话使用。新 prompt 引导新 message-check/replay，移除新路径的“手抄 original-sync-cursorAfter”步骤。任何从“工作做完才 ACK”改为“工具返回前确认投递”都必须明确：ACK 是投递确认，不是工作验收。Task 状态、Inbox 业务义务和 AgentHost completeActivation 检查保持独立。

通知提示只要求定向读取新目标，不将跨 Room message-read 隐式转换为当前 Activation ACK。已有旧会话 prompt 和新 CLI 混用仍可继续显式 ACK，单调更新不应造成重复业务副作用。

## 必须先红后绿的行为清单

1. 多页正常读取：页顺序、输出完成后才 ACK、每页只 ACK 完整展示上界；不跳页。
2. 背压、异步 EPIPE、写超时：无当前页 ACK，退出失败且可重试。
3. 第二页网络失败：第一页成果保留、第二页不确认、部分结果说明准确。
4. 输出后 ACK 前崩溃，以及 ACK 成功响应丢失：重试不越界、不假完成。
5. ACK 后模型失败，换新 RunAttempt / daemon 重启：replay 仍显示原请求；任务/回复义务未被消费掉，处理后可正常完成。
6. 原始未确认前缀早于 Activation.fromSeq：证明重读范围覆盖所有必要输入，或拒绝不完整恢复。
7. 连续两次 check、显式 sync/ACK 混用：单调游标，不再要求模型构造序号。
8. 跨 Room / DM message-read、Thread 多目标和忙时追加：不扩大本 Activation ACK，不提前消费 follow-up。
9. 凭据过期、成员被移除、旧 lease/fence、伪造 continuation：保持现有拒绝。
10. 空页、toSeq 为零、超过预算和新消息晚到：文案只描述当前冻结范围，不把局部空白宣称为全局无工作。

验收顺序：假流/假时钟工具单元测试 → 真实服务与临时 SQLite 的崩溃重放链 → AgentHost 完成围栏集成 → 经用户授权的真实 CLI 与 Raft 同条件对照。当前仅完成设计，未宣称任何上述新增行为已通过。
