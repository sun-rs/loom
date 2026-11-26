# HOOK-CWD-1

Claude TUI hook 按绑定的原生会话 ID 归属事件，排除子代理，记录实际 cwd。新建托管会话通过 `.project/loomd/hook.mjs` 调用采集器。shim 保留原参数，从已生效的 `release.json` 选取实现。独立的原生 Claude 2.1.331 在 `cd` 后通过 shim 保存了 PostToolUse 和 Stop。升级指针回归用同一组参数调用了另一版实现。[Claude 原生记录](/private/tmp/ps1-j803an/claude-approval/hooks.jsonl)

Codex 的启动 hook 保存原生 cwd，下游按会话 ID 对账。OpenCode 导出原本就核验原生会话 ID。agy 在首次根调用时绑定会话，此后按该 ID 捕获事件。隔离的 agy 1.5.17 执行 `cd` 后正常发出 `fullyIdle:true` 的 Stop，采集 hook 的 cwd 仍是 hook 工作区，因此此路径不需要 transcript 兜底。[agy 原生记录](/private/tmp/ps1-BYtNvz/agy-approval/hooks.jsonl)

Claude 根 transcript 有最终答复、轮末证据和全部工具结果，且无待完成的后台任务时，loomd 可补齐缺失的 Stop，并在状态显示 `hook-gap`。pilot-2 部署 `bf653b5b` 后 Auditor 自行恢复。账本记录了 `d8f90c12` 的原生收件时间 `2026-11-26T04:21:01.533Z`。补充回归覆盖旧 hook 同时漏掉 UserPromptSubmit 的情况。用同一轮的原生用户标记及轮末只读回放，得到 `04:21:19.896Z` 的回复完成证据。全程未向 pilot-2 窗格发键。

`npm test` 381 项通过，零失败、零跳过。`git diff --check` 通过。回归使用保留行序、时间戳和 cwd 变化的脱敏原始记录。[回归夹具](../../runtimes/tui/fixtures/hook-cwd) · [测试日志](/tmp/loom-hook-cwd-1-npm-complete.log)

## 文件归属

- HOOK-CWD-1 第 3 项首批部署文件为 `adapters/claude/parse.mjs`、`cli/status.mjs`、`daemon/supervisor.mjs`、`inbox/inbox.test.mjs`、`inbox/tui.mjs`、`relay/sources.mjs`、`tui/native.mjs`、`tui/pty-control.test.mjs`、`watch/watch.test.mjs`。
- HOOK-CWD-1 余项改动在 `adapters/agy/{adapter.test,capture-hook,hook-binding,launch}.mjs`、`adapters/claude/parse.mjs`、`adapters/codex/hook-capture.mjs`、`daemon/{hardening.test,tui}.mjs`、`docs/PROTOCOL-v2.md`、`inbox/tui.mjs`、`relay/sources.mjs`、`runtimes/tui/{capture-hook,codex-start,hook-cwd.test,hook-shim}.mjs`、`runtimes/tui/fixtures/hook-cwd/`、`tui/{agy-activity-hook,native,providers}.mjs`。
- PROMPT-STATE-1 的暂停快照包含 `adapters/agy/{capture-hook,hooks,screen}.mjs`、`adapters/claude/{hooks,screen}.mjs`、`adapters/codex/screen.mjs`、`adapters/opencode/index.mjs`、`adapters/prompt-state.mjs`、`inbox/{engine,tui}.mjs`、`runtimes/tui/capture-hook.mjs`、`tui/{agent-status,agy-activity-hook,index,native,providers}.mjs` 和实机矩阵。`loom_new` 中的 HOOK-CWD-1 差异未混入这一快照中的改动。[暂停补丁](/Users/sun/Code/exp-relay/prompt-state-1/paused-wip/changes.patch) · [实机矩阵](/Users/sun/Code/exp-relay/prompt-state-1/paused-wip/docs/research/2026-11-25-tui-prompts.md)

STATUS: done
