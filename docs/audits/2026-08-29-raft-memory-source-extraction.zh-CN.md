# Raft 记忆系统源码冻结与 RAH OS 移植账本

状态：**Source frozen / continuity + Run receipt + Human control + safe local reset landed**（2026-08-30）。

后续校准：当前默认行为以 [Raft 基线优先合同](../product/agent-memory-raft-baseline.zh-CN.md)为准。`memory-standing-prompt.js` 的原始 4,049 bytes 已纳入 `packages/agent-host/src/raft-memory/upstream-standing-prompt.ts`，只追加导出语句；源码 SHA 与实际 Worker prompt 正文均有一致性测试。其 Workspace 首段由独立 adapter 替换为 RAH 的私有路径绑定，其余 memory/compaction 原文不改。其他模块仍按下表的 structured-port/glue/未完成状态记录，不据此宣称整个记忆系统 100% 原样移植。

本文只回答三件事：Raft Computer 记忆实现的哪些代码已经取得并冻结；RAH OS 哪些代码确实由这些来源移植；哪些能力仍未接线。完整取证 bundle 不纳入产品；已选择的授权源码函数、结构化移植、来源哈希与差异按账本记录。个人使用授权不在本文件中表述为公开开源许可。

## 1. 证据边界

- 来源：本机官方 Raft Computer `1.0.18` 的 Node SEA JavaScript payload。
- 完整 `main.js` SHA-256：`20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。
- 取证目录：`/Users/sun/Code/repos/raft-runtime-forensics`。
- 可重跑提取器：`scripts/extract_memory_slices.py`；它先验证完整 bundle SHA，再用唯一源码地标切片，并校验固定 offset 和 SHA。未知版本直接失败，不会被误称为 1.0.18。
- 本轮没有读取任何登录凭据、私人 Room/DM，也没有读取用户现有 `agents/<id>/MEMORY.md` 或 `notes/` 内容。

Raft Server/Web 的完整服务端源码不在 Computer SEA 中。因此下表只把本机 bundle 能证明的行为写为“源码证实”；官网页面看到但本地 bundle 不含 owner 的部分仍是行为证据，不冒充源码。

## 2. 已冻结的 byte-exact 源码

| 切片                                |                offset / bytes | SHA-256         | 能证明的合同                                                               |
| ----------------------------------- | ----------------------------: | --------------- | -------------------------------------------------------------------------- |
| `memory-standing-prompt.js`         |  `32901550..32905599` / 4,049 | `b47ccf…e97f83` | `MEMORY.md` 是索引，细节进 `notes/`，主动更新，压缩前后恢复                |
| `memory-startup-prompt-assembly.js` | `32907041..32925741` / 18,700 | `52dbcc…d81092` | 所有 Runtime 共用 standing prompt；启动先读 memory，再取本轮所需文件       |
| `agent-workspace-initialization.js` |    `33252415..33253387` / 972 | `4786f4…5a3b2`  | 建立 Agent workspace，`MEMORY.md` 和 seeds 只在不存在时写入，建立 `notes/` |
| `onboarding-and-initial-memory.js`  | `33325605..33361528` / 35,923 | `e89786…c6fe4`  | 通用初始 memory 与 Cindy onboarding seeds                                  |
| `memory-cleaner-contract.js`        |  `33446819..33454329` / 7,510 | `54042e…2972a`  | cleaner config、阈值动作、普通文件测量、Inbox action materialization       |
| `agent-start-memory-bootstrap.js`   |    `34199343..34199790` / 447 | `4e6ab6…c00c0`  | 每次 Agent start 在选 Runtime 前建立/复用同一个 Agent workspace            |
| `agent-workspace-reset-method.js`   |    `34289180..34289609` / 429 | `c7ee24…7bd4`   | workspace reset 是显式递归删除，而不是普通 restart/session resume          |
| `memory-cleaner-constants.js`       |  `34448925..34449994` / 1,069 | `9be799…2a539`  | 默认 64 KiB、最小 4 KiB、默认一小时、最短 15 分钟                          |
| `memory-index-cleaner.js`           | `34479109..34492982` / 13,873 | `511835…31169`  | 周期测量、超限 transient Inbox、wake、阈值调整提示                         |
| `agent-workspace-reset-dispatch.js` |    `34622542..34622737` / 195 | `826a52…ee7e`   | `agent:reset-workspace` 是单独 daemon command                              |

完整文件名、landmark、绝对 offset、size 和 SHA 位于提取目录的 `memory-slices/manifest.json`。这里的缩写只用于阅读，校验始终使用 manifest 中的完整哈希。

## 3. 源码能够直接下结论的 Raft 设计

1. 记忆 owner 是稳定 Agent。目录是 `agents/<opaque-agent-id>/`，不是 Room、模型、Runtime 或 Provider session。
2. `MEMORY.md` 是每次启动和上下文压缩后的第一恢复入口；它应保持小而完整。
3. 大内容进入 `notes/user-preferences.md`、`notes/channels.md`、`notes/work-log.md` 或 domain note；索引只保留定位与活跃上下文。
4. 长任务前写 `Active Context`，完成后更新 notes 和 index。
5. Agent workspace、memory 与 Provider session descriptor 均可跨 provider process sleep/wake 持久；Provider session 不是 memory owner。
6. 普通 start/restart 不重写已有 memory。workspace reset 是独立、破坏性的命令。
7. 当前 cleaner 不替 Agent自动总结或向量化；它测量文件大小，超限后通过 Agent Inbox 唤醒并提醒整理。

这支持用户给出的产品定义：Agent 是长期人物；模型与 effort 是可替换运行配置；角色设定和 Agent 私有记忆不随 CLI/模型切换而消失。

## 4. RAH OS 首轮移植状态

| Raft 来源                                                          | RAH OS owner / 代码                                                                                                   | 移植性质                                | 当前证明                                                                                                                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildInitialMemoryMd`                                             | `packages/agent-host/src/agent-memory-workspace.ts` / `buildRaftCompatibleInitialMemory`                              | `structured-port`                       | 标题、Role、Key Knowledge、Active Context 初始结构与源码一致                                                                                                                                 |
| `initializeAgentWorkspace`                                         | 同文件 / `prepareAgentMemoryWorkspace`                                                                                | `structured-port` + security glue       | `MEMORY.md` 只 seed 一次；`notes/` 持久；增加 0700/0600、owner、symlink 和原子 create-if-absent 检查                                                                                         |
| Agent stable directory                                             | 同文件；Local/remote runtime composition                                                                              | `structured-port`                       | 只以稳定 `participantId` 派生 opaque 目录；不包含 Room、模型、RuntimeProfile、mount 或 Provider session                                                                                      |
| workspace/memory standing prompt                                   | `raft-memory/upstream-standing-prompt.ts`、`agent-memory-prompt.ts`                                                   | 两个纯函数 `byte-exact` + cwd/安全适配  | 固定 SHA；memory/compaction 原文保留；四个 native Provider 共享协议，旧冻结 prompt 不自动升级                                                                                                |
| 每次 start bootstrap                                               | `packages/daemon/src/runtime-profile-composition.ts`、`packages/agent-host/src/remote-runtime-profile-composition.ts` | `structured-port` + RAH activation glue | Local Core 与远程 Computer 均在真实 child 启动前建立同一个 Agent memory，并注入绝对路径                                                                                                      |
| cleaner measurement/copy                                           | `inspectAgentMemoryIndex`、`AgentMemoryCleanerRuntime`、`AgentMemoryHintInbox`、`AgentMemoryCoordinator`              | `structured-port`（host wake partial）  | Raft 边界、周期调度、revision fence、stable upsert 与 per-Agent transient typed App Inbox 已测试；Local/remote 下一次真实 Activation 已注入，独立 active notice/idle maintenance 尚未接线    |
| Run materialization proof                                          | `agent-memory-materialization.ts`、本机/远程 Runtime composition                                                      | `rah-os-glue`                           | child launch 前冻结 exact `MEMORY.md + notes/` digest/bytes/mtime 与 Run identity；只证明 Computer materialized，不冒充 model read                                                           |
| `createAgentAppInboxStore.list/ack`、`src/commands/inbox/check.ts` | `agent-memory-cleaner.ts`、`agent-app-inbox-transport.ts`、共享 CLI                                                   | `structured-port` + RAH capability glue | 当前 Run 的 check 只查看、ack 显式确认；原 typed hint owner 不变。额外版本校验防旧确认，显式 recheck 复用源测量；本机/remote 子进程通过，不是 idle maintenance 已完成                        |
| Human Memory control                                               | Human application service、Client SDK、Agent「工作区」                                                                | `behavior-port` + `rah-os-glue`         | Workspace ACL → stable participant → bounded relative-path inspect/read；desktop/PWA 已验证查看与刷新恢复                                                                                    |
| reset workspace                                                    | `AgentMemoryCoordinator.resetWorkspace`                                                                               | `structured-port` + security glue       | 已取得 exact method/dispatch；RAH 增加 Kernel global fence、Memory/Provider continuity 双 quarantine、rollback、幂等 receipt 与 Human 二次确认。本机正式 daemon/UI 已接，远程 transport 未接 |
| onboarding seed files                                              | 尚未接                                                                                                                | source frozen only                      | Cindy 特定内容不是通用记忆主链的前置条件                                                                                                                                                     |

RAH OS 有一个有意差异：Raft 直接以 Agent workspace 为 Runtime cwd；当前 RAH OS 的 cwd 是被选择的项目 WorkspaceMount。为避免多个 Agent 在同一个项目根争用一个 `MEMORY.md`，RAH OS 保留项目 cwd，并通过 `RAH_AGENT_MEMORY_DIR` 与 `RAH_AGENT_MEMORY_INDEX` 注入 Agent 私有绝对路径。这是承载适配，不改变 Agent-scoped / model-neutral 语义。

## 5. 已执行的真实边界测试

```text
node --test packages/agent-host/test/agent-memory-workspace.test.ts
node --test packages/agent-host/test/agent-memory-cleaner.test.ts
node --test packages/daemon/test/managed-mcp-runtime-composition.test.ts
node --test packages/daemon/test/agent-memory-runtime-continuity.test.ts
npm run typecheck
```

当前证据包括：

- 两个 Agent 得到不同 opaque workspace；路径不泄露 participant ID。
- 同一个 Agent 即使 AgentDefinition 文案变化也复用原 memory，且不覆盖 Agent 已写内容。
- root/workspace/notes 为 `0700`，index 为 `0600`；symlink alias fail closed。
- 真实 child process 经正式 `createConfiguredRuntime` 收到 memory 环境，能够读取 seed；首次 child 写出 oversized index 后，下一次跨 Room/Profile child 收到无 sender/Room/message/cursor 的 typed cleaner hint；该同一 Activation 同时通过版本围栏的 Managed MCP composition gate。
- 第一台受监督 child 在 Room Alpha / RuntimeProfile A 写入 index 与 note；关闭并重建 daemon 侧 Runtime Registry、切换到 Profile/模型标记 B 和 Room Beta 后，第二台 child 逐字读回相同路径与内容；另一个 Agent 在同一 Profile/Room 中得到不同路径且看不到前者内容。
- cleaner 只测量，不改写 memory；超限时为该 Agent stable-upsert 一项 `system.cleaner/memory_size_hint` transient App Inbox，低于阈值或 config revision 变化时撤销；15 分钟至 7 天 interval、4 KiB 至 1 GiB threshold 与 stale/revision-conflict 已由确定性 clock 门禁覆盖。
- Local Core 和 remote Computer 使用同一个 AgentHost owner，不存在 React 或 Provider driver 自建第二份 memory。

这证明的是“持久 memory workspace 已进入真实 Provider 启动链并跨 daemon 侧组合重建/Room/RuntimeProfile 延续”，不是“Agent 已在长时间对话中正确形成高质量记忆”。后者仍必须用真实多轮对话与浏览器 Agent profile 验收；本轮 Profile 中的模型值是受控 marker，不冒充付费真实模型调用。

## 6. 下一轮严格顺序

1. 当前 Run 的 scoped check/ack 已完成；新 prompt 与旧冻结 RuntimeProfile 的配对升级和当前版本真实模型对话验收仍需完成，不能用子进程脚本冒充 LLM 召回。
2. 建立与 canonical Activation 共用 per-Agent lane mutex 的 Computer-local maintenance job；接入 active Runtime safe notice/idle maintenance start，不能伪造 Room Message、sender 或 cursor，也不能把 LocalWakeSignal 当成已存在的 Activation。
3. 既有本机 Memory UI/安全 reset 保留；远程 Human control、跨 Computer handoff 和自主维护反馈独立补齐。
4. 暂不引入结构化 MemoryRecord/promotion、文本切分或 observer；只有 Raft 基线验证之后才讨论可回退增强。

## 7. 禁止误报

- 源码已冻结不等于所有 Server/Web memory 控制面源码均已取得。
- `MEMORY.md` 可持久不等于自动总结、检索质量、冲突治理或跨 Computer 同步已完成。
- Provider 能读 memory 路径和下一次 Activation hint不等于 active Runtime notice/idle maintenance 已有生产连接；Human UI 能 reset 本机 Agent 也不等于远程 Computer transport 已完成。
- 当前 Raft-compatible `full_access` Runtime 与 Agent 进程使用同一 OS 用户；0700/0600 防止其他 OS 用户和意外继承，但不是针对恶意同 UID Agent 的强 sandbox。真正的进程间保密需要未来的 per-Agent OS/container isolation，不能靠路径命名宣称完成。
- `ContextManifest.memoryPolicyRef` 是冻结 policy reference；新增 RunAttempt receipt记录 Computer 实际提供的 file snapshot，但它不证明 Provider/model 已实际阅读。
- 未接线的 active notice/idle maintenance、跨 Computer handoff、远程 Memory control 和 onboarding seeds 不得写成“已完成”。当前 scoped App Inbox CLI 已有子进程证据，不代表真实模型已采用新 prompt 或维护完成。
