# Raft 与 RAH OS 正式频道短问答验收

日期：2026-09-17，Asia/Shanghai。用户明确授权使用双方现有近似模型进行付费实测。
本轮是正式产品上的端到端观察，不是同模型、同推理强度的受控性能基准。

## 结论

RAH OS 三个问题获得 12 条正式 Agent 回复，均在频道显示，刷新后仍可见；未复现
OpenCode 只有动态而没有正式回复的问题。Raft 的 Alice、Kimi 得到 6 条正式回复；
ParityTaskCodex0911 报账号额度耗尽，无法完成有效 Codex 双边计时。
日期和计算结果均正确，但本地 Kimi 和首轮 Codex 延迟仍明显，不应宣布性能验收通过。

## 环境与测量边界

双方新建 `latency-0917` 频道，保留历史证据，没有清空 Agent 记忆或修改模型配置。
RAH OS 邀请现有四个 Agent；Raft 邀请 Alice、Kimi、ParityTaskCodex0911，未调用 Fable。
每轮消息要求各回答一次、不回应其他 Agent、不建任务、不改文件或记忆。
三轮发送时间分别约为 11:51:07、12:02:48、12:06:07；两侧发送相差不到一秒。
本地每轮下一题发送前均确认前一轮没有活跃 RunAttempt。

| 对象     | RAH OS                                       | Raft 当前配置                                     |
| -------- | -------------------------------------------- | ------------------------------------------------- |
| Codex    | `gpt-6-astra` / low                          | ParityTaskCodex0911：GPT-5.6 Luna / Low，配额错误 |
| Kimi     | `kimi-code/k3` / low                         | Kimi：K3 / 默认                                   |
| OpenCode | `iiiiitoken/gemini-3.8-flash-high` / default | Alice：`deepseek/deepseek-v4-flash`               |
| Claude   | `opus[1m]` / high                            | 当前没有相应测试成员，未进行双边对比              |

Raft 资料页的实际 Computer 版本是 **1.0.18**，不能将这次实测称为 Computer 1.0.32
验收；此前的 1.0.32 发布源码对照是另一份证据。
RAH OS 实测进程 94321 于 11:33:46 启动，早于全部测试；结束时 health 的
buildIdentity 为 `49c1ff86394af587`，builtAt `2026-09-17T03:27:26.643Z`。
本轮没有重启服务、修改生产代码、提交或推送。

RAH OS 耗时来自持久化 `messages.created_at`：Human 正式消息到对应 Agent 正式消息。
浏览器另行核对实际显示及刷新恢复，不将 stdout、thinking、工具结束或进程退出当作回复。
Raft DOM 只有分钟级时间，没有秒级 `datetime`；下表使用发送时刻、可见时间分钟区间及
前后采样交集，向外取整为保守区间。首两轮采样稀疏；第三轮采用两秒采样，但 Kimi
到达所在时段仍有采样间隙。因此不能把区间中点当作实测精确值，也不能据此计算吞吐比。
两侧成员数、角色说明、已有 session、私有记忆和供应商线路均未配平。

## 时间与回答

单位：秒。A 为一句问候，B 为北京时间日期与星期，C 为 `17×19`。

| Agent / 平台          |   A 问候 |   B 日期 |   C 算式 |
| --------------------- | -------: | -------: | -------: |
| OpenCode / RAH OS     |   46.213 |   48.389 |   37.256 |
| Alice / Raft OpenCode |     0–53 |     0–13 |    10–13 |
| Kimi / RAH OS         |  217.483 |   62.937 |   97.620 |
| Kimi / Raft           |   56–113 |    12–42 |    22–54 |
| Codex / RAH OS        |  407.276 |   25.408 |   52.876 |
| Codex / Raft          | 配额不足 | 配额不足 | 配额不足 |
| Claude / RAH OS       |   31.686 |   30.486 |   22.027 |

回答摘录：

- A：Raft Alice 为“A — 大家好，我是 Alice，在此问好。”；RAH OpenCode 为
  “@Hakase 你好，我是 @OpenCode，已就位参与延迟验收 A。”。其余也各正式问候一次。
- B：两边已回复的 Agent 均回答 `2026 年 9 月 17 日，星期四`，正确。
- C：两边均算出 `323`。RAH Kimi 回复“C：17×19 = 323。”，答案正确，但比
  “只回复 C 和计算结果”的格式要求多了算式。

Raft Codex 明确显示 `You've hit your usage limit`，提示 9 月 19 日 21:14 再试。
这属于实测阻塞，不计作零秒或无限响应时间。后两轮频道仍有该成员，没有绕过额度或
修改其账号、模型及权限。完整问题、答案、消息 ID 和时间在下方证据中。

## 慢在哪里

1. **本轮本地排队不是主要耗时。** 每题四个 RunAttempt 都在 Human 消息落库后
   0.193–0.258 秒启动。Codex/Kimi/Claude 的模型请求信号在 1.172–2.150 秒出现。
   OpenCode 当前诊断没有同名精确起点，不能补填成相同数值。
2. **首轮长时间位于模型请求之后、第一段输出之前。** Codex 从模型请求
   11:51:09.955 到首段可见诊断输出 11:57:26.102，相隔 376.147 秒；Kimi 从
   11:51:09.040 到第一条 thinking-started 信号 11:54:02.799，相隔 173.759 秒。
   这定位到 Provider 请求/恢复及首输出链路，尚不能区分服务端排队、网络、上下文处理
   或 adapter 缓冲，不能仅凭无输出就认定是“模型在思考”。Codex 第二题降到 25 秒，
   也说明不是固定的频道调度延迟。
3. **真实新消息仍会带来发帖前再读。** 日期题中 Claude、OpenCode 的草稿等待分别
   对应刚到达的 Codex、Claude 回答；它们读过新增内容后正式发帖。这与之前没有新消息
   却重复 hold 的 bug 不同。不能为省时间而跳过 causal freshness barrier。
4. **存在额外执行成本。** 三轮共 35 个 Activation/RunAttempt，均 `room_policy`、
   `attempt_count=1`、最终 `completed/exited`；只有 12 条 Agent 正式回复。其余
   23 次是其他 Agent 发言触发的后续检查，未重复发帖，不能误称为 23 次失败重试。
   例如 OpenCode 第一轮回复后，再读取 Claude 的回答并退出。是否压缩这种唤醒应先
   对照 Raft 的参与策略，由 Kernel owner 处理，不能在 adapter 屏蔽事件。

## 验收范围与下一步

- 正式频道端到端：RAH OS 12/12 正式回复，Raft 非配额阻塞成员 6/6；浏览器刷新后
  重新读取并检查截图。本轮 RAH 频道无任务创建，结束时无活跃 RunAttempt。
- 只验证这三次短请求没有出现 OpenCode 无正式回复的问题。OpenCode 请求没有超过
  五分钟，不能把本轮当作长 HTTP 请求超时回归的替代；该项仍以隔离测试为依据。
- 无本次新增源码变更，因此不重复运行全套单元测试、构建或重启。未宣称 iPhone、
  所有任务/记忆功能、同条件吞吐或 Raft Computer 1.0.32 已获本轮验收。
- 优先补足 Provider 首输出等待的阶段诊断与失败可见性，再调查无须回复的额外运行。
  Kimi 两边最接近但 reasoning 仍不同；OpenCode 的 Gemini 与 DeepSeek 差异更大。
  本轮证明现有配置的体验差异，不能证明换成同一模型后的框架净开销。

## 证据

- [结构化计时与消息证据](../evidence/2026-09-17-bilateral-latency.json)。只含测试频道
  消息、阶段信号和配置，不保存私有记忆正文、凭据或完整 thinking。
- [Raft 正式测试频道](https://app.raft.build/s/hakasemac/channel/13ffb5e2-7fd6-44e1-826a-96f1256605b3)。
- [RAH OS 正式测试频道](http://127.0.0.1:4173/?room=room_8166b286-41de-408f-bddc-2117f85516fc)。
- 本地完整采样、只读导出脚本及截图：`scratchpad/2026-09-17-bilateral-latency/`。
- [此前交付与超时修复](./2026-09-17-reply-delivery-and-opencode-timeout-repair.zh-CN.md)。
