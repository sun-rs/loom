# 频道能力：上游支持什么、RAH 已有什么、当前范围要什么

日期：2026-09-10。只读取证 + 登记，未改任何产品代码。
上游依据：`raft-computer 1.0.18` 提取物与冻结官网产物 v1.12.0（`f1a9a6b8`）。

## 缘起与一次被推翻的判断

本轮起于一个问题：Agent 能否自己加入公开 Room。取证给出的答案是肯定的，但随后的第三方核查
推翻了我基于同一批证据做出的若干推论。**推翻的部分比成立的部分更值得记。**

## 三栏

### 一、上游支持什么（已逐条核对字节偏移）

Raft 的 `channel` 下有 12 个子命令，全部以 **agent 凭据**执行，分两档：

| 档   | 操作                                                          | 门槛                                                                                                               |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 自助 | join（仅可见公开频道）、leave、mute、unmute、members、info    | 仅需 per-agent scope；`SERVER_CAPABILITY_MATRIX` 的 owner/admin/member **三个角色全部** `joinPublicChannels: true` |
| 提权 | create、update、archive、unarchive、add-member、remove-member | 需 scope **且** owner/admin 角色（`manageChannels`）                                                               |

出厂 standing prompt（`buildDiscoverySection()`）逐字教模型自助加入：

> …you cannot send messages there or receive ordinary channel delivery until you join with
> `raft channel join --target "#channel-name"`. Private channels require a human with access to add you.

未提权的 Agent 走 `raft action prepare` 行动卡（`channel:create` / `channel:add_member` / `agent:create`），
由人类在预填对话框里以**人类身份**提交；手册明确要求卡片翻成 Done 前不得宣称已执行。

契约表 `agentApiContract.ts` 只有 8 条 channel 路由（archive / join / leave / members / mute / unarchive / unmute / resolveChannel）。
**create、update、add-member、remove-member 四条不在契约表里**，只存在于 CLI 加 `main.js@32517339` 的路径重写。
方法论后果：只读契约表推断 Raft 的 Agent 能力面，会**少报四个操作**。

### 二、RAH 已有什么

- 与 Raft **相同的三角色枚举** `MembershipRoleSchema = ["owner","admin","member"]`（`packages/protocol/src/collaboration.ts:60`），作用域是 Room 而非 Server。
- `requireRoomManager`（`packages/kernel/src/collaboration-policy.ts:90`）按角色判定，**不区分 human/agent**。
- Human/Agent principal 区分、Room 成员与管理者检查、Worker 授权范围、Run/Activation 执行围栏。
- `channel-mute` / `channel-unmute` **已实现**（`packages/agent-host/src/worker-channel-attention-cli.ts`）。

缺的是：**人类可逐条配置的 per-agent scope 层**，以及 Server 级角色→具名能力矩阵。
Room 创建被 `requireHumanRoomOwner`（同文件 `:9`）限定为 Human——这是既有权限系统里的**一条规则**，
不是缺一整套系统。

### 三、当前范围要什么

12 行（8 个 `cli.raft.channel.*` + 4 条 `route.raft.*`）已登记为 `deferred: true` / `constraint: "deferred-scope"`。
非延期缺失棘轮 63 → 51。**该下降是记账，不是干活，一行都没移植**，已写入 `ratchetNotes`。
**数量下降不代表产品收口，也不能替代逐项范围判断。** 这 12 行还包含 CLI 与路由两个层面对同一决定的重复记录，
不是 12 个独立产品功能。

`cli.raft.channel.info` **不在延期之列**：它同时服务于"发现尚未加入的频道"（延期）与
"让 Agent 理解自己已加入的频道"（在范围内），后者不该被前者连带延期。为改正这一过宽裁决，
棘轮由 50 回升至 51 并写明理由——只降不升会让棘轮变成计分板。

自助档若要提前进入范围，需要单独的范围解释：非成员公开 Room 发现与多 Human 权限体验本就在已定的延期范围内。
提权档进入范围等同于移植 scope 层，属独立项目。

## 被推翻的推论（本轮最重要的部分）

| 我的说法                                     | 实际                                                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 「Agent 永远不能进私有频道」                 | **错**。有权限的 Agent 可 `channel create --private`，并被自动加入（手册 `main.js@746424`）。正确表述：不能**自行加入他人的**私有频道。 |
| 「RAH 权限模型为零」                         | **方法错误**。结论来自 grep 上游标识符名（`agentScopes`、`serverCapabilities`）命中 0。同名实现缺失 ≠ 概念缺失，见上「RAH 已有什么」。  |
| 「Room 改名从未记录」                        | **错**。`docs/architecture/raft-ui-product-integration.zh-CN.md` 已有 channel Room 的发现、创建与 causal freshness 映射。               |
| 「external 与托管同入口，故登记表矛盾」      | **比错了对象**。登记表原命题是 external 对 **Human**，该命题在 Raft 中成立。                                                            |
| 「mute/unmute 待补」                         | **已实现**。                                                                                                                            |
| 「需 owner/admin/member/guest 四个人类账号」 | **过头**。Computer 包角色矩阵只有三个角色；`guest` 仅存在于网页端客户端映射。测 Agent 权限首先要控制 Agent 自身的角色与 scope。         |
| 「契约表少报的三条包含 members」             | **措辞错误**。`channelMembers` 在契约表内（`main.js@17760`）。少报的是 create/update/add-member/remove-member 四条，数字独立成立。      |

「任何服务器角色都有 `joinPublicChannels: true`」经复核成立：三个角色均为 `true`；
另一处 `false` 是 `EMPTY_SERVER_CAPABILITIES` 全拒绝默认值，不是角色。

## 同批改正的过时登记

`ui-behavior-registry.json` 的 **B049** 由 `historical-unreviewed` 升为 `registered`，补齐 owner 与证据源。
旧备注「full reset 仍明确禁用」对两边都已过时：Raft 发货了全量重置（闸门是角色能力 `resetAgentWorkspace`），
**RAH 自己也发货了**（闸门是 daemon 能力 `agentExecutionFullReset`）。同时记下 Raft 单 Agent 的动词是
Start/Stop/Restart-Reset，**无 pause/resume**。

RAH 的 exclusive fence 与终止证明登记为 **RAH 本地机制；本次尚未找到上游对应实现**。
**不能据客户端只发一次普通 POST 就判定上游不存在排他、停止确认或恢复机制**——那些完全可能落在 Computer
内部或服务端。这正是本轮已纠正过一次的推断错误，此处不得重犯。

## 离线证据的边界

角色能力表是**客户端**副本，用于显隐控件。服务端是否独立强制 `resetAgentWorkspace`、`manageChannels`，
绕过 UI 会返回什么，以及全量重置是否真的删除工作区文件——**客户端产物一律判不了**，需要登录实测。
`raft-computer` 是 agent 侧运行时，不含任何服务端授权代码。
