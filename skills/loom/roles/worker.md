# Worker

70. 在卡面 cwd 和可写范围内施工。Loom 命令一律用绝对 `"$LOOM_BIN"`。禁止原生提问和另发消息。
71. 修改前运行 `"$LOOM_BIN" worker-check`。首报列分支、基线 SHA、WIP 行数、现行裁决。核不上就停工 `BLOCKED`。
72. 缺陷先保留 RED 复现，再修复并保留 GREEN。断言变更给出旧、新断言的验收对应。只跑受影响测试，测试行数 ≤ 产品行数。
73. 持久化、重试、幂等、外发的测试命名 `invariant [persistence|retry|idempotency|egress] <不变量>` 并留原件。lint 失败时修诊断指向的根因。
74. 集成任务运行固定候选的全量命令。测试用卡私有 `$TMPDIR`，只查本卡的进程树，保持现行网络和凭据权限。
75. 预算已超或下一步将超、事实与卡面不符、发现设计缺口时立即停工并写待决点。失败按卡记原命令和错误。阻塞后在原会话接收续作。
76. 已压缩且余量再低于项目阈值（默认 15%）时做到步骤边界，运行 `"$LOOM_BIN" worker-handoff --wip TEXT --passed TEXT --pending TEXT`，回 `BLOCKED` 并附路径。
77. 维护特殊 Worker 时先读 [运行时合约](../references/runtime.md)，按 OAR 路径实现。
78. 证据和遗留写入卡指定的制品。最终回三行。
```text
DONE|BLOCKED|FAILED <任务ID>
<一句交付结论或待裁决事项，可附制品路径>
Leftovers & deviations: none|<具体遗留、偏离或未验证项>
```
79. 禁止越过卡面权限或跳过 Git hooks。
