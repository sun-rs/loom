# 核心链验收第 1 次真实运行

日期：2026-09-10。协议：`docs/product/core-chain-acceptance-protocol.zh-CN.md`。
门禁：`packages/daemon/test/real-core-chain-gate.test.ts`（`RAH_CORE_CHAIN_GATE=1`）。
隔离实例，未触碰正式库。保留现场 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-core-chain-XenNDU`。
耗时 930 秒。Agent：mem-a = Kimi `kimi-code/k3` high，mem-b = OpenCode `deepseek/deepseek-v4-flash` low，
steady-c = Codex `gpt-5.6-luna` low，均按 AGENTS.md 授权矩阵断言、无回退。

## 结论

| 场景 | 结果 |
|---|---|
| 二 · 跨 Room 协作与跨 Room 记忆 | **通过** |
| 三 · 私聊延续 | **通过** |
| 五 · 记忆正反对照 | **通过** |
| 四 · 配置切换是否真的落到底层 | **不成立（预算耗尽，非产品缺陷）** |
| 一 · Room A 多 Agent 协作 | 未在本门禁重跑，已由三个付费门禁与三条确定性链覆盖 |

## 场景二：跨 Room

Room B 只有 mem-a 与 steady-c，mem-b 不在。`inbox_items` 与 `activations` 中 mem-b 对 Room B 事件零投递，
参与范围成立。消息归属正确：Room B 的回复 `messages.room_id` 均为 Room B。

跨 Room 记忆（模型原话）：

> [CCG-2] S5 项目代号是 ORIOLE-1。这是我从自己的持久记忆（notes/facts.md）中读到的，最初是你在 #agent-council 告诉我的（CCG-1）。

上下文归属正确：steady-c 在 Room B 被问"mem-a 刚才在本房间说了什么"，答出了 mem-a 在**本房间**的那句，未串到 Room A。

## 场景三：私聊延续

`direct_room_pairs` 建立，DM 消息 `room_id` 为 DM Room。私聊中 mem-a 既调用了 Room 里形成的记忆，又存下只属于私聊的口令：

> [CCG-4] 1) S5 项目代号是 ORIOLE-1，从我自己持久记忆的 notes/facts.md 读到（最初是你在 #agent-council 的 CCG-1 告诉我的）。2) 已把"S3 私聊口令 CANARY-S3-7741"存入同一份记忆并确认已存。

回到 Room A 后能带回私聊里形成的记忆，并正确标注来源：

> [CCG-5] S3 私聊口令是 CANARY-S3-7741（你在私聊 CCG-4 中告诉我的，存于我的 notes/facts.md）。

## 场景五：记忆正反对照

**反向对照（最关键的一条）**：mem-b 被要求说出两条只属于 mem-a 的信息，明确表示不知道且不猜：

> [CCG-6] 我不知道 S5 项目代号，也不知道 S3 私聊口令。我的记忆中没有任何笔记或相关事实，也没有人告诉过我这两条信息，所以我不猜。

文件系统佐证：`CANARY-S3-7741` 只出现在 mem-a 的记忆目录，mem-b 目录中不存在。

**更正后召回**：CCG-7 在 Room A 把 ORIOLE-1 更正为 ORIOLE-2；CCG-8 在 **Room B** 追问，答案已是新值且旧值被标记作废：

> [CCG-8] S5 项目代号当前值是 ORIOLE-2，从我自己持久记忆的 notes/facts.md 读到；旧值 ORIOLE-1 已按你在 #agent-council 的 CCG-7 更正标记为作废。

即更正在一个 Room 发生，跨 Room 生效。

## 场景四：为何不成立

唯一失败的断言是 4.3"切换后应出现解析为新模型的 RunAttempt"。核实时间线：

- mem-a 最后一次 placement：`16:37:38.312Z`，解析结果 `kimi-code/k3 / high`
- 切换事件 `agent.configured`（definition `83fcce3c…`，即 mem-a）：`16:38:09.059Z`
- 随后 15 分钟预算耗尽，账本终态为 1 个 leased、4 个 queued

切换本身**已正确写入**（mem-a 有 4 个修订，其余两个各 3 个），但它落在最后一次调度之后 31 秒，
运行结束时根本没有产生任何"切换后的 RunAttempt"。**该断言不可能被任何实现满足，属于验证器排序缺陷，不是产品缺陷。**
结论：本次运行既不能证明配置切换真的落到底层，也不能证明它没有。需按下节修正后重跑。

## 待修（验证器，不是产品）

1. 切换步骤必须前移，保证其后至少有一次完整的 RunAttempt 落在预算内；或将默认超时提高到足以容纳切换后的一轮。
2. 4.4 现场 `ps` 抓 argv 本次未取到窗口，同样因为切换过晚。
3. 三次真实 CLI 的回合各自耗时高于预估，10 轮 Human 消息在 15 分钟内偏紧。

## 边界

- 场景四与五的"正式实例"部分不在本门禁范围，本门禁只跑隔离实例。
- 4.10（重连与新建 RunAttempt 的分支）未断言，已由 `process-recovery-integration.test.ts` 确定性覆盖。
- 依赖模型自述才能判断的行（2.9、3.6、3.8、4.11、5.4、5.9、5.10）按协议只作观察不作断言，本文引用的原话即观察结果。
