# PILOT-FIX-4 结果

1. Claude、Codex、agy 和 OpenCode 共用同一个草稿验证器。它按 xterm 的 `isWrapped` 拼接软换行，校验编辑框内的投递标记和折叠空白后的 SHA-256。Claude 的折叠粘贴仍由其适配器识别，agy 的分段粘贴使用相同的验证器。回归重放了原生 Claude 的展开草稿，也验证了等长改写时不会误认。
2. agy 将完整的反馈问卷认作覆盖层，画面稳定且原生轮次结束后只按一次 `0` 跳过，再重新读取画面。回归覆盖了问卷仍留在屏幕上的情况，确认没有重复按键，也没有发送 `1`、`2` 或 `3`。
3. Worker 启动时获得独立的可写 `HOME`、XDG 目录和临时目录。Git 全局配置仅继承提交者的 `user.name` 和 `user.email`。无头 Codex 通过 OAR 启用原生命名权限配置，详情见下节。
4. Loom 自动附加给 Worker 的任务约定及卡片模板统一要求使用绝对路径 `"$LOOM_BIN"` 调用 Loom。
5. Auditor 的 Loom hook 日志有该轮 `UserPromptSubmit`，没有对应的 `Stop`。Claude 原生记录在 08:22:07Z 先写入 `stop_hook_summary`，随后写入根轮 `turn_duration`。现有记录无法确定 Stop 在哪里丢失。Loom 现在把已绑定会话、同一提示及时间区间内的原生根轮结束用于收尾。Inbox 以此结清人工 Enter 送达的消息并继续 FIFO 队列，巡检以同一证据清除已持久化的 `idle-without-stop`。单独的 hook 摘要、子代理结束和其他会话的记录都不能触发恢复。

## 无头 Codex Worker 权限

- 文件系统可写范围为工作目录、私有 `HOME` 和 `TMPDIR`。工作目录里的 `.git`、`.agents`、`.codex`、`.aws` 保持只读。XDG 配置、缓存、数据和状态目录分别位于私有 `HOME` 下，`XDG_RUNTIME_DIR` 使用私有 `TMPDIR`。
- 关联工作树额外获得专属的 `<common>/worktrees/<name>/`、共享的 `<common>/objects/`、当前分支的 `<common>/refs/heads/<branch>`、同一 ref 的 `.lock` 及 `<common>/logs/refs/heads/<branch>`。Detached 工作树只有前两个额外授权。共享 reftable 无法授予单一分支的写权限，因此以分支启动时拒绝该格式。
- Unix socket 权限只授予该 Worker 的 `TMPDIR`，本地 TCP 监听关闭。隔离实测使用 macOS 原生 Codex 0.171.0。 [Codex 权限配置](https://learn.chatgpt.com/docs/permissions) · [Codex 0.171.0 Seatbelt 实现](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/sandboxing/src/seatbelt.rs)

## 验收

- `npm test` 共 288 项，全部通过。 [完整测试日志](/Users/sun/Code/exp-relay/pilot-fix-4/npm-test-acceptance.log)
- 用绝对路径 `/Users/sun/.local/share/claude/versions/2.1.331`、隔离 HOME 和本地模拟端点重现展开草稿。基线停在 `draft-held`，修复后取得一次原生回执，标记和正文完整。 [基线](/Users/sun/Code/exp-relay/pilot-fix-4/claude-wrapped-baseline.log) · [修复后](/Users/sun/Code/exp-relay/pilot-fix-4/claude-live.log)
- 用绝对路径 `/opt/homebrew/Caskroom/codex/0.171.0/bin/codex`、隔离 HOME 和本地模拟端点，经 `loom spawn worker` 启动真实的无头 Codex。它完成了 `git add` 和 `git commit`，主 checkout 的 HEAD 没有移动。私有临时目录内 socket 成功监听和连接，XDG 状态日志成功写入。主 checkout、共享 Git 元数据根、其他分支的锁、启动 HOME、公共临时目录及工作树外路径的写入都被拒绝，私有临时目录外的 socket 监听也被拒绝。 [无头实测](/Users/sun/Code/exp-relay/pilot-fix-4/worker-final.log)
- Pilot 窗格仅用于只读诊断。主仓库未提交。草稿、问卷与 PTY 原生空闲恢复逻辑由新启动的 `loom-pty` 加载，运行中的旧 wrapper 会继续使用各自的版本。

STATUS: done
