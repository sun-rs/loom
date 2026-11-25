# ADAPT-codex 完成记录

交付入口为 `adapters/codex/index.mjs`。适配器使用纯 JavaScript、Node ESM 和零运行时依赖，提供原生 TUI 启动、屏幕识别、hook、rollout 解析和输入计划。

## 源码复用与胶水

Orca 来源固定于 `b7fd7caa3`，下表按落入目标源码的物理行计，含来源注释和转写。共 107 行。[Orca 固定版本](https://github.com/stablyai/orca/tree/b7fd7caa357a170f9fac6a49923f3b9ecf5ed0ea)

| Orca 文件 | 复制或转写的内容 | 目标行数 |
| --- | --- | ---: |
| `src/shared/shell/launch/shell-argument-quoting.ts` | POSIX 单引号转义 | 4 |
| `src/shared/agent-launch/startup/tui-agent-launch-command.ts` | 关闭启动更新提示和 POSIX 粘贴连发识别的参数 | 4 |
| `src/main/codex/trust/toml/config-toml-project-trust.ts` | 工作区信任设置转为 `-c` 内联值 | 2 |
| `src/main/codex/trust/identity/codex-trust-identity.ts` | hook 内容归一排序及 SHA-256 哈希 | 20 |
| `src/main/codex/hooks/definitions/codex-hook-identity.ts` | Codex 事件名与原生标签 | 9 |
| `src/shared/agent-launch/startup/agent-prompt-injection.ts` | 括号粘贴前后缀及提交间隔 | 4 |
| `src/main/runtime/terminal/output/startup-dialog-screen.ts` | 工作区信任框尾行与选项识别 | 7 |
| `src/main/runtime/terminal/wait/startup-dialog-blocked-signals.ts` | 模型迁移选择器尾行 | 2 |
| `src/main/runtime/__fixtures__/codex-model-capacity.txt` | 容量提示匹配，并提取为测试样本 | 2 |
| `src/main/codex/history/rollouts/codex-rollout-thread-id.ts` | rollout 文件名与 thread ID 辨认 | 13 |
| `src/main/codex/history/rollouts/codex-session-file-listing.ts` | JSONL 目录遍历 | 18 |
| `src/main/codex/history/rollouts/codex-rollout-session-meta.ts` | `session_meta` 有界头部读取，改为 Node 本地文件接口 | 22 |

实验目录的 `lib/codex.mjs` 和 `lib/screen.mjs` 分别保留 268、391 行相同源码。适配器源码共 1,187 行，自写胶水及修改共 421 行，主要是单次启动参数、事件归一与 JSONL 写入、输入计划、轮次工具归并和 L1 摘要。行数统计包含目录入口，排除测试代码和样本。观察事件字段沿用 `relay/hooks.mjs` 的思路，T3 对照了 `apps/server/src/provider/codexLaunchArgs.ts` 的参数分层。

2026-11-25 对照 GitHub `main` 快照 `05095dd11013`，表中的 11 个源码文件与固定版本的 blob 相同。[Orca 上游比较](https://github.com/stablyai/orca/compare/b7fd7caa357a170f9fac6a49923f3b9ecf5ed0ea...05095dd110132c0d4320a77ab7dcb0081130ebfa)

## 能力实测

在 `/Users/sun/Code/exp-relay/adapt-codex/live.UIVIEm3p/` 用 hc 0.1.22 拉起 macOS 上的 Codex CLI 0.171.0。`HOME`、`CODEX_HOME`、SQLite、日志和临时文件均在该试验目录。通过 llama.cpp `b12676` 加载 Qwen2.5-Coder-0.5B-Instruct Q4_K_M，CLI 及本地请求均记录 `low`。回环代理延长指定请求的忙碌窗口，回复由本地模型生成。[Qwen 模型](https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/tree/ebb2015119c907b064c512bf053e945850b5875f) · [llama.cpp 版本](https://github.com/ggml-org/llama.cpp/releases/tag/b12676)

| 能力或验证项 | 实测结果 |
| --- | --- |
| 启动和工作区信任 | 新 Git 工作目录的原生 `Folder access` 将首项标为 `Trust and continue`，Enter 进入 TUI。加入适配器内联参数后直接执行初始提示词。Codex 工作目录内只有测试用 `.git`。 |
| `hookInjection: 'cli-flag'` | `-c hooks.*` 及按次哈希通过启动审查。含空格与单引号的 sink 收到同轮 `UserPromptSubmit`、`Stop`，`last_assistant_message` 为 `4`。 |
| `steer: 'native'` | 忙时括号粘贴后按 Enter，原提示词和补充提示词的 `UserPromptSubmit` 共用 `turn_id`，该轮最终回复 `9`。 |
| 原生队列 | 忙时括号粘贴后按 Tab，屏幕出现队列提示。两个 `Stop` 分属连续两轮，回复依次为 `7`、`8`。适配器的默认 `queue` 计划等空闲后投递。 |
| `interrupt: true` | 分别在忙时按 Esc 和单次 Ctrl-C，两次均收到与正在执行的轮次对应的 `Interrupt`。 |
| `resumeSamePane: true` | 两次中断后分别在原 hc 窗格继续输入，保持同一 `session_id`，后续各产生一轮 `Stop`，最终回复均为 `6`。 |
| 选择器与会话 | `/model` 打开已识别的模型选择器，Esc 关闭。`transcript.locate` 与原生 Stop 路径一致，解析出八轮，包括两轮中断和一轮中途转向。 |

## 测试和清理

`node --test adapters/codex` 在 Node 25.9.0 上 36 项通过。测试覆盖 Orca 样本、实验样本和上述实测提取的脱敏屏幕、hook 及 rollout。hc 自建窗格 `t2yq`、`t2ys`、`t2yz`、`t2z2`、`t2z4` 均已通过 `hc kill` 结束。本地模型与回环代理已停止。

## 遗留问题

- 实测基线为 macOS、Codex 0.171.0 和本地小模型。托管模型、其他平台及 CLI 版本的 hook 哈希与键位兼容性待验证。
- 该版本原生取消走 `Interrupt`。缺少 Stop 的 provider 错误由上层结合屏幕状态判定。压缩 rollout 或仅 SQLite 存储的会话需要上层提供文本。
- `input.plan` 的步骤字段按当前任务接口交付，待 PROTO-1 定稿后对齐消费端。L1 工具明细随解析对象保留，跨进程使用时应在序列化前生成摘要。

STATUS: done
