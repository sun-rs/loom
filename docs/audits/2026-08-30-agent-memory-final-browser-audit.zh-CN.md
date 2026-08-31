# Agent Memory 最终代码与真实浏览器审查报告

日期：2026-08-30\
结论：**核心跨对话记忆链达到真实 CLI + 浏览器 E2；完整记忆产品尚未收口。**

> 阶段性报告说明：本文冻结的是 Run receipt、Human Memory UI 与 production reset 接线之前的真实 CLI 基线；其中相应“未实现”项已由后续 [Agent Memory 收口、Raft 源码对齐与 Multica PK 审计](./2026-08-30-agent-memory-closure-and-multica-pk.zh-CN.md) 更新。本文保留用于审计时间线，不作为当前状态来源。

本报告把“文件和单元测试存在”“受控 child 可以读写”与“人类从浏览器使用真实 Agent 后能跨对话召回”分开。最终判定只采信实际可观察结果，不把 prompt、spawn、Provider prose、exit 0 或测试桩单独视为完成。

## 1. 审计范围与判定

审查覆盖：

1. 稳定 Agent owner、Computer-local workspace、文件权限和 symlink 防护；
2. 本机与远程 Runtime composition 的 Activation 注入；
3. Room、DM、Provider session、RuntimeProfile 与 Agent identity 的边界；
4. cleaner、typed Agent App Inbox、全局独占 fence、Provider continuity quarantine 和 reset receipt；
5. 真实浏览器中的跨 Room/DM 形成、召回、不同 Agent 隔离和刷新恢复；
6. Browser Memory 管理、诊断、维护、reset、备份和跨 Computer 生命周期。

最终裁决分为两层：

- **核心数据路径：通过。** 一个稳定 Agent 可以在真实 Room Activation 中写入自己的 `MEMORY.md`，并在另一个独立 DM、另一个 RunAttempt 中准确召回；另一个 Agent 默认拿到不同 workspace，未读到该事实。
- **完整产品闭环：不通过。** autonomous maintenance、产品级 reset operation、Memory 浏览器控制面、RunAttempt materialization receipt、跨 Computer handoff 和记忆形成质量治理尚未完成。

## 2. 真实浏览器实验

### 环境

- 隔离临时 Workspace、Room 数据库、Runtime Registry 和 Agent memory 根；未读取或修改用户正式库。
- 桌面视口 `1440 × 1000`。
- Web 通过正式 `DaemonApplication`、Human API、Placement、AgentHost、真实 RuntimeProfile 和 canonical Room ledger 运行。
- 实际 CLI：OpenCode `1.18.22` 与 Kimi `0.38.0`。该 fixture 使用各自本机已配置的 Runtime 默认模型；本报告不把未冻结的具体模型名冒充为证据。
- 两个被测 ExecutionPolicy 都是 `sessionPolicy: fresh`，每条消息形成独立 Activation 和 RunAttempt。

### 步骤与结果

| 步骤 | 浏览器操作                                                                               | 可观察结果                                                                                   | 判定                                          |
| ---- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1    | 在 Channel `Agent Council` 加入 OpenCode，发送明确的长期记忆指令和唯一 marker            | Human Message 出现在 Room；OpenCode 真实运行后只回复“已记住”                                 | 形成路径通过，回复没有按要求泄露 marker       |
| 2    | 从 Agent 资料页创建与同一 OpenCode 的新 Direct Room；问题中不提供 marker，只询问先前代号 | 新 DM 中 OpenCode 准确回答 `ZEPHYR-7319`                                                     | 跨 Room/DM、跨 Activation/RunAttempt 召回通过 |
| 3    | 创建与 Kimi 的独立 Direct Room，询问同一问题且不提供 marker                              | Kimi 回答不知道，并说明自己的私有记忆没有该事实                                              | 不同 Agent 默认隔离通过                       |
| 4    | 刷新浏览器并重新打开 OpenCode DM                                                         | Human 问题和 Agent 召回答案仍从 canonical Room ledger 恢复                                   | 浏览器刷新恢复通过                            |
| 5    | 检查隔离 fixture 的 owner-private memory 根                                              | 恰好两个 opaque Agent workspace；只有 OpenCode 的 `MEMORY.md` 含 marker；两份文件均为 `0600` | 文件 owner 与逻辑隔离通过                     |

数据库证据进一步确认：两次 OpenCode 运行使用同一个 `participantId`，分别属于 `channel` 和 `direct` 两个 Room，拥有不同 Activation ID 和 RunAttempt ID；两次 Activation 都为 `completed`，两次 RunAttempt 都为 `exited`。因此结果不是浏览器本地状态、同一消息线程复读或同一 RunAttempt 的残留输出。

### 新发现的质量反例

Kimi 虽然正确隔离并回答“不知道”，但随后把这次一次性验收、Room identity 和“没有该事实”写入了长期 `MEMORY.md`。这证明当前 standing prompt 足以驱动主动写入，也证明其选择策略仍偏宽：**逻辑隔离已成立，记忆形成质量尚未闭合。** 一次性查询、无结果、测试探针和短期上下文不应默认成为长期记忆。

## 3. 代码审查结论

### 已闭合的核心

1. `prepareAgentMemoryWorkspace` 只以稳定 `participantId` 的 SHA-256 opaque key 建目录；Room、模型、effort、RuntimeProfile 和 Provider session 不参与路径身份。
2. `MEMORY.md` 使用 create-if-absent / seed-once；AgentDefinition 文案变化不会覆盖 Agent 已写内容。root、workspace、`notes/` 为 `0700`，index 为 `0600`，owner 和 symlink 检查 fail closed。
3. `createConfiguredRuntime` 与 `createRemoteConfiguredRuntime` 在真实 Activation environment 中注入同一个 Agent workspace；`GenericProcessAdapter` 先清除父进程伪造的 memory/App Inbox 环境，再只接受 lease 提供的值。
4. Runtime standing prompt 明确启动先读 index、按需读 notes、显著学习后主动维护，并区分 Agent 私有 memory、Room canonical truth 和 typed App Inbox。
5. cleaner 保持 Raft Computer `1.0.18` 的 64 KiB、interval/threshold/revision、stable upsert/drop 合同；它只测量和发 hint，不静默总结、截断或改写 memory。
6. reset core 使用 per-Agent Kernel durable fence、workspace quarantine、Provider continuity quarantine、`0600` receipt 和失败回滚；回滚不能证明安全时保留 fence。
7. 20 项 memory/fence 专项测试通过；完整 `npm run check` 通过：核心套件 `595` 项中 `593` 通过、`2` 项显式跳过，Web unit `25/25` 通过。

### 尚未闭合的 P0

1. **无 autonomous maintenance。** 正式本机 daemon 和远程 Computer 都以 `wake: () => false` 构造 coordinator；hint 只有下一次 canonical Activation 才会交给 Agent。没有 active Runtime safe notice、idle maintenance Runtime、scoped ack 或 source-recheck receipt。
2. **reset 仍不是产品能力。** `resetWorkspace` 的安全 core 有测试，但正式 `DaemonApplication` 和 `RemoteRuntimeProfileSet` 构造 coordinator 时没有注入 `acquireResetFence` 与 `quarantineProviderContinuity`；Human operation、API、远程 recovery 和 UI 均不存在。因此当前禁用 reset 按钮是正确的，不能称为完成。
3. **Memory 浏览器控制面不存在。** Agent「工作区」真实页面只显示“Workspace 文件树与安全读取 API 尚未接入浏览器”；无法查看 index/notes、大小、更新时间、cleaner 状态、receipt，也不能编辑、导出、备份、恢复、诊断或安全 reset。
4. **跨 Computer 语义未定义。** workspace 实际跟随当前 Computer 的本地副本。Agent placement 移到另一台 Computer 时没有 single-writer handoff、export/import、digest commit、回滚或冲突协议；不能宣称多 Computer 下仍是同一个人物记忆。

### 尚未闭合的 P1

1. 每个 RunAttempt 没有 Computer-owned memory materialization receipt；`ContextManifest.memoryPolicyRef` 不是实际 `MEMORY.md`/notes 的 digest、bytes、mtime 或本次 materialized refs，无法证明某次回答获得了哪一版 memory。
2. `memoryPolicyRef` 当前只是冻结引用，没有被解析成可版本化的形成、保留、删除和冲突策略；真实行为主要由一段全局 standing prompt 决定。
3. 没有结构化 write receipt、provenance、纠错/删除请求、superseded/retracted 机制或内容审查；本次 Kimi 的过度记录是实际反例。
4. `notes/` 依赖模型从 index 自行发现；无检索 index、budget、损坏检测、quota、长对话召回率、错误记忆率和冲突事实门禁。
5. App Inbox 当前只有进程内 transient cleaner item，无 durable registry、Computer-local scoped check/ack CLI 和 UI。
6. 本机 Agent 以同一 OS UID 运行。`0700/0600` 和 opaque path 能防偶然泄漏与其他 OS 用户，不能阻止恶意同 UID process 主动扫描其他 Agent 目录；当前只能称为逻辑私有，不是强 sandbox。
7. legacy daemon schema v2 的裸 `GenericProcessAdapter` 路径没有 memory coordinator 注入；正式 RuntimeProfile schema v3/v4 和远程 profile 路径已接入，但兼容路径的合同需明确弃用或补齐。

## 4. 收口顺序

1. **先加 RunAttempt materialization receipt。** 在目标 Computer 启动前记录 Agent、Computer、RunAttempt、index digest/bytes/mtime、bounded notes manifest 与 policy revision；它只证明“已提供”，不冒充模型实际阅读。
2. **接 Computer-local Memory control port。** 首版只做 bounded read、notes metadata、export、diagnostics；编辑使用 digest/ETag fence。Web 永远不拼绝对路径。
3. **完成 durable maintenance operation。** typed App Inbox → Kernel per-Agent fence → active safe notice 或 idle maintenance Runtime → source recheck/scoped ack → receipt；maintenance Runtime 不得拿 Worker Room credential。
4. **接安全 reset 产品 saga。** Human confirmation → durable operation → target Computer fence → memory/provider 双 quarantine → receipt →刷新恢复；再开放 Raft-compatible reset UI。
5. **定义跨 Computer single-writer handoff。** 先 park source Agent，冻结 digest，传输 owner-private bundle，target 验证并 commit，最后释放 source；不做无 owner 的 Markdown 双向同步。
6. **治理形成质量。** 默认只保留显式要求记住的事实、稳定偏好、可复用领域知识、重要决策/结果和长任务恢复点；默认排除一次性查询、无结果、测试探针、临时 Room 状态和可从 canonical 对象重建的正文。建立多 Provider、跨 20+ 对话的正确召回、误记、忘记、纠错和删除浏览器门禁。
7. **最后补 UI 与备份恢复。** desktop 和 `390 × 844` 同协议完成 Memory 查看、整理、export/import、reset confirmation、错误/离线/恢复状态与可访问性验收。

## 5. 最终发布裁决

当前可对外准确表述为：

> RAH OS 已实现 Raft-compatible、稳定 Agent-scoped 的本机 Markdown memory 基础链。真实 OpenCode 已在浏览器中跨 Channel 与 DM、跨独立 Activation/RunAttempt 成功形成和召回个人事实；另一真实 Agent 未获得该事实。

当前不得表述为：

> Agent Memory 已 100% 收口、可管理、可迁移、可安全 reset，或已达到 Raft 完整生命周期等效。

因此最终评级是：**核心连续性与跨对话召回通过；产品生命周期和治理未收口。** 在上述 P0 完成前，Memory 应标为实验性基础能力，而不是正式完成特性。
