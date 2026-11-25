# Codex TUI 适配器

适配器由纯 JavaScript 实现，使用 Node ESM 和零运行时依赖。入口 `index.mjs` 默认导出适配器，也提供同名导出 `codex`。运行目录测试需要 Node 22.18 或更新版本，实测版本为 Node 25.9.0。

## 启动与事件

```js
import codex from './adapters/codex/index.mjs';

const { argv, env } = codex.launch({
  model: 'gpt-5.4-mini',
  effort: 'low',
  cwd: '/path/to/workspace',
  prompt: 'Reply with the result of 2 + 2.',
  hookSink: '/path/to/loom/events/codex.jsonl',
});
```

将 `argv` 原样交给 hc，并将 `env` 合并到调用方准备的进程环境。`cwd` 指向已有工作目录。`extraArgs` 接受 Codex 选项数组。`hookSink` 接受绝对路径或相对 `cwd` 的路径。

启动参数启用原生内联 TUI、`approval=never` 和 `workspace-write`，并按次传入工作区信任及本次 hook 的哈希。调用方负责选定可信工作区和模型后端。hook 将观察事件追加到 `hookSink`，`Stop` 的 `last_assistant_message` 直接成为 `finalReply`。写入的 JSONL 保留原生 `turn_id`，同一轮的 steer 会再次触发 `UserPromptSubmit`，消费端可按 `session_id` 与 `turn_id` 归并。

`hooks.normalize(payload)` 返回 `{ type, sessionId, transcriptPath, finalReply? }`。四类事件为 `turn-start`、`turn-end`、`tool` 和 `stop-failure`。`Interrupt` 归入 `stop-failure`。未知事件及子 agent 事件返回 `null`。

## 屏幕与投递

`screen.classify(text)` 接收 hc 当前可见屏幕的 `text`。`screen.dialogKeys(kind)` 为默认选中 **Trust and continue** 的工作区信任框返回 `enter`，为已识别的选择器返回 `esc`，其余状态返回空数组。

| `input.plan(mode)` | 步骤 |
| --- | --- |
| `queue` | 等待空闲，括号粘贴，单独发送 Enter。 |
| `steer` | 确认原轮仍忙，括号粘贴，单独发送 Enter。 |
| `interrupt` | 忙时按 Esc，等待空闲，括号粘贴，单独发送 Enter。 |

计划返回 `{ mode, downgraded, steps }`。缺少原生 steer 能力时，返回 `mode: 'queue'` 和 `downgraded: true`。调用方按顺序处理步骤，满足 `require` 或 `wait` 的状态条件后再发送文本。`text` 步骤提供括号粘贴的前后缀及发送下一个键前的延时。实测环境也支持忙时按 Tab 原生排队。

## 会话和 L1 摘要

`transcript.locate({ sessionId, cwd })` 返回对应 JSONL 路径或 `null`，按活动会话、归档会话的顺序查找，并核对文件头中的会话 ID 和工作目录。存储根目录取 `CODEX_HOME`，默认是 `~/.codex`，也可显式传入 `codexHome`。

`transcript.parse(text)` 返回实验版 loom-transcript 的 `Session` 结构，保留轮次、状态、回复及用量。将这个对象传给 `transcript.turnSummary(session, n)` 即可按 1 起算的轮次编号取 L1 摘要。工具和命令索引随解析对象保留在内存中。摘要包含轮次目标、工具调用数、可识别的非零退出命令和最终回复首段，使用 400 个 UTF-8 字节作为 token 数的保守上界。

```sh
node --test adapters/codex
```

验证使用 Codex CLI 0.171.0 与 hc 0.1.22。移植来源、实测记录和遗留问题见 [RESULT.md](../../tasks/ADAPT-codex/RESULT.md)。
