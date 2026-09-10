# Raft 状态设置器与 RAH 生命周期命令族的对应关系

日期：2026-09-10。只读取证 + 登记，**未改任何产品行为**。
来源：`raft-computer 1.0.18` 提取物。

## 起因

`task-claim` / `task-amend` 遇到陈旧上下文会给出可读、可恢复的 hold，而 `task-start` / `task-submit` /
`task-review` 仍抛光秃秃的 409。这看起来是同一缺陷剩下的另一半，取证后**不是**。

## 上游的 hold 集合是穷尽的，不是样本

`isFreshnessHeldResponse` 在提取的 CLI 里**只有三个调用点**：

| 偏移                       | 命令          | `heldAction`                             |
| -------------------------- | ------------- | ---------------------------------------- |
| `dist-UT7IQEHX.js@2818851` | `task claim`  | Your task claim was not applied.         |
| `@2828667`                 | `task update` | Your task status update was not applied. |
| `@2840567`                 | `task amend`  | Your task amendment was not applied.     |

契约层独立佐证：只有 `agentApiTaskClaimResponseSchema`、`agentApiTaskUpdateStatusResponseSchema`、
`agentApiTaskAmendResponseSchema` 三个进入 `agentApiHeldFreshnessResponseSchema`。
`task` 子树共 12 个命令，其余九个（list / create / unclaim / assign / unassign / receipt / delete /
convert / history）**没有 held 变体**。

## 结论：RAH 现有集合已经正确且完整

RAH 的 `TASK_FRESHNESS_HOLD_ROUTES` = {claim, claim-message, amend}。
`claim-message` 是 Raft `task claim --message-id` 的同一命令另一种选择器，因此归入 claim。**无需扩大。**

**明确不该 hold（现在有证据，不再只是"未决"）**：`task-release`（对应 `unclaim`）、`task-assign`、
`task-assign --unassign`、`task-create`、`task-convert`、`task-delete` 及全部读命令——它们的 Raft
对应命令存在且确实没有 hold 分支。给它们加 hold 是越过合同自创。

## 三类无法据此裁决的命令

**一、Raft 单一设置器的碎片**：RAH **没有 `task update`，也没有 `--status`**。Raft 一条命令的五个状态
（todo / in_progress / in_review / done / closed）在 RAH 是一族命令。`task-submit`（→ in_review）、
`task-start`（→ in_progress）、`task-review --disposition changes_requested`（→ todo）在**状态**上可对应，
但**是否该 hold** 客户端产物判不了。而且 RAH 的 submit 还携带 Raft 设置器根本没有的提交证据负载。

**二、RAH 独有、上游完全没有的状态**：`blocked` 与 `blockedReason`、`waiting_input` 与整个 input request
面、`task-progress` 叙述、提交/验证/产物证据记录、reviewer 处置记录，以及 `claimed` 作为区别于
`in_progress` 的独立状态。**`blocked` 在整个产品里都不是 Task 状态**，`agentApiContract.ts` 里一次都没有。
上游对它们不授权任何做法——这也是上一轮我在 `blocked` 上过度推论后的更正。

**三、需要服务端才能回答**：Raft 服务端是否对 `unclaim`/`assign`/`convert`/`create` 也施加新鲜度围栏、
只是不渲染 hold；以及 `task assign --expected-revision`（"Only apply if the task is still at this revision"）
是不是 Raft 为 assign 准备的替代方案。客户端只能证明**渲染**不存在，不能证明**围栏**不存在。

## 本轮产出

不改行为。新增护栏 `task-hold-route-set.test.ts`，把 hold 路由集钉在这三条，并在测试里写明每一类被排除的理由——
以后要扩大必须带着新证据来改这个断言。登记表 `output.task.update-amend-freshness-hold` 的备注改为记录上述穷尽事实，
仍记为 `missing`：RAH 确实没有 `task update`，这是真实缺口，不用重新归类去降数字。

## 待裁决（不由取证决定）

RAH 的 `task-start` / `task-submit` / `task-review` 要不要 hold，是本地并发语义决定，不是复刻决定。
hold 比 409 更有信息（会展示新上下文并给出恢复路径，两者都不会应用变更），但会把退出码从 1 变成 0。
需要实际使用数据或官网实测才能定。
