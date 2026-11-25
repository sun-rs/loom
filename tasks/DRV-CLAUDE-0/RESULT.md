# DRV-CLAUDE-0 交付结果

## 完成内容

- `settings.ts` 为同一 cell 的同版本 Claude Code 生成并原子写入一份 settings，注册任务要求的八个异步观察 hook。角色和事件路径由启动方通过 `LOOM_ROLE` 和 `LOOM_EVENTS_FILE` 传入。settings 的写入目标由调用方指定。
- `hook.ts` 将接收时间、可选角色和原始 stdin payload 追加到该角色的 `events.jsonl`。每条记录使用一次 `O_APPEND` 写入。未配置目的路径、输入无效和写入失败均以空输出、退出码 0 结束。
- `events.ts` 和 `jsonl.ts` 按字节从游标读到该次读取的文件末尾。游标停在最后一个完整行的末尾，通过设备号、inode 和偏移前 32 字节识别轮转、缩小和边界变化。
- `transcript.ts` 保留原始行，并投影 assistant 文本、工具调用和结果、usage、compaction。`lastAssistantText(turn)` 按 turn 起始游标提取回复，拼接同一消息的文本块，支持 SubagentStop 的独立 transcript 以及 `last_assistant_message` 备用值。
- `README.md` 说明启动方如何共用 settings、传递环境变量和保存游标。`test/` 与 `fixtures/` 可在 Node.js 25 上直接运行和回放。

手写运行时代码 **492 行**，按 `wc -l` 统计 `src/*.ts` 的物理行，含空行和注释。依文件分别为 `events.ts` 47 行、`hook.ts` 45 行、`index.ts` 5 行、`jsonl.ts` 94 行、`settings.ts` 74 行、`transcript.ts` 227 行。运行时使用 Node 内置模块和原生 TypeScript 类型擦除。

## 验证结果

在 `drivers/claude-tui/` 下用 Node.js **v25.9.0** 执行 `node --test`，8 项全部通过。

- 覆盖 settings 文件生成、hook payload 原样保存、无环境变量时在 stdin 保持打开的情况下退出、无效 JSON、缺失事件目录、Bash 调用和成功及错误结果、subagent、usage、compaction。
- 覆盖 UTF-8 多字节字符写到一半、transcript 尾行未写完、文件路径暂时缺失、轮转、同 inode 截断后重新增长及截断为空文件。独立稀疏文件测试从 2 GiB 处读取首条事件，继续用返回游标读取下一条。
- 大记录回归测试用 24 个进程同时追加，每条包含 640 KiB 的合成文本。旧 `appendFile` 实现只留下 19 条可解析记录。改为单次追加后，24 条都能解析，逐条比对 payload 完整。
- 一次完整运行中，单个 hook 从启动到退出用时 100.5 ms，目标目录缺失用时 95.3 ms，24 进程并发批次用时 255.9 ms。正常和失败路径均验证了退出码 0 与空 stdout、stderr，目录缺失时也验证了目标目录未被创建。

## 借鉴来源

参考项目的文件路径以 `TASK.md` 所列 `repos` 为根。

| 范围 | 对照来源 |
| --- | --- |
| Settings 的事件列表、通配 matcher、exec form 版本对照 | Orca `src/main/claude/hooks/claude-managed-hook-events.ts`、`src/main/claude/hooks/hook-settings.ts`、`src/main/claude/cli-capabilities/claude-hook-event-versions.ts`。 [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) |
| Hook stdin、观察事件和后台执行 | Orca `src/main/claude/hooks/hook-script.ts` 的 stdin 约定和无目标时提前退出的做法。驱动使用本地 JSONL，启动方与 hook 可直接通过文件交换记录。 [Claude Code Hooks reference](https://code.claude.com/docs/en/hooks) |
| 事件与 transcript 的增量读取 | Orca `src/main/claude/transcripts/claude-transcript-tail.ts` 的定位读取、未换行尾行和主链判断。字节游标和文件身份校验为本驱动实现。 |
| Assistant、工具、usage 和子代理字段 | Orca `src/main/claude/structured/journal/claude-structured-item-translation.ts`、`src/shared/__fixtures__/claude-helper-kill-2.1.310-parent.jsonl` 和 `claude-helper-kill-2.1.310-child.jsonl`。OAR `packages/oar/src/runtimes/claude/projection.ts` 和 `token-usage.ts` 用于核对 `parent_tool_use_id`、`message.usage` 和 `modelUsage`。 |
| Compaction 和合成 fixtures | Orca `src/main/claude/fixtures/claude-captured-compact-frames.test-fixture.ts`、`src/shared/agent-hook-listener/providers/claude/transcripts/claude-transcript-decoder.ts`，OAR `packages/oar/src/runtimes/claude/compaction.ts`。T3 `apps/server/src/orchestration-v2/testkit/fixtures/` 中 `subagent`、`claude_local_bash_task`、`claude_compact_after_peer_turn` 的 `claude_transcript.ndjson` 用于交叉核对 stream-json 记录。 |
| Stop 和 SubagentStop payload、现有 turn 的最终文本 | Hooks 文档的 `transcript_path`、`agent_transcript_path`、`stop_hook_active` 和 `last_assistant_message` 定义，以及 Orca `src/shared/agent-hook-listener/providers/claude/transcripts/claude-transcript-reply-model.ts` 关于 Stop 可能先于 transcript 写入的记录。 [Stop 输入](https://code.claude.com/docs/en/hooks#stop-input) · [SubagentStop 输入](https://code.claude.com/docs/en/hooks#subagentstop-input) |

## 未决问题

- 本次验证仅运行 Node 合成测试并核对文档与参考 fixtures。目标 Claude Code 的 hook 触发条件、`args` 执行和 transcript 实际形状仍待实机确认。Orca 的版本对照将 exec form 的起始版本标为 `2.1.139`。
- 后台 hook 的写入顺序由进程调度决定。若 Stop 到达时仅落盘了最终消息的部分文本块，读取器会返回当时可见的块。最终落盘时序需在 orchestrator 中确认。
- 同 inode 的重写检测依赖文件长度和游标边界。重写后若长度仍覆盖旧游标且边界字节完全相同，读取会从原游标继续。

## 真实 Claude 验证清单

1. 在 PTY holder 中用目标 CLI 版本加载 `claude --settings <cell-settings>`，确认八个事件配置都被接受，含空格的 hook 路径通过 `args` 正确启动。用同一 settings 启动两个角色，验证 `LOOM_EVENTS_FILE` 分流与 `LOOM_ROLE` 标记，并验证缺少 `LOOM_EVENTS_FILE` 时的静默行为。
2. 在受控会话中观察 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop` 和 `SubagentStop` 的原生 payload。通过可控的权限确认和故障场景检查 `PermissionRequest` 与 `StopFailure`，确认原有工具决策和权限模式由 Claude 与启动方控制。
3. 比对一次普通回复及 Bash 成功、失败两种 turn 的 `message.content`、`input.command`、工具输出和 `is_error`。核对子代理的主 transcript 与 `agent_transcript_path`，并确认主回复和子代理回复各自归属。
4. 记录 Stop 的 `last_assistant_message` 与最终 transcript 行的落盘先后，确认首读、延迟追加和多文本块场景。验证目标 TUI 版本写出的 usage、compact boundary 和 summary 字段。

STATUS: done
