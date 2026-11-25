# DRV-CLAUDE-0：Claude Code TUI 薄驱动（hooks + transcript）

## 目标
在 `/Users/sun/Code/repos/loom_new/drivers/claude-tui/` 下，写一个**尽可能薄**的 Claude Code TUI 驱动。这是"驱动层"：只讲 Claude Code 的原生语言，不依赖 loom 协议（协议由 PROTO-0 并行编写，你不要等它，也不要实现它）。

Claude 以交互式 TUI 运行在 PTY holder（hc）里。驱动**不负责**启动进程和 PTY，只负责下面四件事：
1. **settings 生成器**：为每个角色生成一份独立的 settings JSON，通过 `claude --settings <file>` 传入（已实测 `claude --help` 里有 `--settings <file-or-json>` 和 `--setting-sources`）。**绝不修改**用户的 `~/.claude/settings.json` 或任何全局配置。挂载观察型 hook 事件，参考 Orca 的那 8 个：SessionStart、UserPromptSubmit、Stop、StopFailure、SubagentStop、PreToolUse、PostToolUse、PermissionRequest。所有 hook 都只做观察、不做决策：不返回 allow、deny 或 block，也不阻塞 Claude。自动化角色没有审批，权限模式由启动方决定，不在驱动里处理。
2. **hook 脚本**：要求极简、快、失败也不影响 Claude。推荐做法是把 hook 的 stdin JSON 加上接收时间，追加到每个角色一份的 `events.jsonl` 文件里。这样不需要常驻 server，崩溃也安全。如果你有更好的理由用 unix socket，写进 RESULT。hook 脚本的执行时间和失败行为要测。
3. **事件读取器**：从 `events.jsonl` 按字节偏移游标增量读取，产出原生 hook 事件。
4. **transcript 读取器**：hook payload 里带有 `transcript_path`，按游标增量读取这个 JSONL 文件，产出原生记录：assistant 文本、tool_use（工具名、输入，Bash 要带 command）、tool_result（输出、is_error），以及 usage 和 compaction 记录（如果存在）。另外提供 `lastAssistantText(turn)`，用来从 Stop 之后的 transcript 中取最终回复。

## 薄封装硬约束
- **零运行时依赖。** 只用 Node 25 内置能力，直接运行 `.ts`（type stripping），不加构建步骤。
- 手写代码目标 ≤ 500 行（不含 tests 和 fixtures）。如果超出，说明原因。
- 不做业务逻辑，不解析屏幕文本（OSC 7501 和屏幕由 hc 负责，不在本驱动范围内）。

## 参考（只读）
- Orca（MIT）：`/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/orca/src/main/claude/hooks/`（`claude-managed-hook-events.ts` 的事件列表、`hook-settings.ts`、`hook-script.ts`）、`src/main/claude/transcripts/`（transcript 读取和 tail）、`src/main/agent-hooks/README.md`（hooks 与 OSC 的优先级）、`src/main/claude/__fixtures__`。**不要照搬**它的多账号 profile、ssh 远程安装和全局 settings 改写。
- OAR（Apache）：`.../repos/oar/packages/oar/src/runtimes/claude/`（stream-json 和 transcript 字段的理解）；以及 OAR 仓库里的 claude fixtures
- T3、paseo、happy 里的 Claude transcript 或 hook 解析，可以交叉核对字段名
- Claude Code 官方 hooks 文档：hook 输入字段（`session_id`、`transcript_path`、`hook_event_name`、`stop_hook_active`、`last_assistant_message` 等）以文档和 fixtures 为准；如果联网可以查官方文档，并在 RESULT 中注明出处。

## 测试
- `node --test`：
  - 用参考项目的 fixtures，或依据它们构造 transcript JSONL 和 hook payload；
  - 覆盖：正常 turn、Bash 工具调用和结果、工具报错、subagent、文件写到一半（游标不能前进到不完整的行）、文件轮转或截断。
- hook 脚本实测：用伪造的 stdin JSON 直接执行脚本，验证追加写入、并发写入不交错、目标目录不存在时的行为。
- **不要启动 claude 进行任何对话**，也就是不调用模型。可以运行 `claude --help`。真实 Claude 上的端到端验证留给 orchestrator，在 RESULT 里写清楚需要验证哪些点。

## 交付
- `drivers/claude-tui/`：`src/`、`test/`、`fixtures/`、`README.md`（用法，以及哪些字段已验证、哪些来自源码推断）
- `tasks/DRV-CLAUDE-0/RESULT.md`：完成内容、手写行数、每段借鉴的来源文件、未决问题、真实 Claude 验证清单；最后一行写 `STATUS: done`

## 红线
- 只能在 `drivers/claude-tui/` 和 `tasks/DRV-CLAUDE-0/` 内写文件。**不要 git commit**，提交由 orchestrator 统一做。
- 不读、不打印、不复制凭据：Claude 的凭据和 keychain、`~/.claude/.credentials*`、`.env`、任何 token。不读用户真实的会话 transcript（`~/.claude/projects/**`）。
- 不调用付费模型，不安装软件，不使用 `hc send`/`hc keys`/`hc kill`，不 push，不修改 loom_new 以外的任何目录。
- 不设置或伪造 `CLAUDE_CODE_ENTRYPOINT`。

## 补充（orchestrator，2026-11-24）
settings 文件不按角色区分。同一个 cell、同一个 CLI 版本**共用一份** settings 文件。角色身份和事件文件路径通过环境变量传给 hook 脚本（例如 `LOOM_EVENTS_FILE`，由启动方在启动 claude 时设置，hook 子进程会继承）。没有设置这个变量时，hook 脚本静默退出，返回 0。settings 生成器的输入里不包含角色信息。
