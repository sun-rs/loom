# Task 批量工具合同：实施与明确剩余

日期：2026-09-11。该批是原第 4 项的批量 create/claim 子项；不代表五态状态设置、全部 Agent 工具或 Raft 双边验收完成。

## 上游证据

授权本地取证包：`raft-computer 1.0.18`，提取物
`/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`，
SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。

- 16547–16602：claim 的 `task_numbers/message_ids`、create 的 `tasks[]/assignee`、update 的 `task_number/status/freshnessContextMode`。
- 17260–17273：claim 返回逐项 `results[]` 或独立 freshness held 响应。
- 17323：create 返回 `tasks[]`。
- 730090–730153：重复 `--title` 构成一次 create 请求；共享 assignee 在失败时不得创建 Task Message。
- 730176–730244：混合数字、Message 选择器构成一次 claim 请求；held 文案明确未应用；结果中业务失败不转为 CLI 异常。
- 677516：逐项成功、失败及汇总和 Task Thread 引导。
- 730404–730474：update 接受五态；没有 summary/approval CLI 参数。
- 735629–735638：Agent 在自然语言批准后设置 done；自分配创建为 in_progress；owner/admin 可指派其他人。

这里只证明客户端可观察合同，未获取 Raft 服务端数据库事务实现。RAH 单事务和幂等收据是对该合同的本地实现，不称为逐字拷贝。

## 实施

- `worker-task-batch.ts` 是 Kernel 批次组合，复用 `task-intent.ts` 的创建事务与从原 RoomKernel 提取的 `task-claim.ts`；未引入另一套 Task 状态。
- create 与 claim 均为单 HTTP 请求。create 全批写入或回滚；claim 在任何写入前检查所有可授权 Task 的 freshness，held 零认领。业务冲突逐项记录并继续，其余异常整体回滚。
- 输入最多 100 个 Task。现有 execution、Room、交付、依赖和单一 claim owner 校验保留。跨 Room 的执行权限没有借 batch 放开。
- Worker service 将成功结果纳入原有 claim heartbeat；不以 stdout 或 HTTP 成功完成 Task。
- 正常调用不要求模型携带幂等键。自动键复用 participant、Activation、Room、operation、规范化内容约定；同一 Activation 相同创建命令是重试，新 Activation 可创建新工作。显式 key 的 receipt 范围为 actor + Room + operation，不按 Run 切分。
- 批次 receipt 同事务记录 request digest 与结果。重放仍校验当前 execution 和 Room membership；Task 已删除时保留原成功身份和 `deleted:true`，不返回旧 title 或可执行 Thread 引导。

### 本地存储政策

`task-batch-receipts.ts` 集中常量：7 日最短保留、全局 1024 条上限、单结果 256 KiB、每次最多清理 100 条。这些数字不是 Raft 取证值。

过期收据仅在原 Activation 已终态/已清理且无 starting/running/orphaned Run 时回收。容量耗尽明确拒绝新批次，不淘汰未过期结果。Room 删除通过外键级联清理。超出保留窗口不承诺历史响应精确重放；活跃或可恢复运行不因 TTL 丢失收据。

## 仍未对齐，不能隐藏

- 后续 [Task 状态入口](./2026-09-11-task-status-facade.zh-CN.md)已实现前三态局部映射，不能称五态业务全部对齐。`done/closed` 的现有 Human 管理限制未删除；不能伪造 Human identity、批准事实、摘要或交付证据。
- 当前 `task_reviews` 是 Agent reviewer 对具体 submission 的批准；没有 reviewer 时完成检查直接返回，因此不是 Human 批准事实。Raft 出厂 prompt 的自然语言批准不证明服务端存在对应结构化批准模型。
- 批次 Message ID 选择器目前只能定位已有 Task。普通 Message 自动转 Task 仍走有分类 rationale 的旧入口，不能称全部 `message_ids` 上游语义已复制。
- self-assignment 保留现有 `claimed` 执行状态，实际开始仍经 start；代其他人分配、`creates-resource`、reviewer-isolation 的完整上游语义未由本批实现。
- 源码/Kernel HTTP 回归不等于真实 CLI 模型、正式浏览器或 Raft 同条件双边通过。CLI 接线、总门禁和正式部署由主任务统一验收。

## 验证

初始临时真实 service/Kernel 测试三个用例均因缺少 batch 路由返回 404 而失败；实现后覆盖混合成功失败、全批 hold、读后恢复、幂等回放、冲突 key、授权撤销、第二条创建故障全批回滚、Task 删除后安全回放、输入上限及 retention/cap。

测试入口：`packages/application-service/test/task-batch.test.ts`。同时回归旧 `task-hold-recovery.test.ts` 和 `worker-minimal-task-commands.test.ts`。全部使用临时数据库和假 Runtime，没有调用付费模型。

## 同批第 5 项独立核查与小修

Mute/unmute 的九个可选 `attention` 字段已覆盖 Raft `main.js:17204–17218` 的形状，输出顺序对应 `675385–675401`。`unmuteApi/muteApi` 属可选值，本地未生成不构成字段缺失；提示正文描述本地经测试的实际投递策略，不宣称是闭源 Raft 服务端的逐字原句。

补齐 `675452–675456` 可确定的错误码：非 5xx 的 mute/unmute 请求失败输出 `MUTE_FAILED` / `UNMUTE_FAILED`，保留后端诊断与下一步信息；其他路由及已有 5xx 分类不变。`workerServerFailureError` 由 CLI 传入实际路径决定操作，不从错误正文猜测。独立测试先复现 `Code: forbidden` 与上游操作码不符，再验证两种操作、实际 CLI 入口和未受影响的错误路径。保留省略目标使用当前 Room 的兼容能力。

尚存签名差异：Raft 接受位置参数目标，本地保持 `--target` / `--channel`；Raft 要求显式普通频道目标，本地还允许省略使用当前 Room。完整 CLI 字节合同与线上相同条件静音行为仍不因此全部签收。
