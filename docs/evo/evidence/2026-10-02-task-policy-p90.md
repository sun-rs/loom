# P90：双实例 Task 真实验收

结论：**未通过，不得宣布 Task 后端完整验收**。代码/部署为 `a1576c4`（记录 HEAD `468da34`），schema 80。owner 授权“开始，后端完备就靠你了”；本批 Codex gpt-6-luna / low 与 Claude sonnet（实际 claude-sonnet-5）/ low，同频道各一个连续 session。预设最多12 Run，发现异常停止，不自动补跑。实际5 Run，发现 Task 送达确认缺口后只急停本验收频道；剩余阶段未执行，没有重启或修改产品代码。

[脱敏账本与原生用量对照](2026-10-02-task-policy-p90.json)。原始有界脚本/日志留在本机 `/tmp/loom-task-p90-20261002`，输入快照复用 P89 的只读源码。频道 `room_0d9811e1-034c-4a62-affb-439a33b52401` 保留，停止后活动 Run 数为0，待处理工作在频道停止围栏下，没有删除历史。

## 覆盖与边界

- **通过**：默认关闭时 Codex 真实调用一次 `task-create` 被403拒绝，随后正常频道回复；Claude 直接审查。没有 Task、没有自唤醒，两者该轮用量与原生一致。
- **部分通过**：Human 建开放 Task；Codex `claim → start → progress → Thread post → submit` 成功，只有一个 owner。Claude 没有实际发出争抢 claim，不能称双请求竞态通过。
- 两家都进入第二轮且沿用原 session，generation 均为0。没有测试重启。
- **未覆盖**：开关开启后的自主创建、再关闭后的既有任务继续、正确成果的 Human 验收、OpenCode/Kimi Task 路径、原生同题效率对照。

## 确认问题，按优先顺序

### P1：Task 交付已落账但缺 ACK，额外启动一次运行

证据：Task `task_39802aa5-fc9a-4dce-bb59-ce092ef894cc`；seq23 `task.created`，32 claim、33 start、34 progress、35 Thread post、36 submit。Codex 原生轮正常结束，seq39 `activation.retry_scheduled` 报 `activation delivery is not acknowledged through sequence 23`。第二个 Run `run_3b559305…` 只读取帮助并 `message-check`，随后 seq46 完成同一个 Activation，无第二条业务回复。

这不能只归为模型不遵循指令：`packages/agent-host/src/wake-message-input.ts:192` 对非空 actionable 事件统一给普通 Reply context；真实 Task 唤醒因此提示顶层目标与 seq23。`worker-help-topics.ts:82` 指引 Task 流程与 canonical Thread，但未把该流程和送达确认闭合。模型 Thread post 未带显式 causal marker；`packages/kernel/src/room-kernel.ts:1964` 正确拒绝隐式 ACK；`submitTask`（同文件2532）也不确认 Activation。服务端自动补出的 Task basedOn 是服务端状态，不能冒充模型的已读证据。

**最小安全修复方向**：先为 Task 唤醒/执行建立复现测试，统一 Task 路径如何携带并确认本轮已呈现内容；保留原确认主体、Room/Run/session围栏和连续前缀，未呈现/截断仍走显式 check。不能用 task.submitted、进程退出或服务端自动推导 basedOn 直接豁免 ACK；也不要仅增加回复后的强制检查 Run。具体改动应在免费测试中证明后再付费复测。

### P1：取消 Claude 时账本漏一条用量且无缺口标记

人工止损取消的 Claude 第二轮：原生4生成、输入240,070/缓存226,993；账本3生成、输入175,420/缓存164,827，少64,650输入。`run_attempt_usage_gaps` 空。正常完成的其余4 Run逐轮吻合。已确认对账失败；是未完成生成的取消时序、聚合结束帧还是其他原因，尚不能仅凭此样本定因。至少应显示 partial/unknown，不能以没有 gap 行宣称完整。停止是验收主动执行，不是 CLI 自发失败。

### P2：Task 帮助成本及交付质量

Codex Task主轮21生成，输入505,652；含反复读取帮助和错误 `task-progress --note`、缺 progress 参数，最后才找到 `--progress`。帮助卡罗列命令名但没有近处的最小完整参数样例，接口可发现性是可优化因素；重复源码搜索和错误结论则属于业务/模型部分，不能全部计为调度成本。

Codex 第一轮正确称严格相等，第二轮却把 `node:assert/strict` 的 `assert.equal` 当成宽松相等并提交错误结论。免费原生 Node 反例确认 `assert.equal("42",42)` 抛出 ERR_ASSERTION。Task未被 Human验收，保留 submitted。验收题面“识别一个已证实问题”存在诱导强找问题的偏差，下一批改成“至多一个；无则说明”，不可用当前样本证明平台必然降低准确性。Claude当时正在核实严格比较，因本批止损被中断，不能称其已完成反驳。

## 消耗与下一步

账本：41生成/1,190,458总输入/113,780未缓存。原生诊断记录：42生成/1,255,108总输入/116,264未缓存（差异来自被取消Claude轮）。额外补确认 Run单独3生成、97,514输入、5,098未缓存。

这里“原生”指同一次 Loom运行的 CLI记录对账，**不是单独原生CLI基准组**；没有任何效率倍率或§6通过结论。下一步先修Task确认接口及取消用量完整性，精简按需Task帮助，然后仅重测此次未闭合主线。不要先铺开fork/side或正式前端。
