# PROMPT-STATE-1

四款原生 CLI 共完成 12 格实机测试。粘贴均未进入聊天输入框。Claude 和 Codex 可把同一段粘贴写入答题区，OpenCode 模型选择器会把它写入搜索。单独的 Enter 可确认审批、提交答案或选择菜单项。原生版本、屏幕与事件证据见 [实机矩阵](../../docs/research/2026-11-25-tui-prompts.md)。

`loom status` 首屏和 `loom ls` 显示 `awaiting-approval`、`awaiting-choice`、`picker` 和 `overlay`，附起始时间、CLI、信号来源、最多 120 字的题干和可核实的选项数。Claude 使用 Notification 和工具 hooks，Codex 使用 app-server 请求和 TUI 画面，agy 使用已绑定的问题 hook 和画面，OpenCode 使用事件流和画面。提示投影只保存题干和选项数。OpenCode 实机回放确认审批和问答都能从事件流建立和清除状态。

等待提示期间，投递保持排队并标为 `target-awaiting-user`。在提示出现后的每个写入边界复查，包含首次粘贴与再次 Enter。Leader 逾时通知 Auditor，Auditor 逾时进入 Super／用户的通知账本。审批或问答的桌面通知附角色和题干，同一提示去重。回归验证过期前不通知、过期后只通知一次，并在提示结束后恢复投递。

`roles.<role>.allowNativeQuestions` 默认关闭。Claude 和 OpenCode 在实机请求中移除了问答工具，Codex 在 Default 模式拒绝其调用，agy TUI 用启动时挂载的 PreToolUse hook 拒绝其执行。四款 CLI 此后都完成了回合。Codex 0.171.0 允许操作者手动切入 Plan，届时原生问答仍受 Loom 识别和投递守卫。agy ACP 仍可列出问答工具，隔离试验中的强制调用未要求用户操作并完成了轮次。角色启动提示与 Loom 技能说明通过 `notifications --needs-decision` 提交选项文件，继续其余工作，经普通投递取答复。

四款 CLI 的原生 OAR 回合均执行了模拟模型发起的无害 shell 工具并取得最终回复。OpenCode 的 ACP 审批由 OAR 当轮回答。所有实机探针运行在隔离 HOME，模型仅走回环地址。pilot-2 窗格未收到测试输入。

`npm test` 383 项通过，零失败、零跳过。`git diff --check` 通过。改动已回到 `loom_new`，PROMPT-STATE-1 未提交。[全量测试日志](/tmp/loom-prompt-npm-final.log)

STATUS: done
