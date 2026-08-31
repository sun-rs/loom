# Agent Memory 收口、Raft 源码对齐与 Multica PK 审计

后续更正：本文记录的是当时版本。第 2.5 节的额外形成门槛/跳过清单已由[策略收缩审计](./2026-08-30-memory-policy-retraction-audit.zh-CN.md)撤回；旧 Multica 对比不代表最新源码。`15280617` 已实现 Hermes 的 Agent/profile 级跨任务记忆，并限制 Codex 原生自动记忆。当前七次真实模型与双边页面证据、准确完成边界，以[最新审计](./2026-08-30-real-memory-acceptance-and-product-audit.zh-CN.md)为准。

日期：2026-08-30\
裁决：**本机正式产品的记忆主链已闭合到 E2；Raft 的自主 maintenance wake 与 RAH OS 多 Computer single-writer handoff 尚未闭合，因此不能宣称整个 Memory 子系统 100%。**

本报告替代此前“Memory 浏览器控制面、RunAttempt receipt、production reset 均未实现”的阶段性结论。这里的“完成”必须同时具备 owner、协议、正式组合、隔离测试和浏览器可观察结果；只有源码或组件存在不算完成。

## 1. 上游证据与边界

### Raft

- 授权来源：本机官方 Raft Computer `1.0.18` Node SEA payload。
- 完整 payload SHA-256：`20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。
- 固定提取目录：`/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/memory-slices`。
- 已冻结的关键合同：stable per-Agent workspace；`MEMORY.md` 作为小索引；`notes/` 保存细节；seed-once；每次启动先读 index；显著学习主动更新；长任务使用 Active Context；64 KiB cleaner；typed transient App Inbox；显式 workspace reset。
- cleaner 源码只执行测量、mint/drop typed item 并调用 `wake(ownerAgentId, item)`，不会自行总结、向量化、截断或改写 Memory。wake 后的 Runtime notice/restart 属于 Computer 生命周期组合，不应伪造成 Room Message。
- Raft 的 reset 切片直接递归删除 workspace。RAH OS 复用其产品语义，但没有复制缺少 terminal fence、Provider continuity rollback 和重放幂等的危险实现。

### Multica

官方 Agent 文档把 Agent 定义为可复用的 identity/configuration，模型、runtime、thinking 可换，历史不因此丢失；这与 RAH OS 的长期 Agent identity 一致。但官方 open issue #838 明确陈述当前 Agent **没有跨 issue 的持久记忆**，workspace memory 仍是 proposed solution。因此不能把 Multica 的 Task/Issue history 或静态 `workspace.context` 冒充为已实现的 per-Agent episodic memory。

Multica proposal 中值得吸收的是：typed name/description/content、只注入 index、按需读取、CRUD。它的 proposal scope 是 workspace，而用户要求和 Raft 源码证明的是 per-Agent 私有人物记忆；二者未来应分层，不能直接合并 owner。

## 2. 本轮重要修复

### 2.1 RunAttempt materialization receipt

新增 Computer-owned immutable receipt：

- identity：Agent participant、AgentDefinition revision、Computer、Room、Activation、RunAttempt；
- policy：`memoryPolicyRef`；
- content：`MEMORY.md` 与递归 `notes/` 的安全相对路径、SHA-256、bytes、mtime；
- aggregate：snapshot digest、receipt digest、materializedAt；
- proof scope：固定为 `computer_materialized_not_model_read`。

同一 RunAttempt 重放时只允许完全相同 identity/snapshot/policy；任何 Memory 变化都会 fail closed。receipt root 和文件均 owner-private，runAttemptId 先 hash 后进入文件名。Browser snapshot 与 receipt 现在共用“`MEMORY.md` 必须首项、notes 严格排序、路径不重复”协议，远程实现不能向客户端提交歧义树。

这解决了旧 `ContextManifest.memoryPolicyRef` 只能证明策略引用、不能回答“Computer 启动时提供了哪一版文件”的问题。它仍有意不声称模型真的阅读或采用了这些内容。

### 2.2 正式 Runtime 链接

receipt 与 Memory environment 已接入：

- 本机 RuntimeProfile v3/v4；
- 远程 Computer Runtime composition；
- legacy daemon schema v2 兼容路径。

因此不存在“新 profile 有 Memory、旧兼容 adapter 静默跳过”的第二行为路径。真实 process continuity gate 已证明第二个 RunAttempt 的 receipt 包含第一次运行写入的 note，且 snapshot digest 随内容变化。

### 2.3 Human Memory control

Human application service 新增鉴权后的 get/read/reset：

1. 先使用 Workspace Agent management ACL 解析 `AgentDefinitionId`；
2. 再映射稳定 participant owner；
3. read 只接受 `MEMORY.md` 或安全 `notes/...` 相对路径；
4. Computer 端拒绝 path traversal、symlink、hardlink、非 owner 文件、非 UTF-8、读取期变化和超过 1 MiB 的文件；
5. 公开响应不暴露本地 workspace/quarantine 绝对路径。

Agent「工作区」现展示 Computer、正常/需要整理状态、文件树、bytes 与只读正文。它不是 React 自己扫描文件，也不把 localStorage/Provider transcript 作为 Memory。

### 2.4 安全且幂等的 reset

正式本机 daemon 现为 reset 注入：

- Kernel global per-Agent exclusive fence；
- Memory workspace quarantine；
- `ProviderSessionStore` per-Agent continuity quarantine；
- cleaner config rollback；
- owner-private durable receipt。

Human 必须提交固定确认字面量与 idempotency key。operation identity 从 owner + key 确定性派生；相同请求重放只返回原 receipt，不能再次删除下一次 Activation 已重新 seed 的 workspace。receipt 前任何失败会回滚 Memory 与 Provider continuity；回滚失败则 fence 保持 fail closed。

### 2.5 记忆形成策略

standing prompt 保持 Raft 的“启动先读 index、按需读 notes、主动维护、Active Context”，并补充可测试的形成门槛。只有同时满足 durable/repeatedly useful、跨 Room/Run 仍有价值、安全可留存时才默认写入。明确排除：

- 当前日期/时间；
- 一次性查询和失败查找；
- 测试 marker/probe；
- 临时 Room identity；
- raw transcript/tool output；
- 可轻易重算的事实。

使用工具本身不构成“应记忆”的理由。Human 的 forget/correct 要求必须删除或修订目标，同时保留必要 canonical 引用并诚实标注 superseded，不能静默把冲突拼成一个事实。

## 3. 真实浏览器结果

### 既有真实 CLI 记忆门禁

- OpenCode 在 Channel 形成唯一 marker；
- 同一个 Agent 在新 DM、fresh Provider session、独立 Activation/RunAttempt 中准确召回；
- Kimi 使用不同 Agent owner，无法读取该 marker；
- 刷新浏览器后 canonical Room history 和召回答案仍恢复；
- 文件证据只有 OpenCode workspace 含 marker。

### 本轮 Human control 门禁

使用隔离 fake CLI fixture、正式 daemon/Human API/AgentHost，不接触用户正式数据：

| 视口          | 操作                                                   | 结果                                               |
| ------------- | ------------------------------------------------------ | -------------------------------------------------- |
| `1440 × 1000` | Room 发消息 → Agent 实际运行 → Agents → Alice → 工作区 | 展示真实 Computer、`MEMORY.md`、bytes 和 seed 正文 |
| `1440 × 1000` | 点击 reset → 查看二次确认 → 取消                       | 确认态出现；取消后消失；未执行破坏操作             |
| `1440 × 1000` | reload → 重新进入工作区                                | 同一 `MEMORY.md` 仍由 Computer 返回                |
| `390 × 844`   | 移动端 Agents → Alice → 工作区                         | 文件树、正文和 reset 入口可见，无第二实现路径      |
| 两者          | 浏览器 console                                         | 无 error/warning；只有 Vite/React development info |

最终 destructive click 没有在浏览器中执行，因为它会真实删除/隔离数据；其 fence、双 quarantine、rollback、receipt 和 HTTP idempotency 由 disposable integration tests 覆盖。浏览器已验证危险动作之前的产品确认协议。

## 4. Raft / Multica / RAH OS PK

| 维度                      | Raft Computer 1.0.18                                                    | Multica 当前公开实现                               | RAH OS 当前                                                     |
| ------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| 长期 owner                | stable Agent                                                            | Agent identity/history；无跨 issue episodic memory | stable Agent participant                                        |
| 模型/CLI 可替换           | 是                                                                      | 是                                                 | 是                                                              |
| index + details           | `MEMORY.md + notes/`                                                    | 未实现；issue 提议 entry index + on-demand content | `MEMORY.md + notes/`                                            |
| seed-once                 | 是                                                                      | 不适用                                             | 是                                                              |
| 每 Run 实际文件证明       | 未在冻结切片发现                                                        | 无                                                 | 有，且不冒充 model read                                         |
| cleaner                   | 64 KiB typed Inbox + wake                                               | 无公开等价实现                                     | 64 KiB typed Inbox + next Activation；autonomous wake 未完成    |
| Human read UI             | Raft 产品有 Agent workspace 交互，但冻结源码不足以证明全部 Server owner | 无 per-Agent episodic memory UI                    | 本机正式 API + desktop/PWA read-only UI                         |
| reset                     | 递归删除                                                                | 不适用                                             | global fence + 双 quarantine + rollback + idempotent receipt    |
| structured CRUD/retrieval | Markdown 由 Agent 操作                                                  | proposal 有 typed CRUD/index-only injection        | 尚未增加 structured shared knowledge；避免与 private owner 混淆 |
| 跨 Computer               | 产品支持 Agent/Computer，但冻结 memory slice 不足以证明迁移协议         | runtime 可远程；无 episodic memory                 | 未完成 single-writer handoff                                    |

结论：**RAH OS 的 per-Agent private memory 已明显强于 Multica 当前公开实现，并在 receipt/reset 安全性上强于已冻结的 Raft 切片；但 Raft 的独立 wake/maintenance 用户体验仍领先，跨 Computer 也不能靠“本地目录能复制”冒充完成。**

## 5. 已通过的代码门禁

专项测试覆盖：

- protocol schema、重复/乱序/path traversal；
- materialization digest、race、symlink/hardlink、RunAttempt 精确幂等；
- coordinator seed/cleaner/hint/reset；
- Human authorization/read/reset；
- Client SDK operation 与 route；
- daemon formal composition 与 legacy v2；
- Runtime process continuity 与不同 Agent 隔离；
- Agent workspace UI owner；
- standing prompt formation policy。

完整门禁最终结果：

- `npm run check`：protocol/kernel/daemon/Computer/runtime 等 `601` 项中 `599` 通过，`2` 个付费真实 CLI opt-in gate 显式跳过；Web unit `25/25` 通过；
- `npm run typecheck`：根与 Web 均通过；
- `npm run format:check`：通过；
- `git diff --check`：通过；
- `npm audit --omit=dev`：`0 vulnerabilities`；
- source boundary：Memory 组合从 `daemon-application.ts` 提取到单一 support owner，composition root 从 `845` 行降至 `772` 行，未抬高 `800` 行 ratchet。

## 6. 剩余高优先级

### P0：autonomous maintenance

实现 Computer-local maintenance job：typed hint → Kernel per-Agent `memory_maintenance` fence → identity-fenced active safe notice 或 idle maintenance Runtime → source recheck/scoped ack → durable receipt。maintenance Runtime 不获得 Worker Room credential，不创建 Room Message，不与 canonical Activation 并行。

### P0：跨 Computer single writer

后续本轮增量：[Memory P0 与形成机制审计](./2026-08-30-memory-p0-and-formation-audit.zh-CN.md) 已实现 schema v19 Computer home admission fence，禁止无迁移的空白记忆接管；这是保守安全底线，下述实际迁移闭环仍未完成。maintenance 的 timeout/wake 错误隔离也已补齐，但仍无正式 idle runner。

在 Agent placement 迁移前 park source，取得全局 fence，冻结 workspace bundle + digest，目标 Computer 验证并原子 commit，Kernel 更新 owner，最后释放 source。失败必须回滚；禁止无 owner 的 Markdown 双向同步。

### P1：吸收 Multica proposal 的优点

为未来 shared Workspace/Project knowledge 增加 typed name/description/content、index-only injection、on-demand get 与 CRUD，但保持它与 Agent private Memory 两个 owner。所有 promotion 要有 ACL、provenance、supersede/retract，不让共享条目污染某个人物的私人记忆。

### P1：质量基准

增加多 Provider、20+ 对话的形成/召回/误记/forget/correct/conflict/secret-injection benchmark。当前 prompt 门槛已修复发现的“一次性负面测试被长期记录”问题，但还没有足够真实样本证明所有 CLI 都稳定遵守。

## 7. 发布表述

现在可以准确表述：

> RAH OS 已完成本机正式产品中的 stable per-Agent private memory 主链：真实 Agent 可跨 Channel/DM 和独立 Run 形成/召回；每 Run 有 Computer materialization receipt；Human 可在桌面/PWA 有界查看，并通过全局 fence 与双 quarantine 安全 reset。

现在仍不能表述：

> Agent Memory 已在多 Computer、自主维护、结构化知识治理和长期质量上 100% 收口。
