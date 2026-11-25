# TUI-HOOKS-0：agy 和 Codex 的 TUI hooks 模块

## 背景
loom_new 的底层是"全 TUI 模式"：每家 CLI 都以交互式 TUI 运行在 hc 中，结构化信息来自 hooks 和本地会话文件。这一层是一个 `tui-hooks` 库，每家 CLI 一个模块。第一个模块 Claude 正由另一个 worker 写在 `drivers/claude-tui/`（DRV-CLAUDE-0）。你写 agy 和 Codex 两个模块，结构要与 Claude 模块一致，方便以后合并。

## 每个模块的四个组成（都要薄）
1. **hooks 配置生成**：写到该 CLI 读取的位置。Codex 的位置以 Orca 源码和 Codex 文档为准；agy 是 `~/.gemini/config/hooks.json`（Orca `src/main/antigravity/hook-service.ts:42`）。位置由调用方指定 HOME 或配置目录来决定。**生成器绝不写真实用户 HOME**，测试时一律指向临时目录。
2. **hook 脚本**：只观察，不做决策（不返回 allow、deny 或 block）。把 stdin 的 JSON 加上接收时间，追加到 `$LOOM_EVENTS_FILE`。变量未设置时静默退出，返回 0。共用 Claude 模块的同一个脚本也可以；如果需要分开，说明原因。
3. **事件读取**：按字节偏移游标增量读取。
4. **transcript 或会话文件读取**：定位规则（hook payload 里有没有路径字段；没有的话按 session id 在哪里找）和增量解析。产出 assistant 文本、工具调用（命令、退出码、输出）和最终回复。

## 已知事实（来自 Orca 源码，你要核实并补全）
- Codex hook 事件：SessionStart、UserPromptSubmit、Stop、PreToolUse、PostToolUse、PreCompact、SessionEnd、PermissionRequest（`orca/src/main/codex/`）
- agy hook 事件：**只有** PreToolUse、PostToolUse 和 Stop（`orca/src/main/antigravity/hook-events.ts`）。由于没有 UserPromptSubmit，"送达确认"只能从 transcript 中得到，参考 `antigravity-transcript-import.ts`。
- Orca 的跨 CLI 矩阵：`orca/src/main/agent-hooks/README.md`

## 必须回答的问题（写进 RESULT）
- 每个 hook 事件的 payload 字段，各自是否带 session id 和 transcript 路径。
- 最终回复从哪里取最可靠：Stop hook 的 payload，还是 transcript 的最后一条 assistant 消息。
- 送达确认：Codex 用 UserPromptSubmit；agy 用 transcript 里出现的 user 记录。
- **Codex 通过 `codex --remote` 连接 app-server daemon 时，hooks 在哪个进程执行，还会不会触发？** Codex 是开源的（openai/codex），可以联网读源码确认，并写明出处。
- agy 的 transcript 或会话文件存放在哪里、是什么格式。依据 Orca 源码和 agy 的 `--help`、官方文档推断，**不要读真实的 `~/.gemini` 目录**。

## 参考（只读）
- Orca（MIT）：`/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/orca/src/main/{codex,antigravity,agent-hooks}/`。只移植事件映射、配置格式和解析规则，**不要搬**账号、凭据、登录或 native-account 相关代码。复制或移植的片段要在文件头注明来源路径。
- OAR：`.../repos/oar/packages/oar/src/runtimes/{codex,antigravity}/`，以及 `docs/runtimes/*.md`
- 允许的无模型探针：`agy --help`、`codex --help`、各子命令的 help。不要启动任何对话。

## 约束
- 零运行时依赖，Node 25 直接运行 `.ts`，用 `node --test` 测试。每个模块手写代码不超过 300 行（不含测试和 fixtures）。
- 输出到 `drivers/tui-hooks/agy/` 和 `drivers/tui-hooks/codex/`，每个模块有自己的 `src/`、`test/`、`fixtures/` 和 `README.md`（写明哪些已验证、哪些是推断）。

## 交付
`tasks/TUI-HOOKS-0/RESULT.md`：完成内容、行数、问题答案、需要真实 CLI 验证的清单（要列出每一项需要多少次付费 turn）。最后一行写 `STATUS: done`。

## 红线
- 只能写 `drivers/tui-hooks/` 和 `tasks/TUI-HOOKS-0/` 两个目录。不要 git commit。
- 不读、不打印、不复制凭据（`~/.codex/auth.json`、`~/.codex/memories*`、`~/.gemini`、`~/.claude*`、`.env`、任何 token）；不读用户真实的会话记录（`~/.codex/sessions`、`~/.gemini` 下的任何内容）。
- 不调用付费模型，不安装软件，不使用 `hc send`、`hc keys`、`hc kill`，不修改 loom_new 以外的目录。
