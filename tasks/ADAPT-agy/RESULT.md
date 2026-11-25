# ADAPT-agy 交付结果

已交付 `adapters/agy/` 的 Node ESM 适配器，字段和输入计划与 PROTO-1 一致。`node --test adapters/agy` 通过 16 项。测试使用 loom-transcript 实验的转录与屏幕样本，以及本次采集并脱敏的原生 hook、OSC 和屏幕样本。

## Orca 来源

使用固定 commit `b7fd7caa357a170f9fac6a49923f3b9ecf5ed0ea`。下表按 JavaScript 中落地的摘录物理行计，来源注释除外。代码保留 Orca 路径和 commit。

| Orca 文件 | 摘录 | 行数 |
| --- | --- | ---: |
| `src/main/antigravity/hook-events.ts` | 四个 hook 定义和空操作响应 | 14 |
| `src/main/antigravity/hooks-json-bundle.ts` | 普通事件与工具事件的节点形状 | 10 |
| `src/main/agent-hooks/installation/configuration/hook-config-schema.ts` | hook 超时常量 | 1 |
| `src/shared/agent-hook-listener/providers/antigravity/antigravity-event-rules.ts` | `fullyIdle` 判定 | 3 |
| `src/main/antigravity/antigravity-transcript-import.ts` | 会话目录、ID 校验、full 优先 | 6 |
| `src/shared/agent-hook-listener/transcript-lines.ts` | `<USER_REQUEST>` 正文提取 | 10 |
| `src/shared/shell/launch/shell-argument-quoting.ts` | POSIX 参数引用 | 4 |
| `src/main/runtime/agent-state-rules/antigravity.json` | 输入框的三行界面标记 | 1 |
| `src/shared/agent-launch/permissions/tui-agent-permissions.ts` | agy 权限参数 | 1 |
| `src/shared/agent-launch/startup/tui-agent-launch-command.ts` | agy 禁用启动自动更新 | 1 |
| 合计 | | 51 |

复用 `exp-relay/orca/lib/agy.mjs` 的 342 行和 `exp-relay/orca/lib/screen.mjs` 的 593 行，转录增加轮内记录回调，屏幕层导出原本的 ANSI 清理函数，两份文件净增 5 行。自写胶水共 445 行，含这 5 行和其余启动、hook 收集、L1 摘要、输入计划及入口代码。测试和文档另计。

另外核对了 Orca 的目录信任字段和 ACP 目录参数。上述十个文件以及这两个参考文件，在对比时均与 GitHub `main` 的 `05095dd110132c0d4320a77ab7dcb0081130ebfa` 逐字节一致。 [Orca 固定版本](https://github.com/stablyai/orca/tree/b7fd7caa357a170f9fac6a49923f3b9ecf5ed0ea) · [对比版本](https://github.com/stablyai/orca/tree/05095dd110132c0d4320a77ab7dcb0081130ebfa)

## 能力实测

macOS、hc 0.1.22、agy 1.5.16。集成复跑由 `agy.launch` 生成参数，原生 hook 确认实际模型为 `gemini-3.8-flash-low`。工作目录和本次 hook 工作区都位于 `/Users/sun/Code/exp-relay/adapt-agy/`。测试进程的文件写入由 macOS sandbox 限定在实验目录，终端设备用于交互。 [实测记录](</Users/sun/Code/exp-relay/adapt-agy/live-1795542798948/evidence.jsonl>)

| 能力 | 实测 | 声明 |
| --- | --- | --- |
| 启动与信任 | 新目录出现信任框，默认选中 `Yes`，按 Enter 后同窗格进入输入框。集成启动使用会话级 `trustedWorkspaces`，首轮直接执行，实际工作目录无 `.agents`。手动打开 `/model` 后用 Esc 关闭。 | `trust-dialog → enter`，`picker → esc` |
| Hook 注入 | `--add-dir` 加载该次启动的额外工作区。收到首次 `PreInvocation`、`read_file` 前后 hook 和 `Stop`。 | `hookInjection: 'project-file'` |
| 最终回复 | `Stop` 的 `fullyIdle` 为 `true`，随后同轮原生 OSC `done` 携带 `AGY-ADAPTER-OK`。按轮核对后归一化为 `turn-end` 与 `finalReply`。 | 首轮成功 |
| 忙时输入 | 第 2 轮仍在 `working` 时投递文本。原轮先 Stop，随后新一轮开始并回复 `AGY-ADAPTER-QUEUED`。在固定队列设置下经 hc 发送 Alt+M 的试次也在原轮结束后开新轮。 | `steer: 'tui-queue'`，steer 请求降级为 queue |
| Esc 和 Ctrl-C | 两次均在 `working` 时发送。hc 轮号推进并回到 idle，PID 与 agy `conversationId` 保持一致，随后分别收到 `AGY-ADAPTER-ESC` 和 `AGY-ADAPTER-CTRL-C`。 | `interrupt: true`，`resumeSamePane: true` |

实际工作窗格 `t2z7` 和本任务的 11 个探测窗格均经 `hc kill` 核对为 `finished`。实测样本已去掉机器路径、发送者和会话标识，保留事件顺序及无害回复。

## 遗留问题

- 1.5.16 原生 TUI 拒绝 `--gemini-dir`、`--app-data-dir` 和 `--conversation-path`。隔离的进程主目录进入登录选择器。使用既有原生登录时，Stop 报告的转录位于 agy 默认数据目录，试验沙箱阻止了该处落盘。因此真实短回复由同轮 Stop 与 OSC 完成事件核对，磁盘转录的定位、正文提取和防串轮由样本及 hook 子进程测试覆盖。生产完整正文仍应以已绑定的转录为准。
- 两次真实中断均未收到对应取消 Stop。运行端需要结合 hc 的轮号与同窗格空闲状态确认，随后再执行输入计划。

STATUS: done
