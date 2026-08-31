# Provider 模型与 effort 目录审计

日期：2026-08-28\
结论：**当前 Multica 的跨 Provider 发现框架最完整；旧 RAH 在 Claude、Codex、OpenCode 的单 Provider 深度上更强；授权取得的 Raft Computer `1.0.18` 执行路径成熟，但模型目录主要是静态表。RAH OS 不复制任一实现，而是吸收机器可读发现、可执行映射、缓存与失效语义，并保持 model/effort 选择 fail closed。**

## 1. 审计范围与证据

- 授权取得的 Raft Computer `1.0.18` bundle：`main.js` SHA-256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`；Raft daemon CLI `1.0.17` SHA-256 `fcb16538c2954aa87e9cd958345b84f25be81bbfb7ee097e85563b9e7a653ac0`。审阅其 first-party source map、shared `RUNTIME_MODELS`、Codex app-server availability probe、ACP、Kimi 与 OpenCode catalog probe。该 bundle 没有 `model/list` 字面量或 Codex 动态目录调用证据；不能把成熟的 Codex app-server 执行路径误报成动态模型发现。
- Multica 官方仓库固定到 commit `46c9ea38a7de97a670c244fbceb2bd3a2bd8b2bf`，重点审阅 [`models.go`](https://github.com/multica-ai/multica/blob/46c9ea38a7de97a670c244fbceb2bd3a2bd8b2bf/server/pkg/agent/models.go)、[`thinking.go`](https://github.com/multica-ai/multica/blob/46c9ea38a7de97a670c244fbceb2bd3a2bd8b2bf/server/pkg/agent/thinking.go) 与 [`runtime_model_catalog.go`](https://github.com/multica-ai/multica/blob/46c9ea38a7de97a670c244fbceb2bd3a2bd8b2bf/server/internal/handler/runtime_model_catalog.go)。这比早期审计使用的 commit 新，已包含 Kimi ACP 模型发现、版本门槛与 server last-known-good 目录缓存。
- 旧 RAH 只读比较 `packages/runtime-daemon/src/claude-model-catalog.ts`、`codex-model-catalog.ts` 与 `opencode-model-catalog.ts`，不复制旧项目代码。
- 本机只读探测 Claude `2.1.234`、Codex `0.149.1`、Kimi `0.38.0`、OpenCode `1.18.22` 的机器可读目录和 help；不以截图或模型名称猜参数。Claude 使用 CLI 自己的 stream-json `control_request.initialize`；Codex 先读取可刷新的 `debug models`，离线、旧版本或无有效结果时才读取同一 CLI 二进制携带的 `debug models --bundled`。

原始 CLI 输出可能包含 Provider 配置，因此只用于本机即时裁剪，不进入 Room、Kernel、日志或 probe digest；持久化的是 redacted binding。

## 2. 谁写得最好

| 范围                 | 最强实现                                    | 原因                                                                                                                                                        | 不直接照搬的原因                                                                                                                                                |
| -------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 跨 Provider 总体架构 | Multica                                     | Provider/ACP-specific probe、per-model thinking metadata、60 秒 Computer cache，以及 server 端 60 秒 refresh/24 小时 last-known-good stale-while-revalidate | 单文件 Provider 分支很大；中心 Server 为 NAT 后 Computer 建模的 pending/timeout 协议不应直接复制到 Local Core                                                   |
| Claude               | 旧 RAH / 当前 RAH OS                        | 旧 RAH 通过官方 SDK `supportedModels()`；RAH OS 直接使用同一 Claude CLI 的 typed control initialize，得到当前账户可用模型和 per-model effort                | Multica 与 Raft `1.0.18` 仍依赖手写模型表；RAH OS 不嵌入 SDK 自带的平台二进制，只保留有界、只读的 CLI 握手                                                      |
| Codex                | 旧 RAH（最深）/ Multica 与 RAH OS（可移植） | 旧 RAH 分页读取 app-server `model/list`；Multica/RAH OS 用 `debug models`，RAH OS 另有 bundled 离线 fallback                                                | Raft `1.0.18` 只有静态 `RUNTIME_MODELS`；RAH OS 当前 generic process 启动无需为目录引入整个 app-server 生命周期                                                 |
| OpenCode             | 旧 RAH（最深）/ RAH OS（可移植）            | 旧 RAH 的本机 server API还读取 context/defaults/agents；RAH OS/Multica 的 verbose CLI 目录可发现 variants                                                   | 运行 server 只为目录探测成本较高；RAH OS 采用 `models --verbose --pure`，保留部分 stdout 并向旧 CLI 回退                                                        |
| Kimi                 | 当前 Multica + 本机 Kimi 0.38.0 可执行源码  | ACP 模型发现叠加 `provider list` per-model effort；Kimi 0.38.0 本身还读取 `KIMI_MODEL_THINKING_EFFORT` 作为 per-process override                            | RAH OS 复用该原生 override，不修改用户配置；模型 argv、effort 环境和受控子进程穿透均已回归                                                                      |
| 缓存与断线           | Multica（远程）/旧 RAH（本机）              | Multica 有 server last-known-good；旧 RAH 有短 TTL/SWR/in-flight dedupe                                                                                     | RAH OS 已有按 probe kind、路径、可执行文件内容摘要、cwd 的 60 秒成功缓存和 in-flight 去重；仍缺显式 refresh/new immutable report 与有来源标识的 last-known-good |

## 3. RAH OS 采用的协议

```text
CLI / app-server / ACP machine-readable catalog
  -> bounded, shell-free host probe
  -> observed reasoningOptions + defaultReasoning
  -> adapter conformance filters executable supportedReasoning
  -> immutable RuntimeProfileProbeReport digest
  -> redacted RuntimeOffer descriptor
  -> exact Placement model binding
  -> shell-free argv expansion
```

核心不变量：

1. `reasoningOptions` 是观察结果；`supportedReasoning` 是可以实际传给当前 adapter 的子集。
2. `default` 表示不发送 selector，不是假定某个 effort。
3. Provider 可新增 token；协议允许最长 64 字符的安全标识，但拒绝空白、shell 字符和保留值 `default`。
4. 目录顺序、显示名、默认值和说明来自 Provider，不按截图或固定列表重排。
5. exact binding 不匹配、参数映射缺失、目录无效时 fail closed；不能把模型名或 effort 拼进 shell。
6. Kimi 0.38.0 的 `supportEfforts/defaultEffort` 只有在同一已探测二进制同时提供 `KIMI_MODEL_THINKING_EFFORT` 原生 override 时才进入可编辑执行配置；映射始终作用于单次子进程。
7. 成功且非空的目录可短暂缓存；空目录和失败不缓存。缓存 key 必须包含可执行文件内容摘要，不能让升级后的 CLI 继承旧能力。
8. 原始控制响应可能包含账户信息；probe 只投影 `models` 中的 redacted 字段，绝不记录完整响应。

## 4. 当前实现结果

- Claude：通过本机 CLI 的 stream-json `control_request.initialize` 获取账户级 machine-readable catalog；使用空 tools、空 setting sources、无 session persistence、safe mode、15 秒超时和 4 MiB 上限；只序列化模型数组，不保留账户或完整响应。模型映射为 `--model`，只有该模型明确 `supportsEffort` 时才发布 `--effort`。
- Codex：优先解析刷新后的 model catalog，失败时回退 bundled catalog；两条路径归一为同一 binding，均保留原生顺序、`displayName`、`defaultReasoning`、说明、service tier，以及 `low/medium/high/xhigh/max/ultra` 等动态 token；使用已验证的 `model_reasoning_effort` argv mapping。
- OpenCode：优先 `models --verbose --pure`，解析每个模型的 variants 并映射为 `--variant`；15 秒超时；非零退出但 stdout 可用时保留有效结果；旧版 verbose 不支持或无结果时退回纯模型列表，不虚构 effort。
- Kimi：解析模型、显示名、`supportEfforts/defaultEffort`；`supportedReasoning` 来自同一 CLI 目录，并由 `KIMI_MODEL_THINKING_EFFORT` 写入本次启动环境。
- Web：模型下拉使用 Provider 显示名；reasoning 下拉保持 Provider 原生顺序和标签，不再由 `low/medium/high/max` 固定 enum 截断新档位。
- Protocol：probe report 与 offer 都携带 redacted metadata；只有 `probed/certified` binding 进入 Agent 配置。
- Host probe cache：只缓存成功非空目录 60 秒，按 probe kind、绝对 executable path、可执行文件 content digest 与 cwd 隔离，并对并发相同探测去重；返回 structured clone，调用方不能修改缓存证据。
- 刷新安全：同一 active Runtime revision 的周期 probe 若观察到 model binding contract 改变，现有 Offer 立即转为 unavailable，要求重启/重新导入后用新 report 建立执行闭包；不会让新 Offer 描述与旧启动 mapping 混用。

## 5. 尚未收口

1. Codex 的动态 `debug models` 已满足 generic-process profile 的无推理请求发现；以后若 L1 Codex app-server 成为正式 Runtime adapter，再增加分页 `model/list` backend，并归一到同一 binding schema，不能为 UI 建第二套目录。
2. Host registry 仍需要“显式刷新 + 有来源标识的 last-known-good”状态；当前 60 秒缓存只减少重复子进程，不替代不可变 probe report。刷新必须创建新 report/offer，不能改写历史。
3. Kimi ACP/SDK adapter 的 `set_config`/thinking 协商与运行时回读仍可作为未来增量能力，但不再阻塞 generic-process 的 per-launch effort 选择。
4. Claude 已用 typed control handshake 接入；其他 Provider 仍只有在存在机器可读目录或 typed handshake 时接入，不维护手写的营销模型列表。
5. 后续每个新 Provider/binding 都必须用真实 Room/Task gate 核对最终 argv 与 canonical 业务结果；禁止使用 GPT-5.6 Ultra。下节列出的三个当前目标已经完成，不能外推到其他模型或 effort。

## 6. 真实执行证据

2026-08-28 在隔离 state/workspace、非正式 daemon 上完成：

| Provider | 精确选择                                       | canonical 结果                                                        |
| -------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| Codex    | `gpt-5.6-sol` + `model_reasoning_effort=low`   | 完成 Task claim/start/progress/submit 与 Inbox acknowledge；约 181 秒 |
| Kimi     | `kimi-code/k3`，不发送 effort                  | 完成同一 Task 链；约 69 秒                                            |
| OpenCode | `deepseek/deepseek-v4-flash` + `--variant max` | 完成同一 Task 链；约 15 秒                                            |

同日再次执行无推理请求的本机目录门禁：Claude 得到 4 个当前账户可选模型，Codex 动态目录得到 6 个模型，Kimi 得到 4 个模型，OpenCode 得到 45 个模型。Claude 的 Default/Opus/Sonnet 各报告五档可执行 effort，而 Haiku 没有；Codex `gpt-5.6-sol` 报告六档 effort；Kimi K3 的三档 effort 由同一 0.38.0 CLI 的原生环境 override 提升为 executable；OpenCode variant 是 executable。数量是本机当前账号、配置与 CLI 版本的观察值，不是产品常量。

最初 Codex 门禁暴露了一个与模型目录无关但影响真实可用性的协议缺口：只把临时 `rah` wrapper 放到 PATH，会被 Provider 的 login shell 重建 PATH。修复后 AgentHost 同时发布非敏感的绝对 `RAH_WORKER_CLI`，prompt 固定调用 `"$RAH_WORKER_CLI" worker ...`；bearer 仍只存在 owner-private `0600` session file，旧 raw token/token-file 环境变量继续被清除。门禁仍只以 Kernel Task/Inbox 证明成功，Provider exit=0 或 prose 不能替代 acknowledge。
