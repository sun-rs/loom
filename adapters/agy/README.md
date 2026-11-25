# agy TUI 适配器

`index.mjs` 导出默认适配器 `agy`，实现 PROTO-1。源码为 JavaScript ESM，只有 Node 内建依赖。使用 Node 25 运行 `node --test adapters/agy`。实测版本为 macOS 上的 agy 1.5.16 和 hc 0.1.22。

## 启动

```js
import agy from './adapters/agy/index.mjs';

const { argv, env } = agy.launch({
  model: 'Gemini 3.8 Flash',
  effort: 'low',
  cwd: '/work/project',
  prompt: '检查当前项目。',
  hookSink: '/run/loom/worker-1/agy-hooks.jsonl',
  extraArgs: [],
});
```

由调用方在 `cwd` 下以 argv 启动，并将 `env` 合并到进程环境。对提供命名推理档位的常见模型，适配器把模型和档位合并成 `Gemini 3.8 Flash (Low)` 这样的选择。首轮走原生 `--prompt-interactive`，工具权限由 agy 的 `--dangerously-skip-permissions` 处理。

每次启动使用唯一的额外工作区，通过 `--add-dir` 加载其中的 `.agents/hooks.json`。配置目录建在 sink 的父目录。若该父目录位于工作区内，就使用 `os.tmpdir()`。会话级 `--settings` 为原工作区和额外工作区传入精确的 `trustedWorkspaces`，并将普通 Enter 固定为轮末排队。调用方可在进程结束后清理 `env.LOOM_AGY_HOOK_WORKSPACE`。 [配置发现](https://antigravity.google/docs/customization-discovery/) · [Hook 配置](https://antigravity.google/docs/hooks)

## 观测与投递

- `screen.classify` 接受当前 `hc read` 帧。新弹出的信任框默认选中 `Yes`，`screen.dialogKeys('trust-dialog')` 返回 `enter`。模型选择器返回 `esc`。
- 每次首次 `PreInvocation` 归一化为 `turn-start`，工具前后事件归一化为 `tool`，完全空闲的 `Stop` 归一化为 `turn-end` 或 `stop-failure`。成功 Stop 和正文可分别到达。hook 以工作区、会话 ID 和本轮起始步号核对可读的转录并提取 `finalReply`。如果转录还在写，调用方可以用核对过的 `transcriptText` 和 `turnStep` 再调用 `hooks.normalize`。
- `transcript.locate` 仅尝试指定会话 ID 对应的原生目录，优先 `transcript_full.jsonl`。`transcript.parse` 返回 loom-transcript v1 的 Session。`turnSummary` 接受这一对象和从 1 开始的轮号，报告任务、工具计数与名称、已知非零退出命令及最终回复首段。
- `input.plan('steer')` 降级为 `queue`。调用方按 PROTO-1 等到轮末可写后再投递。`interrupt` 先发 Esc 并确认原窗格可写，再提交新文本。原生取消可能缺少 Stop，调用方可通过 HC 的轮号和状态核对中断。

实测记录与转录验证范围见 [ADAPT-agy 结果](../../tasks/ADAPT-agy/RESULT.md)。
