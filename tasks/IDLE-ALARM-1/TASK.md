# IDLE-ALARM-1：项目长时间无进展警报（loomd 发给 Auditor 与 Super）

用户 2026-11-27："五个小时，一个 project 没有进展，死在那里，这件事本身就应该是一个警报……应该有长时间无活动的警告，从 loomd 发出来，送给 auditor super。"
实况：pilot-2 在 13:02 向 Super 发 needs-decision 后，Leader、Auditor、worker 全部空闲 5 个多小时，无任何告警升级，Super 漏看。

## 要做
1. **停滞判定**（loomd 机械判定）：项目存在未完成工作（未处理的 needs-decision、在途/排队的卡、未收口的章程目标、未确认投递），且在 N 分钟内 Leader、Auditor、所有 worker 都没有活动（回合、工具调用、子进程活动、投递任一即算活动）。
2. **合理空闲白名单**（不报警，只在状态页标原因）：目标全部完成；Super 明确暂停（`loom pause --reason`，需新增或复用现有机制）；额度等待且有已知重置时间（到点后若仍无活动则报警）；所有角色都在等用户且该事项已通知 Super 并在重提醒周期内。
3. **分级**：停滞 30 分钟 → 通知 Auditor 与 Super（非 logOnly）；2 小时 → 紧急通知 Super，并走桌面通知通道（若已有）。阈值进 policy.json，可按项目调。
4. **待决未回复**：发给 Super 的 needs-decision 超过 30 分钟未被处理（无 Super 回复/裁决记录）→ 每 30 分钟重提醒一次，直到处理；Status 页列出"待 Super 决定"及等待时长。
5. **Status**：每个项目显示上次进展时间与停滞时长；`loom status --json` 同样字段。
6. 测试先行（假时钟）；全量 `npm test`、`npm run lint` 通过。分支 infra/idle-alarm，工作树 /Users/sun/Code/repos/loom-idle-alarm，显式路径提交，不 commit -a，不 push。RESULT.md 以 STATUS 行收尾。不往 pilot 终端输入，不读凭据，不启动 Claude。
