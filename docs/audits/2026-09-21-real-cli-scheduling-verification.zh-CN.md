# 真实 CLI 调度与延迟补验

2026-09-21，承接[冻结基线准备](./2026-09-21-scheduling-preparation.zh-CN.md)。
用户本轮明确授权真实 CLI：Claude 用 Sonnet/low；Codex 以最后明确指定的
`gpt-5.6-luna/high` 为例外；OpenCode `deepseek/deepseek-v4-flash/low`、
Kimi `kimi-code/k3/low`。没有使用 Fable 或 GPT-6，没有静默替换模型。

## 执行范围与结果

冻结代码仍是 `9f5a83e99b6efb5efeb3dac5413d782be5100209`；未修改生产行为。
35 次 Human 提交：隔离 RAH 私聊 16 次、原生 CLI 16 次、Claude 忙时追加 3 次。
这不是 35 次模型请求：check/post/收尾各有模型生成。真实数据与脚本/原生记录哈希
见[补验证据](../evidence/2026-09-21-scheduling-preparation/real-cli-verification.json)。

RAH 与原生四家各做四轮：记住口令、不使用工具的算术、再次询问口令、简单结束回复。
明确禁止写记忆或创建 Task。32 条回答逐条校验正确；RAH 每轮恰好一个 RunAttempt、
一条回复，零 Task；四家分别保持同一 Provider session。Codex 原生 turn context
确认为 Luna/high，Kimi 的每条 llm.request 确认为 low（不是依据初始 profile 默认值），
OpenCode 持久消息为 DeepSeek Flash/low，Claude 原生响应模型为 `claude-sonnet-5`
（安装版 `sonnet` 别名解析结果），CLI 显式传 low。

首次启动夹具使用过期 `agentDefinitionId` 字段，被 API 400 拒绝；修成 `agentId`
后开始测试。那次配置失败没有发送 Human 问题、没有调用模型，原始失败保留。

| Provider / 档位               | RAH 第 1 轮回复 | RAH 第 2–4 轮中位数 | 原生第 2–4 轮中位数 | RAH 第 1 → 4 轮首请求输入 |
| ----------------------------- | --------------: | ------------------: | ------------------: | ------------------------: |
| Claude Sonnet / low           |          9.01 s |              7.61 s |              3.83 s |           40,778 → 57,744 |
| Codex Luna / high             |         26.23 s |             15.98 s |              6.76 s |           24,130 → 32,467 |
| OpenCode DeepSeek Flash / low |          4.38 s |              4.08 s |              2.11 s |           20,592 → 28,601 |
| Kimi K3 / low                 |          9.06 s |              5.78 s |             16.92 s |           31,558 → 39,719 |

时钟：RAH 为 Human 消息落库至 Agent 发帖落库；原生为子进程启动至首个完整回答事件。
原生没有 RAH standing prompt/Worker 工具，因此是开销参照，不是等价 Raft 测试。
RAH 先跑、原生后跑，账户负载与缓存没有随机化控制。每家只有三次 warm 样本，
不提供稳定 p90，也不能用 Kimi 的反例宣称 RAH 加速。

## 实测定位

### 1. 未复现“每次新开会话、每次重灌全部聊天历史”

四轮 session ID 连续，未写 MEMORY 的口令正确保留。Claude 后续 startup 工具结果
不含第一轮 Human 问题；cursor 由 0→2、2→11、11→20、20→29 推进。
这只能排除当前四轮普通私聊的该类故障，不能概括所有旧会话、故障恢复和跨 Room 场景。

### 2. 输入确实膨胀，具体来源是控制面内容进入普通交付

`workerStartupContext` 每次附完整 manifest/context；`message-check` 又复用 raw sync
renderer，非 message 事件回落到完整 payload JSON。第二轮 Claude startup 分解：
context/header 2,854 bytes、MEMORY section 135 bytes、delivery section 3,371 bytes。
九个交付事件包括上一轮的 placement.reserved、run.created、run.runtime_prepared、
run.started、run.termination_proven，以及上一条回复和新问题。

因此当前问题并非“所有历史反复注入”，而是**每轮机械元数据被转成模型新上下文**。
Raft message check 的可见输出是消息/inbox 格式，不能把本地完整 Run/Placement 收据
当成必须由模型逐次解析的内容。本文不声称这些已持久化的事实应该从账本删除。

已添加[显式 RED 复现](../evidence/2026-09-21-scheduling-preparation/reproduce-scheduling-noise.mjs)：
真实 renderer 保留问题，但也暴露内部 Runtime receipt，目标断言失败。
后续应在 application-service/AgentHost 的消息呈现边界设计有界投影，保留完整 ledger、
分页和 ACK cursor，并保留 Task/Review/InputRequest 等业务事实。不能简单过滤所有
非 message 事件或提前 ACK 未交付业务内容。legacy sync 诊断与普通 check 也应区分。

### 3. 普通回复路径大多是 check → post → 收尾，没有实测到额外确认循环

Claude、OpenCode、Kimi 四轮均为回复前两次模型决策、回复后一次；Codex 首轮回复前
三次，后三轮两次。整个 turn/init 标记不能用来计算这些次数，本次改用原生 message
ID、response_id、llm.request 及 OpenCode assistant step 取证，保留计数边界差异。

提示词 `and then acknowledge` 的矛盾仍值得修，但本轮没有证据说删除它必然让这组
问答再少一次生成。也不能承诺 Raft 普通问答只需一次生成：其 content-free wake
同样要求读取消息。

### 4. 忙时已答新输入后，仍再起一轮，真实复现

Claude Sonnet/low：warmup 后发送 B1，在运行中立即发送 B2。B2 要求只回复 B2，
因此覆盖 B1 可是合法响应，不把缺少独立 B1 回复判成丢消息。

| 运行               | 行为                                 |    耗时 | 模型响应次数 |
| ------------------ | ------------------------------------ | ------: | -----------: |
| warmup             | check → post WARMUP → 收尾           | 12.52 s |            3 |
| B1 所属运行        | check → post（hold）→ post B2 → 收尾 | 13.13 s |            4 |
| B2 后续 Activation | 再 check；无新发帖                   |  9.87 s |            2 |

B2 已于 20:28:13.043Z 发出；后续 Run 在 20:28:15.592Z 启动，25.462Z 结束。
这额外运行的首请求输入 52,764 token（包含缓存，不能当作未缓存费用）。
它不是进程启动慢，而是冻结范围外的新消息虽被当前运行处理，后续交付确认仍需要
另一次模型运行；与之前的源代码/历史门禁残留相符。

这正是要设计闭合的边界：原生“接纳输入”、业务“已回复”、交付“已确认”、Task
“义务已完成”是不同事实。不能凭发帖就删后续 Activation，但也不应长期让模型重新
运行只为重复读取。修复必须以实际有界交付证据和业务义务为依据。

**忙时夹具不是 PASS。**其最初等待条件要求 B1、B2 各有回复，与 B2 的“只回复”
冲突，所有 Run 已退出后夹具仍等待，最终超时；finally 正常关闭隔离 daemon。
保留失败，不弱化断言伪造绿色。上述运行和 token 事实来自账本及原生记录，而非该
夹具的成功标志。下一轮正式业务门禁要用无歧义的两项独立请求。

### 5. 原生计量发现了累计数陷阱

Codex exec 的 turn.completed 在这次恢复会话里输出累计 usage；把 27,023、40,600、
54,227 当成后三次请求输入会错误放大。本次改读独立 `token_usage_record.usage`，
实际为 13,534、13,577、13,627。Claude 流式片段按 message ID 去重；Kimi 保留原生
usageScope 标签，不把初始化事件数冒充模型请求数。这也是不能沿用旧结论数字而不
复核原生计量口径的原因。

## 修复顺序更新

1. 优先收缩普通 check 的技术收据投影及重复 manifest，保留全 MEMORY 与必要身份/目标信息；用字节量、模型真实输入和业务回归验收。
2. 完成忙时后续交付闭合设计，再做失败复现，避免已答消息引发只读模型重跑；保持单 lane、故障重放和 Task 义务。
3. 清理 post 后 ACK 的提示冲突，补原生计量；收益以实测为准。
4. Kimi 原生 system 接入仍需独立 spike；不靠强制会话轮换掩盖负载增长。

本次未做长会话、跨 Room 多轮、真实停止重发或同条件 Raft 在线双边速度门禁。
因此“找到可修根因”和“全面达到 Raft 性能”仍是不同结论。无需为了继续分析再请求
同一授权范围；新增修复后可沿此模型矩阵复测。

## 清理与发布边界

两个隔离 daemon 均已关闭，数据库无 starting/running Run；正式 Room、Agent 配置、
记忆和会话映射未改动。测试只新增独立 Provider sessions，原生记录保留用于复核。
未重启正式服务、未提交或推送。文档/证据修改单独格式与链接检查；此前冻结基线的
完整检查失败仍见准备报告，不能因这批真实问答成功宣称全量门禁已通过。

收尾额外观察：正式 `127.0.0.1:4173` 连接被拒绝，launch receipt 中的 PID 5120 已不存在。
本轮两个 daemon 均使用独立临时 state 与随机端口，没有向正式服务发 stop/restart；
正式进程何时、因何退出尚未定位，不能宣称其仍在线。本轮未擅自恢复正式执行队列。
