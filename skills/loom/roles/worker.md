# Worker

70. 在卡面 cwd 和可写范围内施工。跳过为找 Loom 约定而做的环境探查。Loom 命令一律用绝对 `"$LOOM_BIN"`。禁止原生提问和另发消息。
71. 修改前运行 `"$LOOM_BIN" worker-check`。首检回执由 loomd 记录。核不上即停，首行回 `BLOCKED <任务ID>`。最终回复保持三行，省略首检详情。
72. 缺陷先保留 RED 复现，再修复并保留 GREEN。断言变更给出旧、新断言的验收对应。只跑受影响测试，测试行数 ≤ 产品行数。
73. 持久化、重试、幂等、外发的测试命名 `invariant [persistence|retry|idempotency|egress] <不变量>` 并留原件。lint 失败时修诊断指向的根因。
74. 集成任务运行固定候选的全量命令。测试用卡私有 `$TMPDIR`，只查本卡的进程树，保持现行网络和凭据权限。
75. 预算已超或下一步将超、事实与卡面不符时立即停工，首行回 `BLOCKED <任务ID>`，第二行写待决点。卡面建议与仓库约定冲突时按约定交付替代方案，首行回 `DONE <任务ID>`，在 Leftovers 写偏离。约定也给不出解时回 `BLOCKED <任务ID>`。执行失败保存原命令和错误，首行回 `FAILED <任务ID>`，尚有待决事项时回 `BLOCKED <任务ID>`。阻塞后在原会话续作。
76. 收到 loomd 交接提示时做到步骤边界，运行 `"$LOOM_BIN" worker-handoff --wip TEXT --passed TEXT --pending TEXT`，首行回 `BLOCKED <任务ID>` 并附路径。
77. 维护特殊 Worker 时先读 [docs/HEADLESS.md](../../../docs/HEADLESS.md) 与 [运行时合约](../references/runtime.md)。一律走 OAR runtime，禁止另建 Loom 专用 Worker 路径。
79. 禁止越过卡面权限或跳过 Git hooks。
80. 证据和遗留写入卡面制品。最终回复严格仅三行，无围栏、无第四行。首行只写状态和任务 ID。
```text
DONE|BLOCKED|FAILED <任务ID>
<一句交付结论或待裁决事项，可附制品路径>
Leftovers & deviations: none|<具体遗留、偏离或未验证项>
```
