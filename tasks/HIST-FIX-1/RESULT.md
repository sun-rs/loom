# HIST-FIX-1

- Claude TUI 的后台 Bash 使原生 Stop 标为暂停。loomd 保留原投递回执，按工具 ID 或任务 ID 将 task-notification 的最终轮关联回原投递。agy 的 `fullyIdle:false` Stop 留在事件流中，巡检显示后台进行中。
- `--expect-reply` 和 Reviewer 回送仅投递带结论首行的回复，门禁支持明确的裁决正文。确认、等待及 `NOREPLY` 保存在历史。Leader 和 Auditor 的提示及仓库 Loom 说明把耗时工作交给 Worker 或 Reviewer。
- 证据和门禁分别统计断言删除与改写。测试先行卡可在 `.project/evidence.json` 设置 `tasks.<card-id>.expectRed`。历史按命令分别显示测试序列和退出码，并关联 agy 后台任务结果、嵌套 exec 和无头 OAR 轮末证据。
- 超长回复保留全文，通过带 SHA-256 的回复文件指针送达。回归用 25,702 字符的 agy Reviewer 回复检查了正文、指针和摘要。
- 升级预检以异步 `ps -p` 核验目标 PID，对暂时失败进行有限重试。持续超时返回可重试原因，现行 release 保持服务。清理宿主子进程需要枚举进程树，执行前仍核验归属。

## 原生验证与审计回放

以绝对路径运行 Claude Code 2.1.331，使用隔离 HOME、PTY 和仅可访问 loopback 的模拟 API。第一次原生 Stop 对应的回执只有收件状态。释放模拟后台 Bash 后，第二轮的 PASS 正文结算到同一个投递。集成测试验证该结论仅回送一次。原生验证记录保存在 `/tmp/loom-hist-native.DMBbWn/verify-final.log`。

只读回放 pilot-2 的原生记录。三个 Claude 暂停轮均与后续结论关联。T6 的基线 4/4 及红测退出码分开显示，嵌套工具无悬空。T13 的基线有独立记录时可核实，只有汇总时标为待证。L3 的后台测试恢复为 399 通过、0 失败。8f1d01d6 的 27 个工具均有终态，轮末 Git 证据可用。

`npm test` 通过 360 项，失败和跳过均为 0。`git diff --check` 通过。

STATUS: done
