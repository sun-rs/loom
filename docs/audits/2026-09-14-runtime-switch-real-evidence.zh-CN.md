# 实测：原 Agent/Room 修改模型、强度与 Provider

用户在本次会话明确授权真实 Opus High → Sonnet Low，并要求随后切换 Provider。
第三轮采用既有授权矩阵的 Codex `gpt-5.6-luna` Low。本次未使用 Fable，也未做模型回退。

## 方法与结论

使用 prepareLocalWorkbench + DaemonApplication 创建隔离本地工作台与测试 Agent，
通过正式 `/v3/client/agents/manage` configure 接口提交配置，经 Room 消息、Activation、
Placement、RunAttempt 和真实原生适配器执行。每轮等前轮执行结束后，在同一个
Agent Council Room 向同一个 Agent 发下一条消息。未修改用户正式 Agent/Room。

| 轮次 | 配置                       | 原生历史实测                                            | 执行结果                |
| ---- | -------------------------- | ------------------------------------------------------- | ----------------------- |
| 1    | Claude `opus[1m]` + high   | assistant.message.model=`claude-opus-5`；effort=`high`  | 正常退出，频道回复2+3=5 |
| 2    | Claude `sonnet` + low      | assistant.message.model=`claude-sonnet-5`；effort=`low` | 正常退出，频道回复3+3=6 |
| 3    | Codex `gpt-5.6-luna` + low | turn_context.model=`gpt-5.6-luna`；effort=`low`         | 正常退出，频道回复4+3=7 |

第一、二轮进入同一个 Claude session JSONL：第19–45行含10条 Opus/high assistant
记录，第54–68行含6条 Sonnet/low记录。不是新建Room后碰巧使用新模型，也不是
采信Agent自报。第三轮进入Codex自己的会话，原生turn_context第6行证明模型/强度；
Agent身份、Room ID与运行工作目录保持同一归属。

结论限于本次验证条件：**空闲时保存配置后，下一次新调度执行会使用新的模型/强度；
换Provider也会在下一轮使用新Provider。**这不等于改变当前正在思考的执行，也不等于
两个Provider共享各自的私有会话/隐藏思考。没有验证忙时修改或跨Provider私有上下文转移。
这是生产链路的隔离真实CLI验收；没有声称对正式用户数据做了试验或官方Raft双边比较。

## 可追溯证据

摘要：`/Users/sun/Code/reviews/rah_os/2026-09-14-runtime-switch/observations.json`，
包含每轮runAttemptId、时间、Placement.resolvedModel、原生文件路径/行号/SHA256及三条回复。
Claude文件为 `257180d4-0f14-43a4-ab62-95088ab3d921.jsonl`；Codex文件为
`rollout-2026-09-14T11-20-58-01a09dee-a60d-7912-a1ad-37d7337e1443.jsonl`。
完整隔离状态在 `/tmp/rah-runtime-switch-real-VQIHOD/state`，含认证材料，不作为公开附件。
实验脚本位于 `/tmp/rah-runtime-switch-experiment.mjs`，实验结束已停止隔离daemon。

预检时目录不含字面`opus`，随后使用目录实际发布的`opus[1m]`；一次隔离初始化试图
手动加入系统#all被规则拒绝，改用隔离Agent Council频道。两次准备失败均未执行付费轮次。
