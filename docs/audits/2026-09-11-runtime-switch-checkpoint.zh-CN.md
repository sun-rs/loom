# 核心链配置切换与有序重启独立续验

前置：完整 core-chain 门禁在被公开 Room 事实污染的私有记忆负对照处失败，后半场未运行。独立 fresh-session checkpoint 随后关闭了真正 session reset 与更正后 Room B/DM 召回。本轮不重放这些前置回合，也不把旧失败改判通过。

独立测试 `packages/daemon/test/real-core-switch-checkpoint-gate.test.ts` 复用原 `real-core-chain-gate.test.ts` 的场景4与相关取证辅助，保留原始业务提示、配置接口、冻结 placement、driver argv 和有序重启判据。为了不把 completed 当成业务回复，额外要求原忙任务结论、追加文件 EXISTS、追加更正值均实际出现在正确 Agent 的 Room 消息中。旧角色与 model/effort 在启动前后必须保持，只有场景要求的 mem-a Kimi K3/high → OpenCode DeepSeek V4 Flash/low 被主动切换；steady-c 保持 Codex gpt-5.6-luna/low。

对照依据：Raft computer 1.0.18 的 runtime/profile 编辑与 session 生命周期证据见同日 runtime-bilateral-preflight；CLI/model/effort 必须从真实 driver 参数核对，不能以界面字段或 placement 单独替代。RAH 的有序 daemon 重启是本地一体化部署的恢复义务，本次不会宣称它与 Raft 服务端拓扑完全相同。

最终：真实续验 exit 1，另发现 steady-c 回复到错误 Room；模型/effort 真切换与排队追加跨重启恢复有局部正证据，不能称整项通过。针对性默认测试、typecheck、格式与 diff 检查通过。未修改产品、未操作正式实例、未提交。

主线程的独立 PRIVATE_CONTROL 已通过并退出，随后启动了本轮真实续验。现场继续使用 m5HBvq，日志 `/Users/sun/Code/reviews/rah_os/2026-09-11-busy-latency/switch-checkpoint-gate.log`。原角色配置、精确授权 model/effort 与 catalog 预检通过；其最终结果及边界见下文。主线程可将真实浏览器只读挂在此临时实例观察重启，正式实例不受影响。

## 最终结果与未收口

真实续验已结束，exit 1；失败在旧 `infrastructure floor` 只接受 exited/0 或 orphaned，未接受本次由有序 drain 超时产生的 cancelled。原结果完整保留为 `switch-checkpoint-gate.log` 与 `switch-checkpoint-evidence.json`，不放宽为任意 cancelled 都通过，不重新运行付费测试。

可核实通过的局部事实：Kimi K3/high 的旧 placement 未被改写；新 OpenCode 实际 driver 参数有 `--model deepseek/deepseek-v4-flash --variant low`，不只是 UI/配置字段。原执行者实际回复 S4 BUSY DONE；有序重启后独立追加得到 EXISTS 与 ORIOLE-2，三条无重复。

重启关联必须精确解释：取消的 `run_2e1ac6e5-582c-4b50-88a9-8902f27f071d` 是 Room B 的 room_policy Activation `activation_7938a098-c535-453d-8895-75fc0323122d`，error 明确 `daemon drain timed out after 30000ms`；同一 Activation 后续 attempt2 `run_c613cf5e-845e-4386-8278-131e223a87b0` exited/0，Activation completed。这证明该活动执行恢复，不是泛称所有取消都正常。Human CCG10 属于 Room A 的另一个 Activation，重启前排队、重启后执行一次。不能宣称“CCG10 正在执行时被打断后接续”。原门禁跨所有 Room 选择首个新 placement，命中了背景工作。

### 真实业务问题：审计回复串到旧 Room

主线程复核发现，steady-c 的 S4 AUDIT DONE 发在 Room B，而 Human CCG9 在 Room A。native Codex 证据确认：其 `run_6de87873-4b38-4491-89a6-efae8fe6b67c` 激活 Room A，`worker sync` 返回本次 CCG9（seq131），但模型显式调用 `message-post --target "#core-chain-room-b"`，hold 后又显式 send-draft 到同一错误目标。后端没有把正确 target 重定向。此前只核文件与 exit0 的4.7不能证明其他 Agent 的业务未受影响。

按主线程要求，原完整门禁与独立切换门禁均新增：steady-c 的精确审计回复必须在 Human 原 Room 且序号晚于请求。离线账本回放证明确实拒绝这次样本（`steady-target-replay.json`），没有付费重跑，也没有修改产品。

### Raft 对照与候选根因

Raft main.js675944–675965 `formatMessageLine` 每条 check 消息带 `[target=#channel/dm:…]`，并追加 reply affordance。RAH `worker-read-render.ts` 的 renderSync（489起）没有目标标题，eventLines（422起）只有 seq/msg/time/type，Thread 也仅 opaque threadId。`standing-prompt-lease.ts` 传 scope.roomId，`standing-prompt-compiler.ts` runtimeContext 仅生成 `- Room: room_uuid`，没有可直接发送的 #agent-council 地址。Codex driver119/138确实在 resume 时传入新 developerInstructions，不能说“未更新 prompt”。当前可确认的是可寻址目标呈现缺口，是否直接导致模型沿用旧 Room B 仍需复现；禁止跨 Room 发送会损害正常跨 Room 协作，不是合适修复。

关联与 native 工具白名单在 `switch-exact-associations.json`，不包含 thinking。下一步应按 Raft 已有 target 展示模式先补精确测试与工具输出，再复验正确 Room 回复；取消终态如修验收器，仅能接受有明确 provenance、同 Activation 后续恢复完成的样本。
