# Raft Computer 1.0.18 后端对标差距分析

日期：2026-09-08。本次为**只读源码对标**：重新提取本机官方 `raft-computer` 1.0.18 的
SEA JavaScript payload，逐功能域与 rah_os 后端对照并判定差距。未修改任何产品代码，
未重启任何服务，未运行 raft-computer 或 rah_os 实例做行为对照。

本文与既有 [75 路由 Agent API 合同映射](../product/raft-agent-api-contract-map.zh-CN.md)
角度不同：那份映射覆盖 **Agent 面对的 Worker API**（agentApiContract.ts）；本文覆盖
**Computer/守护进程侧能力**（daemon 协议、Agent 进程生命周期、runtime 驱动、记忆、
工作区、心跳、配对、升级、诊断、K 层）。两边重叠处只引用结论，不重复计账。

## 0. 证据边界

- 来源二进制：`/Users/sun/.local/bin/raft-computer`，154,982,288 字节，Mach-O arm64；
  `raft-computer --version` 实测输出 `1.0.18`。
- 该 SEA **只含 Computer 侧代码**（`packages/computer/src`、`packages/shared/src`、
  `packages/sync-core/src`、`packages/trace-client/src` 与内嵌 `packages/daemon/dist`），
  **不含 Raft 中央服务端**。凡涉及"服务端会如何处理"的结论一律标注"行为推测"；
  只把 bundle 内可直接核实的代码标为"SEA 源码证实"。
- 对照侧：本仓库当前工作树的 `packages/{protocol,kernel,agent-host,core,daemon,
application-service,computer-protocol,k-carrier}`。rah_os 侧状态判定以源码与既有
  审计为据，**本报告没有重新运行任何 rah_os 测试或门禁**；引用既有报告时以其各自的
  验证层级为准。
- 证据层级沿用仓库惯例：E0＝设计/源码级判断，无实现或无运行；E1＝确定性单元/集成
  测试通过；E2＝真实 CLI/系统级可复现；E3＝与上游同条件对照通过。本报告本身最高只
  提供 **E0 级（源码对照）**结论；它发现差距，不关闭任何差距。
- 既有移植结论（记忆系统、四家 native 驱动、k-carrier 等）以
  [复用台账](2026-08-29-raft-multica-reuse-ledger.zh-CN.md)与
  [记忆源码冻结账本](2026-08-29-raft-memory-source-extraction.zh-CN.md)为准；
  本文不把已移植项重复报为缺口。

## 1. SEA 提取清单（本轮新做，可复跑）

Mach-O `NODE_SEA` segment / `__NODE_SEA_BLOB` section：file offset `91160576`，
size `34,983,781`。section 前 124 字节为 blob 头（含构建机 bundle 路径串，语义未
进一步解析，不据此下结论）；主脚本从 section 内 offset 124 开始：

| 项                     | 值                                                                   |
| ---------------------- | -------------------------------------------------------------------- |
| main.js 范围           | section `[124:34983781]`，34,983,657 字节                            |
| main.js SHA-256        | `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`   |
| 与 2026-08-29 冻结账本 | **完全一致**（同一 payload；该账本所有 offset 在本轮切片上复核成立） |

- 二进制绝对 offset = main.js offset + 91,160,700。
- 工作目录 `/tmp/rah-sea-extract/`（不纳入仓库）：`extract_sea.py`、`main.js`、
  `manifest.json`、`landmarks.json`（下文引用的全部 landmark 的 main.js/二进制双 offset）。
- 抽查复核旧账本三个地标：`memory_size_hint`（main.js 34,448,998 ∈ 旧切片
  34448925..34449994）、`agent:reset-workspace` 第二处（34,622,558 ∈ 34622542..34622737）、
  standing prompt 内 `MEMORY.md`（32,901,900 ∈ 32901550..32905599），全部成立。
- bundle 未压缩，含 esbuild 模块注释（`// packages/computer/src/...` 等 175 个模块
  标记）与原始符号名，可直接按模块枚举功能域。

## 2. SEA 功能域枚举（SEA 源码证实）

offset 均为 main.js offset；模块名取 bundle 内注释。

### 2.1 daemon ↔ 服务端 WebSocket 协议

- 连接层 `DaemonConnection`（off 34429872）：WS 连 `/daemon/connect`，Bearer apiKey；
  断线指数重连（1s→30s 上限）、入站静默 watchdog 后主动 `ping`、connect 超时强制
  重连、握手拒绝读 `slock-reason` 头（含 legacy key 已迁移的终态拒绝）。
- 入站消息目录（`summarizeIncomingMessage`，off 33594659；dispatch `handleMessage`，
  off 34621615）：`machine:context`、`agent:start`、`agent:start:wiki`、`agent:stop`、
  `agent:reset-workspace`、`agent:inbox:purge`、`agent:deliver`（带 traceparent/
  deliveryId/transient）、`agent:runtime_profile:migration`、
  `agent:runtime_profile:daemon_release_notice`、`agent:workspace:list`、
  `agent:workspace:read`、`agent:workspace:ensure-wiki`、`agent:skills:list`、
  `agent:diagnostic:session_transcript`、`agent:diagnostic:feedback_transcript`、
  `agent:activity_probe`、`machine:workspace:scan`、`machine:workspace:delete`、
  `machine:runtime_models:detect`、`machine:runtime_account_usage:refresh`、
  `machine:runtimes:rescan`、`machine:migration:workspace_preflight`、
  `machine:migration:source_workspace_archive`、`machine:migration_transport:lease`、
  `machine:migration:cancel`、`reminder.upsert/cancel/snapshot`、
  `ping`、`computer:restart`、`computer:upgrade`（带 durable operationId 重放抑制）。
  另：daemon 在自身关停时向服务端发出 `machine:shutdown` 通知（出站，携带
  lifecycleAcks，off 34550203），不是服务端远程关停命令。
- 出站消息：`ready`（capabilities+runtimes+runningAgents+hostname/os/daemonVersion/
  computerVersion/lifecycleAcks，`emitReady` off 34645335）、`agent:status`
  （active/inactive+launchId）、`agent:activity`（含 heartbeat 周期与 probe 响应）、
  `agent:session` / `agent:session:invalidate`（Provider session 描述符上报，off
  34228826）、`agent:start:ack`（queueState/queueDepth/queueAgeMs，off 34620789）、
  `agent:deliver:ack`、`agent:workspace:file_tree/file_content/wiki_ensured`、
  `agent:skills:list_result`、`agent:diagnostic:*_result`、
  `agent:runtime_profile(:migration:ack/:daemon_release_notice:ack/migration_done)`、
  `machine:workspace:scan_result/delete_result`、`machine:runtime_models:result`、
  `machine:runtime_account_usage:snapshot`、`machine:migration:*_result`、
  `computer:upgrade:progress/done`、`reminder.armed/arm_rejected/fire_request`、
  `pong`。
- `ready.capabilities` 静态含 `agent:start/stop/deliver`、`workspace:files`、
  `wiki-workspace-pack`、`reminder-fire-request`，另有按构建注入的
  `BUILT_IN_READY_CAPABILITIES` 与 supervisor mutation 能力位。**注意：1.0.18 没有
  RuntimeOffer 概念**（全 bundle 0 命中）；runtime 能力以 `ready.runtimes` +
  版本号发布。RuntimeOffer 是 rah_os 自有设计，不是未复刻项。

### 2.2 Agent 进程生命周期（daemon 内）

- `AgentProcessManager`（off 34127735）、`AgentStartCoordinator`（off 34067997）、
  `AgentLifecycleRecords`、`AgentNoProcessResidency(Transitions)`：Agent 逻辑常驻但
  进程可退出；idle/cooldown 状态缓存 restartSnapshot，新 deliver 触发
  `idle_auto_restart`（trace 名 `auto_restart_from_idle` off 34137130；
  `enterSpawnFailCooldownResidency` off 34143603）。
- 启动治理：`DEFAULT_MAX_CONCURRENT_AGENT_STARTS = 5`、启动间隔节流、
  `SPAWN_FAIL_BACKOFF_*` 连续失败退避+cooldown residency、`RuntimeBusyDeliveryCoordinator`
  （off 34107530）、`AgentStartPendingDeliveryBuffer`（启动期间 deliver 缓冲，启动后
  重放）、`agent:start:ack` 队列状态上报、`DEFAULT_STALLED_RECOVERY_SIGTERM_TIMEOUT_MS`
  stalled 恢复。
- 会话上报：`agent:session` 把 Provider session 描述符+launchId 报给服务端（含
  session 失效 `agent:session:invalidate`）；服务端可 `agent:inbox:purge` 让 daemon
  清掉指定 channel 的本地待投递缓冲（`purgeInboxMessagesForChannels` off 34165895）。
- `agent:activity_probe`：服务端点名探测某 Agent 当前活动（working/offline、
  pending injection debt），`respondToActivityProbe` off 34328257。
- runtime profile 变更通知：`agent:runtime_profile:migration` 与
  `:daemon_release_notice` 会把一条控制消息**注入正在运行的会话**
  （`deliverRuntimeProfileNotification` off 34626438）。

### 2.3 Runtime 驱动（12 个工厂，`driverFactories` off 34064857）

| driver        | 类位置 (main.js off) | rah_os 对应                                                       |
| ------------- | -------------------- | ----------------------------------------------------------------- |
| `claude`      | 33902121             | `claude-stream-json/v1`（已结构化移植，台账 §2026-08-29）         |
| `codex`       | 33930737             | `codex-app-server/v1`（同上）                                     |
| `kimi`        | 33996933             | —（Raft 标注 legacy；rah_os 用 `kimi-acp/v1` 替代）               |
| `kimi-sdk`    | 34016257             | —（Raft 当前 canonical Kimi，in-process SDK；rah_os 无 SDK 驱动） |
| `opencode`    | 34018756             | `opencode-server/v1`（同上）                                      |
| `grok`        | 33963591             | 无                                                                |
| `antigravity` | 33979638             | 无                                                                |
| `copilot`     | 33982939             | 无                                                                |
| `cursor`      | 33987868             | 无                                                                |
| `gemini`      | 33992396             | 无                                                                |
| `pi`          | 34055874             | 无                                                                |
| `builtin`     | 34058083             | 无（`BuiltInDriver extends PiDriver`，内置全托管 runtime）        |

四家主用 CLI 的 unattended/full-access、resume-or-fresh、session 私有存储等已在
台账记录为结构化移植；grok/antigravity/copilot/cursor/gemini/pi/builtin 与
`kimi-sdk` 超出首版四家范围（README/AGENTS.md 只承诺 Codex/Claude/Kimi/OpenCode）。

### 2.4 记忆系统

standing prompt（旧账本切片 32901550..32905599 复核成立）、启动装配、workspace
初始化、cleaner（`SystemCleanerRuntime` off 34479922）、Cindy onboarding seeds
（`FIRST_CINDY_SEED_MODE` off 33359421）、`ONBOARDING_DAY2_RECAP_PROTOCOL`。
rah_os 主链已移植（种子一次写入、Agent 稳定目录、全 Provider standing prompt、
cleaner 测量+typed App Inbox hint、reset fence）；**onboarding seeds 只冻结未接线**，
idle 主动维护未接线（旧账本 §4/§6 已如实记录，不重复计缺口）。

### 2.5 工作区与文件

- Human 经服务端浏览 Agent 工作区：`agent:workspace:list/read` →
  `file_tree/file_content`；daemon 侧过滤/上限（`WORKSPACE_TEXT_FILE_MAX_BYTES`、
  `WORKSPACE_SECRET_FILE_PATTERNS` 等）。rah_os
  `packages/agent-host/src/agent-workspace-browser.ts` 头部注释明确标注
  "Port: Raft Computer 1.0.18 workspace filters, types and bounds"，同源移植。
- 机器级工作区目录管理：`machine:workspace:scan`（`scanAllWorkspaces` off
  34307596）与 `machine:workspace:delete`（off 34307693）枚举/删除 agentsDataDir
  下的遗留目录。rah_os 有 root-scoped 树/扫描，遗留目录清理只有 memory reset
  单点（见 §5 表）。

### 2.6 Skills / Reminders / Inbox

- `agent:skills:list`（global+workspace 两集合，`SKILL_PATH_PREFIXES`）。rah_os
  `packages/agent-host/src/agent-skills.ts`、`packages/daemon/src/daemon-agent-skills.ts`
  已实现并有 2026-09-08 收口审计。
- `reminder.upsert/cancel/snapshot` 入站 + `reminder.armed/arm_rejected/
fire_request` 出站；`ReminderCache`、fire 重试（`DEFAULT_FIRE_RETRY_*`）、
  `REMINDER_INBOX_APP` 到期通知。rah_os `packages/kernel/src/reminder-service.ts` +
  `packages/agent-host/src/reminder-reconciler.ts` + 六个 Worker 端点已实现。
- Agent App Inbox（`createAgentAppInboxStore`、daemonApi inbox check/ack、
  `app-sources/ack`、scoped app storage 观测心跳）。rah_os App Inbox + `rah agent
inbox check/ack` + `rah app config --app system.cleaner` 已实现（Run-scoped）。

### 2.7 Provider 账号用量（runtime account usage）

`machine:runtime_account_usage:refresh` → collector（off 33582885）按 provider
采集配额/窗口快照并上报 `machine:runtime_account_usage:snapshot`：
codex 读 app-server rate limits、claude 读 usage 文本、kimi 读 usage；
`RUNTIME_ACCOUNT_USAGE_PROVIDERS = ["claude","codex","kimi"]`，快照含 account
label（脱敏）、window 状态、health 分类。rah_os **无任何对应物**（协议、Kernel、
daemon 均 0 命中）。

### 2.8 诊断导出与遥测

- `agent:diagnostic:session_transcript`：按需读取指定 Agent 的 Provider 会话
  transcript（`getSessionTranscript` off 34311246；带 runtime/sessionId/reachable/
  sizeBytes/truncated/redacted/tier），供"问题反馈附带 runtime transcript"使用。
- `agent:diagnostic:feedback_transcript`：按报告时间窗收集反馈 transcript
  （off 34316062，`FEEDBACK_TRANSCRIPT_REPORT_WINDOW_TOLERANCE_MS`）。
- 遥测管线：`LocalRotatingTraceSink`（off 34494449，本地滚动 trace 文件）、
  `DaemonTraceBundleUploader`（off 34499127，定时间隔+jitter 上传 trace bundle
  到中央）、`daemon-trace-bundle:create`、`services/diagnosticsPush.ts`（off
  34708458，用户触发诊断推送，写 correlation marker）。
- rah_os：问题反馈为**纯本地导出**（合同
  `docs/product/2026-09-02-agent-issue-report-contract.zh-CN.md`，明确不含
  runtime transcript、不发网络请求）；无 trace sink/上传管线；无 transcript 读取。

### 2.9 配对、认证与账号

- `services/login.ts`（off 2151864）：OAuth device authorization（`DeviceAuthClient
.authorize("raft-computer")`）+ `browserHandoff.ts` 浏览器回跳。
- `services/attach.ts`（off 2170482）：server slug 绑定、已有 attachment preflight、
  拒绝跨 serverUrl 混绑；`residentConnectionMarker.ts`、`serverState.ts` 管本地
  attachment 状态。
- 这是"中央账号→设备授权→Computer 凭证"拓扑；rah_os 范围文档明确不做中央账号，
  远程 Computer 配对端点列为发布缺口（README §Current status/ADR-0019）。

### 2.10 自动升级与 K 层

- `kResidentBinary.ts`（off 927696）：stable/experiment 双 slot 解析驻留二进制；
  `kPaths.ts`：`k/host-parked-set.json`、`k/host-runner-hold.json`；`kUpgrader/
kUpgradeProcess/kUpgradeReconcile/kUpgradeCoordinator/kRunnerHold/kHostAdapter/
kLifecycleSurface/kReleaseSource/kConsent`（终端交互确认升级，off 34941791）。
- `machineConvergenceReducer.ts`（off 34876058）：整机替换的 claim/arm/handoff/
  crash/receipt 收敛状态机。
- SEA 内嵌的 K 层与 rah_os vendored 的 `@botiverse/k-carrier@0.1.6`
  （`packages/k-carrier/SOURCE.md`）是**同一上游同族架构**（slot/hold/parked set
  命名一致）；rah_os 另有 signed release source、supervisor、operation receipt。

### 2.11 OS 服务层与其他

- `osSupervisor.ts/osSupervisorRuntime.ts`：launchd-user/systemd-user 双平台 +
  Windows PowerShell 环境（`windowsPowerShellEnv.ts`）；`legacySupervisorTakeover.ts`、
  `legacyOsSupervisorMigration.ts`、`services/adoptLegacy.ts`：旧 raft-daemon 接管。
- `shellEnvCapture.ts`（off 845970）：以 nonce 帧（`RAFT-ENV1`）从用户 login shell
  捕获真实环境（PATH 等），供 launchd 稀疏环境下发现用户 CLI。
- `logRotation.ts`（module 注释 off 2241309，`rotateLogIfNeeded` off 2241819）：
  按 UTC 日期改名滚动 + 超过 `LOG_MAX_DAYS = 14` 天清理。
- `DaemonMachineLockConflictError`（off 34492986）：同一 machine key 单实例锁，
  30s stale 判定。
- `machine:shutdown` 出站关停通知（off 34550203）：daemon 主动下线时携
  lifecycleAcks 告知服务端；**不是**服务端远程关停命令（入站目录无此类型）。
- 用户面 CLI：`attach/channel/doctor/list/login/logout/logs/restart/runners/set/
setup/show/start/status/stop/upgrade` 16 族；Agent 面 `slock` CLI 另有
  `agent/app/attachment/auth/inbox/integration/knowledge/manual/mention/message/
migrate/prepare/profile/reminder/server/task/thread/user/wiki` 等族。

## 3. 逐域对照判定总表

判定口径：**已对齐**＝rah_os 有对应 owner 且既有测试/审计记录（本文未重跑）；
**部分实现**＝能力存在但范围/机制有明确差异；**缺失**＝rah_os 无对应物；
**有意不做**＝有范围文档依据。rah_os 侧证据列为代码路径，验证层级以引用审计为准。

| #   | Raft Computer 能力（SEA 证据）                                                            | rah_os 对应（代码路径）                                                                                                                   | 判定                             |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1   | daemon WS 连接/重连/watchdog/握手终态（off 34429872）                                     | `packages/agent-host/src/remote-computer-agent-host-service.ts`、`node-k-carrier-computer-service-process.ts`（短会话/心跳/重连自有设计） | 已对齐（机制不同，角色等价）     |
| 2   | ready/capabilities/runtime 清单发布（off 34645335）                                       | `packages/daemon/src/runtime-offer-publisher.ts`、Kernel `runtime-offer-publication.ts`（RuntimeOffer 自有模型）                          | 已对齐（模型不同属 §8）          |
| 3   | Agent 进程生命周期/spawn 退避/no-process residency/idle 自动重启（off 34127735/34067997） | `packages/agent-host/src/agent-host.ts`、`multi-lane-agent-host.ts`、`runtime-error-policy.ts`（Activation 驱动，串行 lane+quarantine）   | 已对齐（机制不同）               |
| 4   | start:ack 队列状态/启动期 deliver 缓冲重放（off 34620789）                                | Activation coalescing/lease + follow-up merge（kernel activation-*）                                                                      | 已对齐（Kernel 侧等价）          |
| 5   | agent:status active/inactive+launchId                                                     | `packages/kernel/src/agent-presence.ts`、`raft-presence-projection.ts`                                                                    | 已对齐                           |
| 6   | agent:activity_probe 点名探测（off 34328257）                                             | presence/heartbeat 推模型；无"服务端点名即时探测"                                                                                         | 部分实现（推 vs 拉，低优先）     |
| 7   | agent:inbox:purge 本地缓冲清理（off 34165895）                                            | 无本地缓冲可清：Kernel 拥有 Inbox，成员变化事务内处理；远程无投递缓冲                                                                     | 已对齐（架构覆盖；见 §9 验证项） |
| 8   | agent:session/ invalidate 上报（off 34228826）                                            | 有意不上报：Provider session 为 Host 私有 opaque（AGENTS.md 不变量）                                                                      | 有意不做                         |
| 9   | runtime_profile migration/release_notice 注入运行中会话（off 34626438）                   | 无运行中注入；follow-up Activation 基线（live-input 审计已裁决）                                                                          | 部分实现（已记录延期）           |
| 10  | 12 runtime 驱动（off 34064857）                                                           | 4 native+generic+fake（runtime-implementation-registry.ts）                                                                               | 部分实现（4 已对齐；8 超范围）   |
| 11  | kimi-sdk canonical 驱动（off 34016257）                                                   | `kimi-acp/v1`（ACP 传输，Multica 移植）                                                                                                   | 部分实现（传输路线不同）         |
| 12  | 记忆主链（standing prompt/cleaner/reset）                                                 | agent-host agent-memory-*（已移植，台账）                                                                                                 | 已对齐                           |
| 13  | onboarding seeds（Cindy，off 33359421）                                                   | 只冻结未接线（台账 §4 明示）                                                                                                              | 部分实现（已知，低优先）         |
| 14  | workspace list/read 浏览（dispatch case off 33595949）                                    | `agent-workspace-browser.ts`（同源移植标注）                                                                                              | 已对齐                           |
| 15  | machine:workspace:scan/delete 遗留目录（off 34307596/34307693）                           | root 扫描已有；遗留目录 GC 只有 memory reset 单点                                                                                         | 部分实现（N04 已记录）           |
| 16  | agent:skills:list                                                                         | `agent-skills.ts`、`daemon-agent-skills.ts`                                                                                               | 已对齐                           |
| 17  | reminder 全家（upsert/cancel/snapshot/fire_request）                                      | kernel reminder-service + agent-host reconciler + 6 Worker 端点                                                                           | 已对齐                           |
| 18  | Agent App Inbox + app config                                                              | agent-app-inbox-transport、app-config CLI                                                                                                 | 已对齐                           |
| 19  | **runtime account usage 采集/上报**（off 33582885）                                       | 无                                                                                                                                        | **缺失**                         |
| 20  | **session transcript 按需读取**（off 34311246）                                           | 无（issue report 合同明示不含 transcript）                                                                                                | **缺失（有合同边界，见 §5）**    |
| 21  | feedback transcript 收集（off 34316062）                                                  | 本地导出问题反馈（不含 transcript）                                                                                                       | 部分实现（合同已裁决本地方案）   |
| 22  | **trace sink/bundle 上传管线**（off 34494449/34499127/34708458）                          | 无                                                                                                                                        | **缺失（见 §5 争议讨论）**       |
| 23  | **logRotation 14 天滚动清理**（module logRotation.ts）                                    | 无（launchd stdout 日志无界）                                                                                                             | **缺失**                         |
| 24  | OAuth device login/attach/中央配对（off 2151864/2170482）                                 | 无（Host 凭证+LAN 配对自有模型；远程配对端点=已知发布缺口）                                                                               | 有意不做（拓扑不同）             |
| 25  | K 层升级（slot/hold/convergence，off 927696/34876058）                                    | vendored k-carrier 0.1.6 + computer-upgrade-* + managed-computer-operation                                                                | 已对齐（同上游）                 |
| 26  | computer:restart/upgrade durable 操作+重放抑制+progress/done                              | Kernel schema v10 single-flight + operation receipt + `computer:upgrade` 流程                                                             | 已对齐                           |
| 27  | machine:shutdown 出站关停通知（off 34550203）                                             | drain→offline 生命周期与 receipt（remote-computer-agent-host-service）                                                                    | 已对齐（角色等价）               |
| 28  | launchd+systemd+Windows 服务层                                                            | 仅 macOS launchd（macos-_-launch-agent_）                                                                                                 | 有意不做（单 Mac 范围）          |
| 29  | legacy raft-daemon 接管/迁移                                                              | 无（无 legacy 包袱）                                                                                                                      | 有意不做                         |
| 30  | shellEnvCapture login shell 环境捕获（off 845970）                                        | 安装期冻结 PATH 进 plist（macos-local-core-product-operator.ts:232）                                                                      | 部分实现（机制差异，见 §5）      |
| 31  | machine lock 单实例（off 34492986）                                                       | Unix-socket 单实例+singleton HMAC attestation                                                                                             | 已对齐                           |
| 32  | 用户面 computer CLI 16 族                                                                 | Computer 工件仅内部 `__*` 命令；Local Core 有 install/uninstall/help                                                                      | 部分实现（产品形态不同，见 §5）  |
| 33  | 凭证代理（agent-credential-proxy，off 33011252）                                          | per-Activation Worker bearer + loopback Worker API（更严模型）                                                                            | 已对齐（机制不同）               |
| 34  | opencli/slock wrapper 注入                                                                | worker-tool-transport.ts `rah` wrapper                                                                                                    | 已对齐                           |
| 35  | Agent migration 传输/归档/恢复（off 34508671 等）                                         | 无（随远程 Computer 延期）                                                                                                                | 有意不做（已延期）               |
| 36  | Wiki workspace pack（off 34065784）+ start:wiki                                           | 无                                                                                                                                        | 缺失（decision-needed，见 §5）   |
| 37  | external agent integration（off 797747）                                                  | 无                                                                                                                                        | 缺失（decision-needed，见 §5）   |
| 38  | 托管 MCP 代理/目录                                                                        | 已退役                                                                                                                                    | 有意不做（退役文档）             |
| 39  | OAuth scopes/应用市场/集成注册/计费                                                       | 无                                                                                                                                        | 有意不做（中央商业功能）         |
| 40  | activity kinds/trajectory 投影（AGENT_ACTIVITIES 5 态）                                   | protocol/runtime-activity.ts（同形枚举）                                                                                                  | 已对齐                           |

## 4. 缺失且重要（首版范围内）

按当前范围文档（单 Mac、单 Human、多 Agent、四家 CLI）筛选后，SEA 有而 rah_os
没有、且不属任何已记录延期/退役的后端缺口只有两项达到"重要"线：

- **B1 Provider 账号用量采集（runtime account usage）**。SEA：`machine:
runtime_account_usage:refresh/snapshot`，按 claude/codex/kimi 采集配额窗口与
  health（off 33582885、18592 区 schema）。rah_os：协议/Kernel/daemon 全部无对应
  （0 命中）。单 Human 自己管理各家 CLI 账号，配额可见性直接服务"本机实际使用"
  （范围文档原话）。缺它不影响工作链正确性，但用户无法在产品内看到账号余量。
  建议列为首版后端候选缺口；UI 展示面另列前端缺口。
- **B2 日志轮转**。SEA：`logRotation.ts` 按日滚动 + 14 天清理。rah_os：launchd
  `core.stdout.log` 与 `~/.rah/logs/*` 均无界增长，无滚动/GC（本机实测
  `~/.rah/logs` 已存在多个 restart 日志）。属运维卫生项，严重度低但确定缺失。

## 5. 缺失但有争议（需产品裁决，不擅自消账）

| 项                                                            | SEA 证据                                    | 争议点                                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Wiki workspace pack + `agent:start:wiki` + knowledge/wiki API | off 34065784、`WIKI_WORKSPACE_PACK_*`       | 合同映射已标 decision-needed：是否暴露 Wiki 产品未定；不能以私有 MEMORY 代替                                            |
| External agent integration（外部 Agent 唤醒证明链）           | off 797747、`agent-comms-core.v1` 等 schema | 非 Raft 托管的外部 Agent 接入；本地首版是否承认此类身份未裁决                                                           |
| session transcript 按需读取                                   | off 34311246（带 redacted/tier/truncated）  | issue-report 合同明示首版导出**不含** transcript；但"Computer 侧读取诊断 transcript"是独立能力，是否永远排除未裁决      |
| trace sink + bundle 上传                                      | off 34494449/34499127/34708458              | 本地优先产品无中央上传目标；但**本地滚动 trace 文件**对排障有独立价值，是否建立本地 trace 管线未裁决                    |
| runtime_profile 变更注入运行中会话                            | off 34626438                                | 属 live-input 家族；既有审计已裁决 follow-up Activation 为可靠基线并给出最小协议草案，重启该题需走那条评审              |
| machine:workspace:delete 遗留目录 GC                          | off 34307693                                | N04 已记录：清理须排除活跃 Agent、目录身份+执行 fence+失败回执；当前只有 memory reset 单点                              |
| shellEnvCapture 动态 login-shell 捕获                         | off 845970                                  | rah_os 安装期冻结 PATH；安装后新增 CLI 路径不会被发现（需重装/修复）。是否加运行时 login-shell 捕获属机制选择，非纯缺口 |
| 用户面 computer CLI（status/logs/restart/upgrade 等 16 族）   | §2.11                                       | rah_os Computer 工件只有内部命令；当前产品形态下运维走 Web/launchd，但未来远程 Computer 产品化时用户面 CLI 是预期物     |
| agent:activity_probe 拉模式探测                               | off 34328257                                | rah_os 全推模型已覆盖在线/活动展示；点名探测只在推模型失真时有边际价值                                                  |

## 6. 有意不做（范围文档依据）

| 项                                                     | 依据                                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 中央账号/OAuth device login/attach/设备授权拓扑        | AGENTS.md："Raft 的中央账户、计费和中继拓扑不是需求"；ADR-0019                               |
| 托管 MCP 目录/代理/调用                                | `docs/product/managed-mcp-retirement.zh-CN.md`："Raft 此功能继续存在也不再构成 RAH 首版缺口" |
| 应用市场/集成注册/OAuth scope 目录/订阅计费/上传配额   | 合同映射 §1："订阅/账单/额度/中央账号/应用市场不做"                                          |
| 多 Human/邀请/公开频道非成员 parity                    | `docs/product/single-human-mainline-and-multi-human-backlog.zh-CN.md`                        |
| Agent 跨 Computer migration                            | 合同映射 migrationBegin/Ready/Arrived/Status 四行已标 deferred（远程 Computer 未来项目）     |
| 大文件 S3 直传 session                                 | 合同映射："大文件流式待核实项目继续延期"                                                     |
| systemd-user/Windows 服务层                            | 首版单 Mac；`osSupervisor` 的 launchd 部分已由 macos-_-launch-agent_ 覆盖                    |
| legacy raft-daemon 接管                                | 无 legacy 包袱（README：clean architecture）                                                 |
| Provider session 上报为业务状态                        | AGENTS.md 不变量："Provider session IDs are opaque metadata"                                 |
| feedback transcript 中央上传                           | issue-report 合同：纯本地导出，不发网络请求；未来 endpoint 需另立合同                        |
| grok/antigravity/copilot/cursor/gemini/pi/builtin 驱动 | README/AGENTS.md 首版四家 CLI；"future CLIs are replaceable runtime slots"                   |

## 7. 已对齐（防止重复报缺口）

下列项在旧账本/近期审计中已有实现与各自验证记录，本文不再列为缺口：记忆主链
（standing prompt byte-exact、seed-once、Agent 稳定目录、cleaner 测量+typed App
Inbox hint、安全 reset）；四家 native 驱动（claude/codex/kimi-acp/opencode，含
full_access、resume-or-fresh、Host 私有 session、终端证明）；workspace 文件浏览
（同源移植过滤/上限）；skills；reminders；App Inbox+app config；K 层升级（vendored
k-carrier 0.1.6 同族）；computer restart/upgrade durable 操作与 receipt；Worker
凭证模型（per-Activation bearer，替代凭证代理）；`rah` worker CLI wrapper；activity
五态与 trajectory 投影；presence；doctor；单实例锁；runtime/model 检测与目录探针；
连接恢复/心跳（自有短会话设计）；launchd 服务层（macOS）。

## 8. Computer 协议层兼容差异（packages/computer-protocol、k-carrier）

- **协议所有权不同（有意）**：`packages/computer-protocol/src/index.ts` 是 RAH 自有
  合同（`ComputerSessionOpenRequest` 要求 `placement_pull`/`runtime_offer_publish`/
  `runtime_activity_publish`/`terminal_proof`/`worker_credential_issue` 能力位），
  与 Raft daemon WS 协议（`/daemon/connect` + 上列入/出站消息目录）**不存在线上
  互通意义**；rah_os 不连 Raft 中央服务端，Raft Computer 也不能直接挂到 rah_os
  Core。这是 local-first 范围决定，不是缺陷。
- **投递模型相反（有意）**：Raft 是服务端 push（`agent:start`/`agent:deliver` 推给
  常驻 WS，daemon 本地缓冲+模型可见性台账）；rah_os 是 Computer pull（placement
  pull + content-free hint + Kernel durable Inbox/Activation + activation-scoped
  Worker 拉取）。两者都满足"通知可丢、恢复走持久状态"，但同一条"消息已送达模型"
  的证据链形状不同：Raft 靠 daemon 侧 delivery ack/可见性台账，rah_os 靠 Worker
  delivered-cursor ack。任何未来桥接都必须先做这层语义映射，不能直连消息类型。
- **能力发布模型不同**：Raft `ready.runtimes`（清单+版本号）vs rah_os RuntimeOffer
  （immutable、probe 摘要、Placement 引用）。RuntimeOffer 更严，是自有增强。
- **K 层同族**：SEA `kPaths/kResidentBinary/kRunnerHold/kUpgradeReconcile` 与
  rah_os vendored `@botiverse/k-carrier@0.1.6` 共享 slot（stable/experiment）、
  `host-parked-set.json`、`host-runner-hold.json` 等概念与文件名；rah_os 的本地
  适配（signed materializer、0700 slot、HostAdapter）见 `packages/k-carrier/
SOURCE.md`。升级机制层不存在兼容性缺口。
- **kimi 传输路线不同**：Raft 1.0.18 的 canonical Kimi 是 in-process SDK 驱动
  （`kimi-sdk`，legacy `kimi` 标 deprecated）；rah_os 用 ACP（`kimi-acp/v1`，
  Multica 移植）。同一 Provider、不同线协议；功能上各家均已通过真实 K3 门禁
  （各自证据），不构成缺口，但若未来以 Raft 会话描述符互认需注意不可互换。
- **session 描述符可见性**：Raft 把 Provider session 描述符上报服务端做业务展示；
  rah_os 有意保持 Host 私有。若未来出现任何 Raft 兼容 facade，此差异必须先经
  产品裁决。

## 9. 前端 / 后端 / 验证缺口分列

- **后端缺口**：B1（账号用量采集）、B2（日志轮转）为当前范围内确定缺失；§5 表
  为待裁决项；Agent API 面（task amend/delete、Agent 本人频道 mute/unmute、附件
  评论等）由 75 路由映射继续跟踪，本文不重复计账。
- **前端缺口（仅由本文后端发现派生）**：B1 若立项需要 Settings/Computer 页的账号
  用量展示面；B2 无前端面；其余前端 parity 缺口沿用既有前端审计，不由本文新开。
- **验证缺口**：
  1. 本文是 **E0 级源码对照**：未运行 raft-computer 与 rah_os 的任何行为对照
     （拓扑不同也无法直接双边）；SEA 侧结论为源码证实，rah_os 侧状态以引用审计
     各自的 E1/E2 证据为准，本报告没有重跑任何门禁。
  2. `agent:inbox:purge` 的"架构覆盖"判定建议补一条确定性反例：Agent 被移出
     Room 后不再收到该 Room 的新投递（含远程 lane），再改为已对齐。
  3. B1/B2 若立项，需各自先写失败测试（采集器假 provider fixture；轮转假时钟+
     临时目录），再实现；不接受"代码看起来有"作为关闭证据。

## 10. 禁止误报

- SEA 源码证实 ≠ 中央服务端实现证实；本文对服务端行为的判断全部标注为推测或
  仅列 Computer 侧事实。
- 提取 SHA 与 2026-08-29 冻结账本一致 ≠ 旧账本所有移植结论今天仍成立；rah_os 侧
  当前状态以本报告引用的代码路径与近期审计为准。
- "rah_os 有对应 owner" ≠ 该能力已达 Raft 双边验收；各引用审计的验证层级（E1/
  E2/浏览器/真实 CLI）分别成立，不互相升级。
- 本文不给出任何"完成百分比"；缺失项逐条列出即全部结论。
- `decision-needed` 项未经用户裁决不得实现、也不得写成已完成或已延期。
