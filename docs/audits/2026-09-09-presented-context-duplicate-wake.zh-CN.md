# 重复唤醒：把"已呈现"事实写进 Worker 投递

批次日期：2026-09-09。承接[发送合同结构性移植](./2026-09-09-raft-send-facade-structural-port.zh-CN.md)中留下的边界。

## 缺陷与实测

真实付费运行（现场 `…-WYOrkV`）：Human 在 seq 3 提出请求，Agent 忙碌期间 Human 在 seq 8 追加。账本为
Activation A `[3,3]`、Activation B `[8,8]`。A 执行期间 Agent 的发送被 freshness hold，**hold 把 seq 8 摆到了它面前**，
它据此回复并按围栏 ack 到 3。随后 B 又为 seq 8 唤醒它一次。它在 B 里花了 23 条推理、6 次 worker 命令
（`sync`、`message-read`、`room-read`、`message-resolve`）反复确认"我是不是已经回过了"。换一个不那么谨慎的模型就会重复回复。

## 根因

- Activation 只在存在 `queued` 兄弟时合并（`room-event-writer.ts:126-158`）。A 当时是 `leased`，所以 seq 8 只能新开 B。
  schema 索引 `idx_one_queued_activation_per_lane` 保证每条 lane 至多一个 queued，合并本就无法折进 leased 的那条。
- ack 受 `grant.scope.toSeq` 限制（`worker-application-service.ts:895-915`），A 里根本无法 ack 到 8。
  **所以第二次唤醒是结构性必需的，压制它会丢工作**——"被展示过"不等于"已处理"。
- `worker_target_read_positions`（本月新增）在 hold 时已把已读位置持久记到 8（`collaboration-service.ts:2021`），
  但创建唤醒和 `syncWorker` 从不读它。Agent 被迫用多次往返去重建 Kernel 已经知道的事实。

## 上游依据与方向

Raft 用一个长驻会话加 inbox，并以 `filterUncontributedMessages` / `pruneContributedToPending`
（`sendStdinNotification` 内，见证据目录）保证同一会话内不重复呈现已经摆到模型面前的消息。
RAH 因 ack 围栏必须再唤醒一次，因此移植方向是**让这次唤醒携带"已呈现"事实**，而不是丢弃唤醒。

## 实现

- 新 owner 模块 `packages/kernel/src/worker-presented-context.ts`：只读地为 `syncWorker` 附加
  `presentedContext`，含按目标去重的 `targets[].presentedThroughSeq`，以及按事件的 `alreadyPresented`
  与 `respondedAfter`（该参与者在同一目标、该事件之后自己发过的消息 id，最多 5 条并附总数）。
  只对 `message.posted` 计算（其他事件类型没有目标），每次 sync 最多注解 20 条事件，读取位置只读不推进。
- 协议新增可选字段，`RoomEventSchema` 未改动——worker 专属字段不泄漏进 Human 客户端合同。
- prompt 只陈述事实，不给判断：说明 `presentedThroughSeq`、`alreadyPresented`、`respondedAfter` 是
  Kernel 在事发当时记录的账本事实，决定前先读。测试用两条 `doesNotMatch` 守住，任何"所以你不要回复"之类的
  判断句都会让测试失败，与 2026-09-09 删除自研判断规则的裁决一致。

**明确不做**：压制或合并第二个 Activation、改动 ack 围栏、按 Runtime 区分忙时投递、改用 Raft 的长驻会话/inbox 进程模型。

## 验证

确定性回归 `packages/daemon/test/presented-context-second-activation.test.ts` 用真实 worker CLI 复现整条链，
断言账本中确有两个 Activation、已读位置为追加消息序号，且第二次 sync 的 stdout 里带 `alreadyPresented` 与
指向自己前一条回复的 `respondedAfter`；连续 3 次稳定。把该模块置空会让它失败，已验证。
`npm run check` 全绿：1187 通过、0 失败、6 跳过。棘轮 `room-kernel.ts` 6,800/6,925、`protocol/src/index.ts` 1,658/1,800。

真实模型对照（OpenCode `deepseek/deepseek-v4-flash` low，同一歧义措辞场景，只观察不断言）：

| 指标（第二次唤醒内） | 修复前 `…-WYOrkV` | 修复后 `…-xYtkgs` |
| -------------------- | ----------------- | ----------------- |
| 模型推理/文本条目    | 23                | 2                 |
| worker 命令往返      | 6                 | 2                 |
| Agent 消息总数       | 1                 | 1                 |
| Activation 数        | 2                 | 2                 |

账本形状不变，重复回复风险与往返成本大幅下降。

## 未收口

- 按 Runtime 区分的忙时投递仍未对齐：Raft 为 Claude gated、Codex direct、Kimi direct、OpenCode none，
  RAH 是统一的冻结 Activation 加持久 follow-up。本批只降低了它的代价，没有改变模型。
- Raft 的"一个 Agent 一个长驻会话 + 回合结束投递 inbox 积压"是更大的架构项，未启动。
