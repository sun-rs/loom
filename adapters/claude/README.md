# Claude Code TUI 适配器

入口为 `index.mjs`，使用 Node ESM 和内置模块。已在 Node 25.9.0、Claude Code 2.1.322 和 hc 0.1.22 上验证。`index.js` 为目录形式的 Node 测试命令提供入口。

```js
import claude from './adapters/claude/index.mjs';

const cwd = '/path/to/workspace';
const { argv, env } = claude.launch({
  model: 'haiku',
  effort: 'low',
  prompt: 'Check the local test output.',
});
```

按用户 2026-11-27 裁决，所有 Claude Code 调用必须经 CCP 保护入口（默认 `/Users/sun/.local/bin/claude`，禁止 realpath 执行目标或直接启动 `~/.local/share/claude/versions/*`；非 CCP 入口直接报 `ccp-required` 拒绝）。`extraArgs` 接收额外的 TUI 选项，继续已知会话时可传 `['--resume', sessionId]`。

CCP 独占 Claude 的受保护 settings，仅允许在 `--settings` 中传入 `fastMode` 或 `disableAllHooks`。因此 `launch` 不注入 hooks、`statusLine`、`idleCompaction`、`skipDangerousModePermissionPrompt`，也不传 `--setting-sources ''` 或 `--strict-mcp-config`，且不清空或改写代理/出口环境变量（`HTTP(S)_PROXY`、`ALL_PROXY`、`NO_PROXY` 及小写形式、`ANTHROPIC_BASE_URL`）。仅在显式指定 `fast` 时传 `--settings '{"fastMode":...}'`。回合、投递确认、最终回复、压缩与上下文用量改为直接读取 `~/.claude/projects/<编码后的 cwd>/<sessionId>.jsonl`。 [Claude Code settings](https://code.claude.com/docs/en/settings) · [权限模式](https://code.claude.com/docs/en/permission-modes)

## 屏幕和输入

`screen.classify(text)` 接收 `hc read` 的可见帧，返回 `idle`、`busy`、`trust-dialog`、`picker`、`rate-limit`、`auth-fail` 或 `unknown`。

`screen.dialogKeys(kind, text)` 以同一帧确认弹窗位置，返回可交给 `hc keys` 的按键名。实测的信任框默认光标在 `No, exit`，按 `down enter` 后进入会话。已选中信任项时只需 `enter`。已知 Bypass Permissions 提示可用同样的选项定位，`/model` 选择器可用 `esc` 关闭。登录和其他选择器返回空数组。省略 `text` 时，`trust-dialog` 返回实测默认键序列。

| `input.plan(mode)` | 执行顺序 |
| --- | --- |
| `queue` | 等待 `idle`，再粘贴文本并提交。 |
| `steer` | 在 `busy` 时粘贴并提交。`delivery` 为 `tui-queue`，`fallback` 为 `queue`。工具执行中的输入可在工具返回后并入当前轮，流式输出中的输入可能在这轮 Stop 后开启下一轮。一次提交由 Claude 自行排队。 |
| `interrupt` | 按 `esc`，等待原窗格恢复 `idle`，再粘贴并提交。`ctrl+c` 也通过实测。 |

`steps` 使用 `{ type: 'wait', state }`、`{ type: 'keys', keys }` 和 `{ type: 'text', submit: true }`。启动器负责执行计划与确认投递。 [Claude Code 交互模式](https://code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works)

## Hook 和历史

- `hookSink` 是单个窗格的 JSONL 事件文件，接收绝对路径或相对 `cwd` 的路径。hook 追加用于关联会话的原生字段及 `receivedAt`，并静默退出。读取方可逐行调用 `hooks.normalize(payload)`。
- `UserPromptSubmit` 对应 `turn-start`，`Stop` 对应 `turn-end`，`StopFailure` 对应 `stop-failure`，工具事件对应 `tool`。`Stop` 的 `last_assistant_message` 提供 `finalReply`。子代理和未知事件返回 `null`，显式中断事件省略 `finalReply`。队列中的 `UserPromptSubmit` 可能先于上一轮 Stop，取消的轮次也可能只有开始事件。 [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- `transcript.locate({ sessionId, cwd })` 异步定位当前工作目录的常规 JSONL 文件，缺失时返回 `null`。可指定 `configDir` 和 `projectDirName` 匹配启动环境。默认使用 `CLAUDE_CONFIG_DIR` 或 `~/.claude`，自定义配置目录可配合 `CLAUDE_CODE_PROJECT_DIR_NAME`。 [Claude Code 环境变量](https://code.claude.com/docs/en/env-vars)
- `transcript.parse(text)` 返回 loom-transcript 的 `{ provider, turns, lastReply, usage }`，每轮追加 `prompts` 和 `tools`。工具通过 `tool_use_id` 关联结果，带退出码证据的失败命令进入 L1。并入轮次的人类提示保留在该轮 `prompts`。
- `transcript.turnSummary(session, n)` 的 `n` 从 1 开始，返回状态、任务、工具计数、非零退出命令和最终回复首段。对输出采用 400 UTF-8 字节的保守上限，缺失轮次返回 `null`。

## 验证

```sh
node --test adapters/claude
```

`fixtures/experiment-*` 来自 exp-relay 公开样本。`fixtures/orca-permission-hooks.jsonl` 是 Orca `b7fd7caa3` 的 `src/shared/__fixtures__/claude-permission-approve-deny-hooks.jsonl` 的字段投影。`fixtures/live-*` 来自本次 hc 实测，已替换账号标记、路径、标识符和时间。 [实测结果](../../tasks/ADAPT-claude/RESULT.md)
