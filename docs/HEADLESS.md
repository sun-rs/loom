# 无头 Worker 合约

新建无头会话统一走 OAR 0.130.1。Codex、agy、Claude 和 OpenCode 由独立的 `session-host` 启动。Worker 线由 OAR 托管，新增特殊 worker（包括 Claude TUI worker）也须实现同一合约。

## 接入

- 按 OAR 的 `dist/contracts/runtime.d.ts` 实现 `Runtime`，提供 `installation` 和 `session`，并在 Loom 的 runtime registry 和 CLI 映射中注册。启动接收 `cwd`、模型、effort、会话环境和可选的原生 `resume` ID。OAR 的 `dist/agents/types.d.ts` 中 `SpawnOptions` 是上层派工合约，由调用方选择 runtime 和任务，底层 runtime 仍通过 `Session` 实现。
- `dist/contracts/session.d.ts` 定义 `prompt`、可选的 `steer`、`abort`、`status`、`events`、`records`、可选的 `nativeSessionFile` 和 `dispose`。输入保留 Loom 投递 ID，原生确认关联同一会话、流和轮次。正文以轮末证据为准，缺少确认时标为待证。
- 宿主拥有原生进程、控制权、请求回执和事件落盘，并在轮边界记录 Git 快照。loomd 负责排队、角色路由、转录查找、Git 差异、证据卡及历史。

## 生命周期

Worker 宿主在下次派工时随发布更新。loomd 升级接回原宿主，保留 PID、会话和事件流 ID。HOTSWAP-4 的 Worker 宿主热切路径退役。已在运行的旧 Codex pipe 会话仍能接回并运行到退出。长期角色的 TUI 继续由 holder v3 托管。

此合约的范围是进程归属、输入控制和原生事件。跨厂商会话迁移、Worker 宿主原地换码及长期角色的终端渲染在范围之外。

## 用量估算

`loom cost` 同时展示原始 token 与按 CLI 加权的美元估算和角色占比。它按轮把新输入、缓存写入、缓存命中、输出分别计价。推理 token 已计入原生输出时只计一次。未记录的用量保持缺失。

在 `.project/policy.json` 的 `cost.prices.<cli>` 覆盖 `freshInput`、`cacheWrite`、`cacheRead`、`output`。未覆盖的字段使用下表。单位为美元／百万 token。参考档按 2026-11-26 的公开价格选取，用于比较角色成本，各模型、订阅和缓存时长的实际账单可能不同。

| CLI | 参考档 | 新输入 | 缓存写入 | 缓存读取 | 输出 |
|---|---|---:|---:|---:|---:|
| Codex | GPT-5.4 | 2.50 | 2.50 | 0.25 | 15 |
| agy | Gemini 3.1 Pro，≤200k | 2 | 2 | 0.20 | 12 |
| Claude | Sonnet 4.6，缓存写入 5 分钟 | 3 | 3.75 | 0.30 | 15 |
| OpenCode | DeepSeek Flash，高峰 | 0.30 | 0.30 | 0.006 | 1.20 |

非 Claude 的缓存写入按各参考档的新输入价格估算。此视图省略缓存存储时长及服务费。[OpenAI](https://developers.openai.com/api/docs/models/gpt-5.4) · [Google](https://ai.google.dev/gemini-api/docs/pricing) · [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing) · [DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/)
