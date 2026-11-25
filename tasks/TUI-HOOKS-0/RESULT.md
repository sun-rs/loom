# TUI-HOOKS-0 结果

## 完成内容

- 新增 `drivers/tui-hooks/codex/`。模块生成隔离 HOME 下的 `~/.codex/hooks.json`，挂载八个观察事件，写入 `LOOM_EVENTS_FILE` 事件脚本，提供字节偏移 JSONL reader、Codex rollout 定位、assistant/tool/usage 解析和最终回复选择。
- 新增 `drivers/tui-hooks/agy/`。模块生成隔离 HOME 下的 `~/.gemini/config/hooks.json`，按任务范围挂载 `PreToolUse`、`PostToolUse`、`Stop`，写入同样语义的观察脚本，提供字节偏移 reader、agy transcript 定位、user/assistant/tool/usage 解析和送达确认。
- 两个 hook 脚本分别保留在自己的模块内。Claude 模块在本任务执行时尚未提供可复用脚本，为了保持每个模块可独立运行和零跨模块运行时依赖，暂时没有共享文件。两份脚本都排空 stdin，`LOOM_EVENTS_FILE` 未设置时静默返回 0，设置后以单次 append 写入带 `receivedAt` 的 JSON 行。
- 每个模块都有 `src/`、`test/`、`fixtures/` 和 `README.md`。配置生成器只接受调用方传入的 HOME 或配置路径，不读取真实的 `HOME`、`.codex` 或 `.gemini`。

手写源代码行数如下。测试和 fixtures 未计入。

| 模块 | 文件 | 行数 |
| --- | --- | ---: |
| Codex | `drivers/tui-hooks/codex/src/` 全部手写源文件 | 251 |
| agy | `drivers/tui-hooks/agy/src/` 全部手写源文件 | 188 |

## 必答问题

### Codex hook payload

这些字段来自 openai/codex 的 command input schema。`transcript_path` 是 nullable string，session id 字段仍然存在。`turn_id`、`agent_id` 和 `agent_type` 是部分事件或子 agent 场景中的可选扩展字段。

| 事件 | 主要字段 | session id | transcript 路径 |
| --- | --- | --- | --- |
| `SessionStart` | `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`, `source` | 有 | 有，可为 null |
| `UserPromptSubmit` | `session_id`, `turn_id`, `prompt`，以及可选 agent 字段 | 有 | 有，可为 null |
| `Stop` | `session_id`, `turn_id`, `stop_hook_active`, `last_assistant_message` | 有 | 有，可为 null |
| `PreToolUse` | `session_id`, `turn_id`, `tool_name`, `tool_input`, `tool_use_id`，以及可选 agent 字段 | 有 | 有，可为 null |
| `PostToolUse` | `PreToolUse` 字段加 `tool_response` | 有 | 有，可为 null |
| `PreCompact` | `session_id`, `turn_id`, `trigger`，以及可选 agent 字段 | 有 | 有，可为 null |
| `SessionEnd` | `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `reason` | 有 | 有，可为 null |
| `PermissionRequest` | `session_id`, `turn_id`, `tool_name`, `tool_input`，以及可选 agent 字段 | 有 | 有，可为 null |

### agy hook payload

任务范围的三个 agy 事件都带 `conversationId`、`workspacePaths`、`transcriptPath`、`artifactDirectoryPath`、`modelName` 和 `lastUserInput`。`conversationId` 是 session id，`transcriptPath` 是 transcript 路径。agy payload 使用 camelCase，不带 `hook_event_name`。

| 事件 | 事件字段 | session id | transcript 路径 |
| --- | --- | --- | --- |
| `PreToolUse` | `toolCall`, `stepIdx` | 有，`conversationId` | 有，`transcriptPath` |
| `PostToolUse` | `toolCall`, `stepIdx`, `error` | 有，`conversationId` | 有，`transcriptPath` |
| `Stop` | `executionNum`, `terminationReason`, `error`, `fullyIdle` | 有，`conversationId` | 有，`transcriptPath` |

### 最终回复来源

Codex 最可靠的来源是 Stop hook payload 的 `last_assistant_message`。它为空或缺失时，模块回退到 transcript 最后一条 assistant 记录。agy 的 Stop payload 没有 assistant 文本，所以使用 transcript 最后一条 `source: MODEL`、`type: PLANNER_RESPONSE` 记录。agy 的 compact transcript 可能丢步骤，路径定位优先 `transcript_full.jsonl`。

### 送达确认

Codex 使用 `UserPromptSubmit` 事件作为送达确认。agy 没有 UserPromptSubmit，使用 transcript 中出现的 `USER_EXPLICIT` 或 `USER` 加 `USER_INPUT` 或 `REQUEST` 的记录。`<USER_REQUEST>` 包装会在解析时去掉。

### Codex `--remote` 和 app-server daemon

`codex --remote` 的 TUI 是 app-server daemon 的客户端。会话、hook runtime 和 hook command 子进程在 daemon 侧执行，远程 TUI 连接不会让 hooks 失效，仍会触发。上游 Codex 的 hook runtime 在 session 中构造并运行 hook 请求，公开 issue 明确记录 remote 模式 hooks 会触发并收到正确事件名，同时指出 payload 的 `cwd` 可能是 daemon 工作目录。

出处包括 [Codex hook runtime](https://github.com/openai/codex/blob/main/codex-rs/core/src/hook_runtime.rs) 和 [Codex remote hook issue](https://github.com/openai/codex/issues/42457)。

### agy transcript 或会话文件

默认 CLI app data 目录是 `<home>/.gemini/antigravity-cli`。conversation id 对应目录为

`<home>/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/`

优先读取 `transcript_full.jsonl`，不存在时读取 `transcript.jsonl`。每一行是 JSON 对象，Orca 已验证的常见字段是 `step_index`、`source`、`type`、`content` 和 `created_at`。用户记录通常是 `USER_EXPLICIT/USER_INPUT` 或 `USER/REQUEST`，模型文本是 `MODEL/PLANNER_RESPONSE`。工具记录的字段会随 agy 版本变化，当前解析器读取 `tool_calls`、`RUN_COMMAND` 以及常见 command、exit code、output 字段，并保留原始对象。compact transcript 可能只保留滚动窗口，full 文件也需要以真实版本验证其轮转行为。

出处包括 Orca 的 `src/main/antigravity/antigravity-transcript-import.ts`、`src/main/native-chat/transcript-decoding/transcript-line-decoders-antigravity.ts` 和 [Antigravity Hooks 文档](https://antigravity.google/docs/hooks?tab=ide)。

## 验证

已运行以下本地测试，合计九项全部通过。

```text
node --test drivers/tui-hooks/codex/test/*.test.ts
  5 passed
node --test drivers/tui-hooks/agy/test/*.test.ts
  4 passed
```

测试覆盖临时 HOME 配置、脚本无 sink 静默、事件追加、JSONL 半行游标、文件截断复位、Codex rollout 记录、agy user 送达记录、full transcript 优先和路径回退。fixtures 只含合成内容。

已运行的无模型探针如下。`codex --help`、`codex app-server --help`、daemon 子命令 help、`agy --help` 和版本读取均未启动对话。

## 需要真实 CLI 验证的清单

以下是交给 orchestrator 的验证项。付费 turn 数是每个独立场景的预计新增数量，help、配置检查和退出 session 不需要付费 turn。

| 项目 | 验证内容 | 预计付费 turn |
| --- | --- | ---: |
| Codex 常规链路 | 在一次带命令的正常 turn 中确认 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop` 的真实 stdin 和 transcript 路径 | 1 |
| Codex PermissionRequest | 使用会触发权限请求的命令确认 payload 字段和观察脚本不会改变决策 | 1 |
| Codex PreCompact | 触发一次真实 compact，确认 `trigger`、游标和 transcript 轮转 | 1 |
| Codex SessionEnd | 退出 TUI 后确认 `SessionEnd` 的 reason 和路径，沿用上一场景的 session 不新增 turn | 0 |
| Codex remote daemon | 启动 daemon，用 `codex --remote` 完成一次带命令 turn，确认 hook 子进程在 daemon 侧执行且事件到达 | 1 |
| agy 三事件和送达 | 一次带 `run_command` 的 turn 确认三个 hook payload、`conversationId`、`transcriptPath` 和 transcript user 记录 | 1 |
| agy 工具结果和轮转 | 确认真实 `RUN_COMMAND` 的命令、退出码、输出，以及 full/compact 文件在 compact 后的行为 | 1 |

合计预计 6 个付费 turn。当前实现没有做这些真实对话验证，也没有调用付费模型。

## 未决边界

- Codex `.jsonl.zst` rollout 没有被读取，因为 Node 25 内置模块不提供 zstd 解码。调用方可先提供未压缩路径。
- agy 工具步骤的字段在版本间变化，当前 parser 对常见字段做了兼容映射。`.system_generated/steps/<N>/output.txt` 的补读和真实版本轮转仍需付费场景确认。
- 任务要求的 agy 三事件与当前公开文档列出的更广泛事件集合存在版本差异。本交付严格按任务给出的 Orca 事件范围挂载三项，没有额外安装其他事件。

STATUS: done
