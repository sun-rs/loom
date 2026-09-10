# Raft 状态设置器与 RAH 生命周期命令族的对应关系

日期：2026-09-10。只读取证 + 登记，**未改任何产品行为**。
来源：`raft-computer 1.0.18` 提取物。

## 起因

`task-claim` / `task-amend` 遇到陈旧上下文会给出可读、可恢复的 hold，而 `task-start` / `task-submit` /
`task-review` 仍抛光秃秃的 409。这看起来是同一缺陷剩下的另一半。取证的结果是：**其中一条确实是**（`task-submit`），其余不是。

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

## 更正：RAH 覆盖的是两类半，不是三类

`claim` 与 `claim-message` 都对应上游**同一条** `task claim`（后者是 `--message-id` 选择器）。
所以 RAH 原先覆盖的是 **claim / amend 两类**，**`update` 整类缺失**。此前"已经正确且完整"的说法是错的。

## Raft `task update` 五个目标状态的映射表

| Raft `--status` | RAH 的 Agent 面操作                                                           | 落账结果                                                     | 前置条件           | 陈旧上下文                  | 读后重试               |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------ | --------------------------- | ---------------------- |
| `in_review`     | **`task-submit`**                                                             | `state = submitted` + 提交摘要                               | 需为受让人且已开始 | **已改为 hold**             | 读到阻塞事实后重试成功 |
| `in_progress`   | `task-claim`（→`claimed`）、`task-start`（`claimed`→`in_progress`）           | 认领/开始                                                    | 未被他人占有       | claim 已 hold；start 仍 409 | —                      |
| `todo`          | `task-release`、`task-unblock`、`task-review --disposition changes_requested` | 清空认领 / 解除阻塞 / 打回                                   | 各自不同           | 均仍 409                    | —                      |
| `done`          | **无 Agent 面操作**                                                           | `completeTask` 仅经 Human 的 `updateTaskWorkflowStatus` 到达 | —                  | —                           | —                      |
| `closed`        | **无 Agent 面操作**                                                           | `cancelTask`                                                 | —                  | —                           | —                      |

`updateTaskWorkflowStatus` 在内核里存在，但只接受 Human actor，**worker CLI 完全够不到**。

## 唯一可确定的一行：`in_review`

出厂 prompt 原文（`chunk-ZHWD6VKE.js@117742`）：

> 4. When done, set status to \`in_review\` so a human can validate via \`raft task update\`

`in_review` 在上游**只有 `task update` 一条路径**，而 `task update` 会 hold；RAH 到达该状态的
Agent 面操作**唯一**就是 `task-submit`。因此这条按合同补齐，已接入并有行为回归。

## 更正：`done` 是能力缺口，不是"无对应物"

出厂 prompt 的 **Workflow** 小节是第二人称对 Agent 说的，第 5 步逐字：

> 5. After approval (e.g. "looks good", "merge it"), set status to \`done\`

**Raft 的 Agent 自己设 `done`。** 我此前把"RAH 没有 Agent 面操作"当成了"没有可映射对象"，
等于**把本地限制当成了产品要求**。实际是 `packages/kernel/src/collaboration-policy.ts:116` 的
`requireHumanTaskManager` 抛 "Task status management requires a Human" —— 这是 RAH 自研限制，
构成一处真实能力差异，待补齐。

**`closed` 同样更正**：`task update` 以 agent 凭据执行（`ctx.loadAgentContext()`），`--status`
取值就是含 `closed` 的五个，请求体 `{channel, task_number, status}` 直发 `/tasks/update-status`。
所以 **Agent CLI 能力已确认**；prompt 没有逐一举例并不等于能力不成立——这是我第二次犯同类错误。
服务端授权与转换条件仍待核实。RAH 侧 `closed`（`cancelled`）没有 Agent 入口。

## `todo` 与 `in_progress`：证据里有反例，不是"缺支持"

不能用"到达同一状态"来推 hold，因为上游自己就有反例：

- `task unclaim` 到达 `todo`，**不 hold**；
- `task create --assignee @yourself`"atomically creates it \`in_progress\`"，而 `create` **不 hold**。

所以 `task-start`、`task-review`、`task-release`、`task-unblock` 不能由目标状态推出结论。

## 九个命令没有 held 分支：只证明客户端不这样输出

**这只证明上游 CLI 不渲染 hold，不能证明 Raft 服务端没有并发检查。** 前面关于"明确不该 hold"的表述
按此限定收窄：给它们加 hold 会越过客户端合同，但服务端是否设有围栏仍属未知。

## 本轮产出

`task-submit` 接入 hold，并有行为回归证明"hold 时未应用（状态非 submitted、无提交摘要）"与
"读到相关新事实后重试成功"，移除该路由后测试即失败。护栏 `task-hold-route-set.test.ts` 钉住路由集并
**明说这个集合是有意不完整的**——它约束的是"不得无证据扩张"，不是"已经完整"。
登记表 `output.task.update-amend-freshness-hold` 仍记为 `missing`：RAH 没有 `task update`，
`update` 的另外四个状态仍未覆盖，这是真实缺口。

## 仍未收口

### `done`：能力缺口确认，但移植被"没有可查的批准事实"挡住

原计划是把授权由"必须是 Human"改为"本次提交的 producer"。**核查后这个方案不成立。**

`assertCompletionAllowed` 在任务**没有 reviewer 时直接 `return`，不作任何校验**
（`task-review-service.ts:484`），而 reviewer 只在创建时经 `reviewerIds` 设置，默认任务没有。
所以它**不是批准围栏**。已用 `task-completion-approval-fact.test.ts` 钉住这一事实。

于是今天 RAH 里"人类已批准"的**唯一持久事实，就是 Human 作为 actor 亲自完成这一动作本身**。
把完成权交给 Agent 会让这个事实凭空消失：提交者身份 ≠ 人类批准，Agent 可以提交完立刻自我完成。
即使配置了 reviewer，`task-review` 本身也是 Agent 面命令，批准者未必是人类。

上游怎么解决的：Raft 的批准是**人类在聊天里的自然语言**（"looks good"、"merge it"），由 Agent 自行判断。
**照抄它就等于依赖模型自述"已批准"**，这与本仓库"只从账本取证、不信模型口述"的规矩直接冲突；
而自建一套审批记录又属于新造审批系统。两条都被排除，因此**此项停在取证结论上，不进入实现**。

要推进需要先有一个可查的批准事实（谁、对哪一次 submission、何时批准），这是产品决定，不是复刻决定。

- `todo` / `in_progress`：上游有反例挡住推断，保持现状。
- `closed`：Agent CLI 能力已确认，服务端授权与转换条件待核实；RAH 无 Agent 入口。`task-block` / `task-unblock` / `task-request-input` / `task-progress`
  是 RAH 独有、上游无对应物，保留现有权限与执行围栏不变。
