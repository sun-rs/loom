# Speed_test 后续核实：输入负担、有效档位与忙时追加

承接[首轮观察](2026-09-21-speed-test-pilot.zh-CN.md)。本次只有只读取证与用户授权的
Speed_test 测试消息，没有修改生产代码、Agent 配置、记忆或 Provider 会话。
结构化记录见[证据](../evidence/2026-09-21-scheduling-preparation/speed-test-followup.json)。

## 结论

RAH 有明确的额外上下文和重复读取成本，但不能把全部延迟归因于一个调度错误。
本次明确要求四人作答及随后追加独立问题，两边均全部回答；原先 Codex 不回复
泛问候的路径仍是“读到消息后选择不发帖”，不是未启动或前端漏显。

### 有效模型与档位

- Claude：两边 Sonnet 5 / low；Codex：两边 Luna / low。
- Kimi：两边原生 `llm.request.thinkingEffort` 都为 high；RAH 的 runtime 默认
  在这次调用中实际解析为 high。补齐首轮未核实项。
- DeepSeek：两边均 aihubmix/deepseek-v4.1-flash，但 RAH 原生请求携带 max，
  Raft 未指定 variant。本地 OpenCode catalog 的 max 映射 reasoningEffort=max，
  default 是空配置；没有证据证明上游默认与 max 等价。因此尚未严格对齐。

### 新增输入与累计会话必须分开

S1 Codex 首个 message-check 工具结果：RAH 15,805 字符，Raft 267 字符，
包含各自命令输出包装，不是 token 或账单费用。RAH 返回内容大致分为：

- Activation 上下文：从字符偏移 48 到 2,873，约 2,825 字符。
- 完整 MEMORY.md 段：从 2,873 到 3,436，约 563 字符，含段标题。
- Room delivery：从 3,436 起，约 12,369 字符，含尾部说明。

delivery 除了当前 Human 正文，还渲染了 activation.finished、placement.reserved、
run.created/started/finished/runtime_prepared/termination_proven 等内部事件。
本例主要新增负担并不是几百字符的 MEMORY.md，而是内部事件和执行上下文。
相关 owner 为 worker-startup-context、worker-read-render 与 worker-delivery-window；
应在模型可见投影瘦身，不能删除持久账本事件或伪造 ACK。

首请求输入（含缓存）仍是 RAH Codex 179,526 / Raft 25,959。
这个数包含此前累计会话，不能把全部差额归因于当前 check，更不能当作未缓存费用。
本次没有清空历史来掩盖负担，也未精确还原累计历史的逐 token 成因。

### 运行次数与模型请求不是同一指标

S1 RAH 有 12 次 RunAttempt，4 次产生回复，8 次未发帖。未发帖不自动等于无用。
观察窗口内原生去重响应记录：Codex RAH 10 / Raft 8，Claude 10 / 7，Kimi 9 / 6。
这些包含回复后的同伴处理，不是“回复前生成次数”，也不是稳定性能均值。
Raft DeepSeek 还委派了子会话：父会话 3 条、子会话 6 条 assistant 记录；
只算父会话会严重低估它的实际工作，不能报告“Raft DeepSeek 只有 3 次”。

RAH Claude、Codex 在前一运行工具结果中已看到 DeepSeek 的 S1 消息，后续又各有
一轮 check 读取它。读取晚于 Activation 窗口的内容并不自动确认后续窗口；
当前契约区分 read 与 ACK。应以回归测试验证可合并路径，而不是跳过后续工作，
或根据进程退出直接宣称消息已读。Raft 也有同伴唤醒和 freshness hold。

## B1/B2：后问不撤销前问

两边使用同样文本，要求每位回答 B1 43、B2 68，允许合并，明确第二题不取消第一题。

| Agent    |   RAH B1 |   RAH B2 | Raft B1 约 | Raft B2 约 |
| -------- | -------: | -------: | ---------: | ---------: |
| Claude   | 19.58 秒 | 19.36 秒 |      11 秒 |       9 秒 |
| Codex    | 15.96 秒 | 13.95 秒 |      18 秒 |      13 秒 |
| DeepSeek | 51.24 秒 | 31.12 秒 |      55 秒 |      39 秒 |
| Kimi     |  7.71 秒 |  9.94 秒 |      95 秒 |      63 秒 |

RAH 是 Human 落库到 Agent 落库，Raft 是发送点击到本机收到该回复的投递日志，
秒精度；两边页面核对全部答案可见。RAH DeepSeek 合并回答，Raft Kimi 合并回答。
Raft Kimi 工具记录出现重复 freshness hold，最终 send-draft 成功；不能删除保护
来追求这个简单算术测试的速度。

限制：RAH 两题间隔 20.116 秒，Raft 因 UI 操作间隔为 32.298 秒，不是严格同负载比较。
RAH 第二题到达时 DeepSeek、Claude 的首轮仍在执行；不能声称四位都尚未答第一题。
RAH 总共 14 次运行，观察结束均退出。本次未复测停止后重发，不据此宣布该边界通过。
测试期间其他工作流更新了正式构建；B 轮 buildId 为 2ed8e3915364c2d9，
不是把所有轮次假定为同一冻结 bundle。

## 修复准备的优先顺序

1. 先为模型可见消息投影建立测试：保留业务正文、必要变更与可追溯身份，
   默认不把内部执行事件的大块 JSON 作为聊天增量交给模型；账本与 ACK 不变。
2. 再测试已读窗口与后续 Activation 的衔接，减少重复读取；保留忙时新问题和
   失败恢复，不得从“无发帖”推导无业务义务。
3. 明确触发 Human 请求与随后同伴消息的关系，防止后者遮蔽前者；不要把所有
   普通问候改成必须回复，也不要把聊天升级成 Task。
4. DeepSeek 档位严格统一、停止后重发、相同历史规模/缓存条件的重复样本仍待验证。
   大上下文根因不能用“每个 Room 新建会话”直接代替源码对照和记忆边界设计。

本次可以指导修复范围，但不是完整性能验收；未承诺固定回复秒数或所有漏回已解决。
