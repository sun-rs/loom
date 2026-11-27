# 无头 Worker 合约

新建无头会话统一走 OAR 0.130.1。Codex、agy、Claude 和 OpenCode 由独立的 `session-host` 启动。Worker 线由 OAR 托管，新增特殊 worker（包括 Claude TUI worker）也须实现同一合约。

## 接入

- 按 OAR 的 `dist/contracts/runtime.d.ts` 实现 `Runtime`，提供 `installation` 和 `session`，并在 Loom 的 runtime registry 和 CLI 映射中注册。启动接收 `cwd`、模型、effort、会话环境和可选的原生 `resume` ID。OAR 的 `dist/agents/types.d.ts` 中 `SpawnOptions` 是上层派工合约，由调用方选择 runtime 和任务，底层 runtime 仍通过 `Session` 实现。
- `dist/contracts/session.d.ts` 定义 `prompt`、可选的 `steer`、`abort`、`status`、`events`、`records`、可选的 `nativeSessionFile` 和 `dispose`。输入保留 Loom 投递 ID，原生确认关联同一会话、流和轮次。正文以轮末证据为准，缺少确认时标为待证。
- 宿主拥有原生进程、控制权、请求回执和事件落盘，并在轮边界记录 Git 快照。loomd 负责排队、角色路由、转录查找、Git 差异、证据卡及历史。

## 生命周期

Worker 宿主在下次派工时随发布更新。loomd 升级接回原宿主，保留 PID、会话和事件流 ID。HOTSWAP-4 的 Worker 宿主热切路径退役。已在运行的旧 Codex pipe 会话仍能接回并运行到退出。长期角色的 TUI 继续由 holder v3 托管。

活跃 loomd 的已认证状态查询续期宿主控制权。宿主状态目录消失、控制权连续五分钟未续期、收到终止信号或原生进程退出时，宿主释放原生进程并关闭。状态目录存在时会持久化结束记录。正常运行期间以定时目录检查和退出事件判断生命周期，关闭时才枚举需要回收的子进程。

此合约的范围是进程归属、输入控制和原生事件。跨厂商会话迁移、Worker 宿主原地换码及长期角色的终端渲染在范围之外。

## 集成卡

在集成卡写明固定候选 SHA、项目全量命令和要采集的证据，派工时传 `loom spawn worker --integration`。测试使用卡片私有的 `$TMPDIR`。宿主为 `PATH` 上的 `ps` 提供本卡进程树查询，同样可通过 `$LOOM_TEST_PS` 调用。进程查询返回 PID、父 PID、进程组、UID、启动时间及可执行文件名。`command` 和 `args` 字段也只返回可执行文件名。绝对路径 `/bin/ps` 仍受原沙箱限制。

集成配置沿用同一提供方的网络和凭据权限。Worker 在原生回执记录候选 SHA、完整命令、退出码、计数和工作树日志路径，由 loomd 采集证据卡。共享 `.project/` 下的摘要由 Leader 根据证据卡整理。

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
# 无头会话的空闲保留

`.project/policy.json` 的 `workers.warmMs.<cli>` 按 CLI 设置缓存窗口，默认 600000 毫秒。旧的 `workers.idleRetainMs` 仍提供通用默认值。预期一次续作的派工可加 `--keep-warm`，续作获原生回执后清除保留。Leader 可用 `loom release <task>` 提前释放。自动释放及门禁关闭均要求 Worker 空闲、最终结果获原生投递回执，且没有在途投递或续作。临时 Reviewer 和交接失败的继任会话也在结论送达并空闲到期后清理。只有日志渠道时，`loom notifications --take` 记录实际领取。

Status 和 Leader 摘要显示 `working`、`idle-warm`、`offline`、`closed`，以及缓存窗口倒计时、上下文比例和结果标签。向离线任务排队发信或执行 `loom assign --resume-attempt <task>` 会用原 UUID 恢复无头 Worker。Auditor 原生回复 `APPROVE` 后，loomd 关闭相关波次或 barrier 的会话。显式 `loom stop` 也会关闭 Worker。历史、证据及工作树随原任务保留。

派工回执记录新建、恢复或续作及其理由。按门禁统计新建、恢复、关闭和 TTL 下线次数。冷恢复的 token 数使用缓存窗口到期后原生续作首个用量样本，缺少用量时显示覆盖数。Status 和 Cost 的 RSS 对项目中已核验的会话进程树求和，共用物理页按各进程的 RSS 计入。

`workers.reuseMaxContext` 默认 0.6，`workers.reuseMaxCompactions` 默认 1。Leader 确认紧邻小卡属于同领域和同工作树后，用 `loom send --next-card` 复用原 Worker。loomd 要求已用上下文 ≤60%、累计压缩 ≤1，并用原生证据核对上一卡无已核实事实错误或越权。续卡沿用项目级 Git 保护规则，Leader 核对续卡自己的可写范围。卡内续作和 R1/R2 不改接口的局部返工继续交给原 Worker。换领域、方向被否、R3、造假或越权时另开修复卡，附精确的 RED 复现。

`workers.handoffMinCompactions` 默认 1，`workers.handoffMinRemaining` 默认 0.15。已达到压缩次数且压缩后的新读数显示剩余窗口再次低于下限时，在步骤边界交接。loomd 提供草稿，Worker 用 `loom worker-handoff` 补齐在做工作及验收结果。交接单包含任务、分支、SHA、WIP 和生效裁决。定稿和原生结果送达后关闭旧 Worker。常驻角色默认首次压缩后在卡片边界换班，按角色使用 `rotateAtCompactions` 配置。

活动轮次连续 10 分钟无进展时，状态显示 `no-progress`。Leader、Auditor 或 Super 可用 `loom worker-handoff <task|addr>` 获取交接草稿。确认造假或越权时，用 `loom worker-handoff <task|addr> --reason fabrication|overreach --evidence TEXT` 记录证据并生成草稿。草稿保留原 Worker 的运行和原生记录，由 Leader 决定何时停止及派接手人。

新 Worker 启动时收到卡片约定、裁决摘录和相关项目记忆。loomd 派工前核对分支、基线 SHA、WIP 行数和裁决摘要，Worker 修改前通过 `loom worker-check` 复核并在首报确认。发现不一致时停止并报告 BLOCKED。

状态与 Leader 摘要同时显示上下文比例、压缩次数和复用判断。看板按门禁统计实际复用、阈值退役及退役时的平均已测量上下文比例。另列 `REJECT` 后有新建或恢复 Worker 开始工作的回合数，以及后续门禁已裁决和获批准的回合数。同一回合采用两种方式时，两组都计入。
