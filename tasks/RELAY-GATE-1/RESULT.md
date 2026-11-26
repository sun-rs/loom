# RELAY-GATE-1

- 只读复制 pilot-2 的两条 REJECT 原文。修复前，hook Stop、Claude transcript fallback 和 OAR turn-end 的六个回放均记录了完成回合，均未生成回信。修复后每个回放只生成一条回信。信封保留原投递 ID，正文把第一条结论标签移到开头并保留原文，存档顺序保持原样。[回放原文](pilot-verdicts.json) · [失败复现](/tmp/loom-relay-gate-red.log) · [修复后回归](/tmp/loom-relay-gate-final-regressions.log)
- 三条完成路径共用回送判定。门禁及高级角色显式请求的无标签结论加「未带结论标签」后回送。纯确认和 `NOREPLY` 在回执中写明抑制原因，`loom status` 和发送者下一次实际唤醒会显示对应投递 ID。确认回执、重复回合及自动回信均通过不额外唤醒的回归。Auditor 主动请求的回复只允许经原投递记录核验后回送。
- Leader 和 Auditor 的启动提示与技能继续要求把结论标签放在首行。两条已完成的 pilot-2 记录仅用于回放。未操作 pilot-2 窗格，未提交。
- `npm test` 399 项通过，零失败、零取消、零跳过。最后补充的纯确认变体也通过定向回归。 `git diff --check` 通过。[全量测试日志](/tmp/loom-relay-gate-npm.log)

STATUS: done
