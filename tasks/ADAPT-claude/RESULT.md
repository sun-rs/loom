# ADAPT-claude 交付结果

`adapters/claude/` 提供独立的 Node ESM 适配器。启动器用本次 `--settings` 注入观察型 hook 和权限提示设置。适配器包含屏幕识别、弹窗键序列、事件归一化、transcript 定位与解析、L1 摘要及输入计划。 [适配器说明](../../adapters/claude/README.md)

## 直接复用与胶水

Orca 基线为 `b7fd7caa357a170f9fac6a49923f3b9ecf5ed0ea`。源码注释保留路径和 commit。下表按适配器中移植片段的物理行计数。

| Orca 文件 | 移植行数 | 用途 |
| --- | ---: | --- |
| `src/shared/agent-launch/permissions/tui-agent-permissions.ts` | 1 | Claude 的启动权限参数 |
| `src/main/claude/hooks/claude-managed-hook-events.ts` | 7 | 根轮次与工具 hook 事件 |
| `src/shared/agent-hook-listener/providers/claude/claude-tool-fields.ts` | 4 | 从 Stop 提取原生正文 |
| `src/main/runtime/terminal/output/startup-dialog-screen.ts` | 18 | 弹窗脚注、光标和选项位置 |
| `src/main/runtime/terminal/wait/startup-dialog-blocked-signals.ts` | 3 | 启动菜单标题与脚注 |
| `src/main/runtime/agent-state-rules/claude.json` | 3 | 首次主题及登录菜单识别 |
| `src/main/ai-vault/scanners/claude/claude-project-dir-encoding.ts` | 21 | CWD 编码、NFC 变体及长路径分桶 |
| `src/main/native-chat/transcript-discovery/session-file-resolver-claude-probe.ts` | 19 | 会话文件名和 `lstat` 验证 |
| `src/shared/agent-hook-listener/providers/claude/transcripts/claude-tool-content.ts` | 38 | 工具调用、结果及失败形状 |
| `src/main/native-chat/transcript-decoding/transcript-line-decoders-claude.ts` | 7 | 并入当前轮的队列提示识别 |
| **Orca 合计** | **121** | |

运行代码共 **1,048 行**。另从 exp-relay 逐行复用 **538 行**，其中 transcript 解析 179 行，Claude 屏幕分支 359 行。其余 **389 行**计为胶水，包含对实验代码的改动、hook 事件文件投影、定位和摘要拼接、输入计划及入口。运行代码计数排除测试、样本和文档。

与 Orca GitHub 默认分支 `05095dd110132c0d4320a77ab7dcb0081130ebfa` 逐字节比较，上表 10 个文件均一致。 [GitHub 提交对照](https://github.com/stablyai/orca/compare/b7fd7caa357a170f9fac6a49923f3b9ecf5ed0ea...05095dd110132c0d4320a77ab7dcb0081130ebfa)

## 能力实测

实测在 `/Users/sun/Code/exp-relay/adapt-claude/` 下进行。hc 0.1.22 持有 PTY，运行原生 Claude Code 2.1.322，模型为 Haiku 5.5，档位为 `low`。macOS 沙箱把 CLI 的文件写入限制在实验目录，`CLAUDE_CODE_TMPDIR` 把 Bash 工具的临时文件也放到该目录。 [Claude Code 环境变量](https://code.claude.com/docs/en/env-vars)

| 项目 | 实测结果 | 证据 |
| --- | --- | --- |
| 启动与信任框 | 非 Git 目录直接到输入框。空 Git 仓库出现目录信任框，适配器识别 `trust-dialog` 并给出 `down enter`，随后完成首轮。 | `t2z8` 无按键得到 `ADAPT_INLINE_OK`。`t2zc` 处理信任框后得到 `ADAPT_REPO_OK`。两个窗格均使用本次 settings 跳过 Bypass Permissions 提示。 |
| `hookInjection` | `settings-arg` | `UserPromptSubmit` 与 `Stop` 有相同会话 ID，Stop 的原生 `last_assistant_message` 给出完整正文。 |
| `steer` | `tui-queue` | Bash 的 `sleep 12` 正在运行时提交第二条输入，Bash 返回后同一轮给出 `ADAPT_TOOL_A_DONE ADAPT_TOOL_B_DONE`，只有一个 Stop。模型流式输出时提交第二条，先后得到 `ADAPT_STREAM_A_DONE` 和 `ADAPT_STREAM_B_DONE` 两个 Stop。两种场景均收到第二条输入。 |
| `interrupt` | `true` | 分别在 `sleep 16` 运行时按 `Esc` 和 `Ctrl+C`，屏幕均显示 `Interrupted` 并恢复输入框。 |
| `resumeSamePane` | `true` | 两次中断后向同一 `t2z6` 投递新提示，取得 `ADAPT_RESUME_ESC_OK` 和 `ADAPT_RESUME_CTRL_C_OK`，会话 ID 与首轮相同。 |
| 选择器与工具退出 | `/model` 识别为 `picker`，`Esc` 保留当前模型。 | Claude 在受控 Bash 命令 `exit 7` 后显示 `Exit code 7`。L1 在对应 JSONL 形状中保留该命令和退出码。 |

忙时投递用 `hc read` 确认状态后执行 `hc send`。两个场景的次条 `UserPromptSubmit` 都早于首个 Stop，中断的原轮没有独立 Stop。输入计划用 `fallback: 'queue'` 表示本次提交可能由 Claude 延后开启下一轮。 [脱敏 Hook 样本](../../adapters/claude/fixtures/live-hooks.jsonl) · [Claude Code 排队语义](https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works)

本任务创建的 9 个终端均经 `hc kill` 并确认 `finished`。地址为 `t2yj`、`t2yt`、`t2yw`、`t2yx`、`t2yy`、`t2z1`、`t2z6`、`t2z8` 和 `t2zc`。

## 测试

- `node --test adapters/claude` 通过 **23 项**。使用 Orca 的 hook 样本、exp-relay 已脱敏的屏幕和 transcript 样本，以及本次脱敏的真实屏幕和 hook。覆盖路径定位、错误与工具输出区分、弹窗光标、输入计划和 400 字节的保守 L1 上限。
- 将实验 Claude 解析器的原有 13 项测试指向适配器，按原结构检查时全部通过。各入口和模块通过 `node --check`。

## 验证边界与遗留问题

- 真实 CLI 轮次使用既有登录和 `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1`。本次验证了可见帧、工具行为和原生 Stop 正文。transcript 定位和解析通过隔离文件树及公开脱敏 transcript 回放验证。独立 `CLAUDE_CONFIG_DIR` 启动进入了登录选择器。
- `tui-queue` 只提供工具边界上的同轮并入机会。流式输出场景在实测中另起一轮，因此调用方可依据 Stop 与 transcript 观察归属。登录类选择器返回空键序列。
- 前置环境检查的 `claude --version` 和 `--help` 曾经由默认 PATH 调用了 CCP 包装器。确认链接后改走用户目录下安装的原生二进制，全部 hc 实测都直接启动该二进制。

STATUS: done
