# PILOT-FIX-1 结果

- Claude 自动信任范围默认为项目根目录和同一仓库登记在项目内的 Git 工作树。角色可用 `trustWorkspace: false` 关闭自动信任，单次启动可用 `--trust-workspace` 授权当前目录。PTY 核对原生对话框显示的绝对路径和选项，确认画面稳定后才操作，每个按键最多尝试两次。
- agy 将带有明确 Esc 提示的公告识别为 `overlay`，发送一次 Esc 后重新读取界面。对于保留在编辑框内的 Loom 草稿，PTY 比对投递 ID 和完整正文的 SHA-256 摘要，确认粘贴后没有人工输入、尺寸或缓冲区切换、其他原生轮次，再补发一次 Enter。投递仍以原生回执为准。
- `loom status` 显示 `trust-dialog`、`overlay` 和 `draft-held`。首条投递的同一启动阻塞持续超过 60 秒时，向 Super 投递 `needs-decision`。
- TUI 和 headless 会话将运行版本的 `bin` 置于 `PATH` 首位，并设置绝对路径 `LOOM_BIN`。技能、任务卡模板和工作者启动提示记录了这两个入口。
- 人工或外部提交后，Inbox 用同一投递标记的原生 hook 或 transcript 对账。Super 消息和中断消息可以越过未确认投递，旧投递会升级通知并继续等待原生证据。急件仍受原生轮次、活动画面和编辑框检查约束。

## 验收

- `npm test` 通过，共 276 项。回归涵盖公告只发送一次 Esc、完整草稿补交、部分或人工编辑的草稿保留、原生回执对账、紧急消息越过未确认投递、按实际目录核对信任对话框，以及 Codex 草稿中的空白段落行。
- 在 `/Users/sun/Code/exp-relay/pilot-fix-1/` 下的新工作树中，以隔离 HOME 和本地模型端点运行 Claude Code 2.1.331 Sonnet、agy 1.5.16 Gemini 4 Neon 和 Codex 0.171.0 `gpt-6.2-sol` 的原生 TUI。三者的首条提示均获得一次原生确认并收到回复。
- Claude 验证了默认信任、角色禁用和 `--trust-workspace` 单次授权。禁用会话在真实 CLI 的 `loom status --json` 中显示 `trust-dialog`，阻塞超过 60 秒后，Codex Super 的 `needs-decision` 通知获得原生投递回执。长 agy 测试稿显示 `draft-held`，人工按 Enter 后由 `uncertain` 变为 `answered`。
- Claude TUI 和 headless 会话实际执行 `command -v loom`，均返回 `/Users/sun/Code/repos/loom_new/bin/loom`，与 `LOOM_BIN` 一致。
- 原始记录保存在 `/Users/sun/Code/exp-relay/pilot-fix-1/` 下的 `live-final.log`、`followup.log` 和 `notice-final.log`。

## 验证边界

- 隔离 HOME 的 agy 验证中未自然弹出 Neon 公告。识别使用仓库内同版本的真实捕获，Esc 与草稿恢复使用 PTY 回放验证。界面强制换行使长 agy 测试稿无法通过完整摘要比对，该稿由人工提交。
- 首次版本探测误调用了指向 CCP 的 Claude 符号链接，执行的是 `--version`。所有会话验证使用隔离 HOME 与原生 Claude 可执行文件。临时会话均已停止。

STATUS: done
