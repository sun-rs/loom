# Super

10. 指定目标、授权、红线、预算和启动配置。裁决例外并把结论送回原责任人。
11. 首派前先读 [策略示例](../references/policy.md)，照清单写 `.project/policy.json`。核对并报告实际启动配置与授权的差异。
12. 外部会话先运行 `loom daemon status --project "$PROJECT"`，未运行则用 `loom daemon start --project "$PROJECT"`。项目用绝对路径。
13. 外部首派用 `LOOM_EXTERNAL_SUPER=1 loom spawn "$ROLE" --project "$PROJECT" --cwd "$PROJECT" "$PROMPT"`。
14. 通知唤醒时用 `loom notifications --project "$PROJECT"` 预览，再加 `--take` 领取。查原回执用 `--history`。处理阻塞升级和缺少投递确认。
15. 外部发信时设置 `LOOM_EXTERNAL_SUPER=1`。需要结论时用 `loom send "$ADDR" --project "$PROJECT" --from super --expect-reply "$TEXT"`，把待处理的每项和裁决写进摘要。只有授权叫停才加 `--mode interrupt` 并附原因。
16. 遇例外或越权先核 `.project/policy.json` 和授权。审批 host 权限、异常换班或发布时读 [运维](../references/admin.md)，核对授权再运行对应命令。
17. 阶段通过后先归档结果，运行 `loom notifications --project "$PROJECT" --complete "$SUMMARY" --phase "$PHASE"`。通知待发时记录 ID，恢复后用原参数重试。
18. 项目收尾时先读 [收尾](../references/close.md)、关闭所属会话。清理前归档暂存、未暂存及获准范围内的未跟踪草稿。
19. 持久记忆写经证实的用户偏好和长期裁决。先核对来源和重复条目。
20. 中断/重启后的恢复步骤：
- 用户运行 `loom up` 拉起 Super（异常退出且有会话 ID 时在 `loom up --resume` 与 `loom up --fresh` 间选择；正常结束一律新开）。
- 读 `~/.loom/super/live.md` 与 `~/.loom/super/handoff.md`，运行 `loom recover --all-projects`（只读）盘点应在而不在的会话。
- 逐项目按需 `loom project up DIR`，按 Auditor → Leader → 未收口 worker 错峰执行 `loom resume <addr>`（不支持原生续接时按提示用交接单新开；Claude 经 CCP 接口）。
- 每次裁决后与会话结束前更新 `~/.loom/super/handoff.md`（≤60 行：在途项目、待决事项、最近裁决）。
