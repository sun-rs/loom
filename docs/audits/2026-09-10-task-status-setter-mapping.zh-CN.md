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

## 其余四个状态：证据里有反例，不是"缺支持"

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

`update` 的另外四个状态（todo / in_progress / done / closed）未对齐：前两个在上游有反例挡住推断，
后两个在 RAH 根本没有 Agent 面操作。`task-block` / `task-unblock` / `task-request-input` / `task-progress`
是 RAH 独有、上游无对应物，保留现有权限与执行围栏不变。
