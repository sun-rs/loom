# P91：Task 修复后的双实例真实验收

**部分通过，整体验收失败。** P90 的提交后补 ACK 运行没有复现；但跨轮继续
已领取任务，被旧的 Activation 范围校验拒绝。本批按异常即停结束，无补跑。

授权：owner「同意测试」，Codex gpt-6-luna / low 与 Claude sonnet / low 各一个
实例，总计最多 8 Run。实际 5 Run；产品 c0fad75，部署记录 4ba36ec，schema 80。
原生记录核实四个 Codex turn_context 均为 gpt-6-luna / low；Claude 实际解析为
claude-sonnet-5 / low。测试频道已急停，5 Activation 均 completed，无运行中工作。
[脱敏证据](2026-10-02-task-policy-p91.json)含命令、事件、Task、任务消息列、用量与范围复核。

| 场景                  | 真实结果                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| 默认不允许实例创建    | Codex 一次真实 task-create 得到 403，无 Task、无重试                                                    |
| Human 建开放 Task     | 两实例被唤醒；Codex check→claim→start→核验→progress→submit，单 Run 完成且无 ACK 补跑                    |
| 交付质量与 Human 验收 | Node 实验确认 assert.equal("42",42) 在 node:assert/strict 下抛错，结论正确；Human 已完成任务            |
| 另一实例是否重复处理  | Claude check 后读到 submitted，没有接管或重复执行；未实际同时竞争 claim，不能宣称竞态覆盖               |
| 开启实例创建          | Codex 创建并指派自己 task #2，按要求等待下一条 Human 指示                                               |
| 关闭后继续已有 Task   | Codex task-get 与实际核验成功，progress/submit 均因不在本次 Activation 范围被 403 拒绝；Task 仍 claimed |

## 确认的阻断原因

`packages/kernel/src/worker-task-scope.ts:10–111` 的 requireWorkerTaskDelivery 仅认：
当前 Activation 的 fromSeq..toSeq 内，发给本实例的 Task 事件/Task 源消息；
或者本 Run 刚创建的 Task。它不认同一实例在上轮创建并领取、本轮再次读取的旧 Task。

本例创建 task #2 的 Run 范围为 35..35，Task 创建事件在 #40；后续 Human 明确要求
继续 task #2 的新 Run 范围为 47..47。当前 runAttemptId 与创建时不同，所以两个入口
都不成立。只读调用该函数复核：Task #1 原运行允许、Task #2 创建运行允许、Task #2
续办运行拒绝，与真实 403 一致。该函数不读取 allowInstanceTaskCreation，故不能
把失败归因于关闭创建权限。`task-get` 已在 activation_task_reads 留下读取记录
（activation-task-reads.ts:36–44），现有写范围检查不使用它。

这是生命周期缺口，不能用删除执行范围校验、把所有可见 Task 一律放行解决。下一步
应先用免费回归复现“同频道已有负责人跨轮续办”，设计最小的持久任务授权/当前执行
证据衔接；保持 Room/私聊边界、所有者、撤销/取消、basedOn 与执行围栏。明确任务
线程入口与普通频道中指令的授权语义，不让自然语言解析器充当鉴权。

另一个独立事实：Codex 本轮漏了 task-start，直接 progress/submit；即使解除范围
拒绝，也尚未证明状态转换会成功。不能把模型流程遗漏与平台拒绝混为一谈。

## 用量与限制

| 运行               | 生成数 |  总输入 | 未缓存输入 | 运行秒数 |
| ------------------ | -----: | ------: | ---------: | -------: |
| Codex 默认关闭探针 |      5 |  60,016 |     14,960 |     21.3 |
| Codex Human Task   |      9 | 133,237 |     10,613 |     32.3 |
| Claude Task 通知   |      5 | 206,358 |     44,811 |     87.4 |
| Codex 自主创建     |      4 |  78,140 |      6,460 |     12.8 |
| Codex 关闭后续办   |      6 | 133,536 |      6,048 |     32.5 |
| 总计               |     29 | 611,287 |     82,892 |        — |

5 Run 逐轮账本与原生 transcript 相等，零 gap、零自身 Inbox、零 activation retry。
Codex 四轮保持同 session；Claude 只有一轮，未覆盖其续聊。本批没有取消生成，所以
未真实触发 P90 的中断缺口修复；该分支证据仍为免费驱动测试。无同题原生独立对照，
不宣称效率预算通过，也不把与 P90 的数字变化归因为某一修复。

仍可见 CLI 使用成本：Codex 首轮重复探测 help，Claude 首次 task-get 参数错误后
读帮助纠正。这些没有产生额外 Run，但仍增加生成数。暂不继续增加提示词或付费实验。

测试脚本首次 Human task.complete 带了已不接受的 roomId，被 SDK 本地校验拒绝，
未发送 HTTP；去掉该字段后同幂等键成功，没有新增模型调用。产品代码和服务未改。
