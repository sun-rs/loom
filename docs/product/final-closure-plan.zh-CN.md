# RAH OS 最后一段产品收口设计

状态：执行中，2026-08-30。

当前状态校正：本文部分章节保留早期顺序，不能作为已完成清单。普通 Memory 形成/新会话/跨 Provider 召回已通过本轮真实验收，Memory 文件控制面与安全 reset 已有实现；执行 restart/session reset、idle wake、全局 Tasks/Search/Activity 和 Files 仍未闭合。自定义独立维护上下文已撤回，不再以本文早期设想授权开发。最新证据以[真实记忆与产品对照审计](../audits/2026-08-30-real-memory-acceptance-and-product-audit.zh-CN.md)为准，Memory 后续设计以[Raft 复用计划](./agent-memory-raft-completion-plan.zh-CN.md)为准。

目标不是把 Raft 页面做成可点击 mock，而是让同一视觉与交互背后都有唯一 owner、typed contract、持久化恢复和真实 Runtime 证据。授权 Raft 源码优先用于已经成熟的对象语义、页面结构、组件规格与 Runtime 行为；RAH OS 只在本机核心、安全栅栏、无中央账户部署和可验证协议上增加必要 glue。

## 1. 已完成的本轮收口

1. Agent 私有 Memory 已进入本机与远程 Computer Runtime composition：一个稳定 Agent 一套 `MEMORY.md + notes/`，不绑定 Room、CLI、model、effort 或 Provider session。
2. 64 KiB cleaner 与 `system.cleaner/memory_size_hint` 按 Raft Computer 1.0.18 的 typed App Inbox 语义移植；未租赁环境值会被清除，下一次真实 Activation 可收到提示。
3. reset core 不复制 Raft 的裸递归删除，改为 Kernel 全局 per-Agent fence、Memory quarantine、per-Agent Provider continuity quarantine、0600 receipt 与双向 rollback；回滚不能证明安全时 fence 保持 active。
4. Human Inbox + InputRequest 已完成 Web/PWA E2；它读取 Kernel canonical InputRequest，不读取 Agent App Inbox。

## 2. 两种 Inbox 永远分离

```text
Human Inbox / Notifications
  owner: Kernel / Human Client API
  examples: InputRequest、Review、Task attention、mention

Agent App Inbox
  owner: 实际 Computer / AgentHost control
  examples: memory_size_hint、未来本机维护请求
```

两者可以复用 Raft NotificationCenter 的边框、颜色、列表和空态组件，但不能共享表、cursor、ack 或 authority。Agent App Inbox 不得伪造成 Room Message；Human Inbox 也不能通过扫描 Computer 文件得到。

## 3. 剩余五项的实施裁决

| Slice                                     | 优先复用 Raft                                                                         | RAH OS 必须拥有                                                                                                               | 当前状态 / 前置                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Human Inbox + InputRequest                | NotificationCenter、badge、空态、问题卡与回答 dialog                                  | InputRequest projection、designated responder、causal resolve、新 Activation                                                  | **E2 完成**；push/通用通知另属下一行                            |
| Search + Notifications + global deep link | Search 页面/过滤器/结果行、NotificationCenter、anchor flash 与打开目标交互            | ACL-safe SearchIndex、Notification projection、typed target union、URL codec                                                  | 可推进；先 deep link/notifications，再 FTS search               |
| 安全强制改派                              | action confirmation 与 owner picker 视觉                                              | durable reassignment operation：cancel request → Runtime terminal proof → reopen/unassign → assign；任何中断都停在安全 Closed | 可推进；复用 ADR-0022 fence，不允许直接覆盖 assignee            |
| Agent 自治启动和 restart/reset            | Computer App Inbox、active notice、idle restart snapshot、memory workspace/reset 文案 | 与 canonical Activation 共用的 per-Agent maintenance lease；restart terminal proof；双 quarantine reset transport             | Kernel/本机 Host fence 完成；远程 transport/operation/UI 未完成 |
| Artifact/Files                            | Files tab、artifact row/detail/preview/download 交互                                  | immutable Artifact registry、content digest、MIME/kind、Task/Run provenance、ACL、blob owner、retention                       | 不能只做 UI；需先建立协议与存储 owner                           |

## 4. 具体顺序

### A. 共用安全底座：Agent exclusive operation lease

Kernel schema v18 与本机 AgentHost control 已完成该底座：它同时观察 canonical Activation、Placement、RunAttempt 与 RuntimeProcess terminal proof，过期也不自动放行。远程 Computer transport、显式 orphan recovery 与 Human operation 尚未完成，因此 UI 继续保持禁用。

### B. 安全强制改派

新增 durable `TaskReassignmentOperation`，而不是一个同步的 `assigneeId = next`：

```text
requested
→ cancellation_requested
→ runtime_terminal_proven
→ task_reopened_unassigned
→ assigned
```

失败或 Core 重启后从 operation state 继续；旧 Worker 在 cancellation request 后立即被 fence。只有 terminal proof 已存在才允许 reopen/assign。UI 复用 Raft owner picker 和 action-confirmation protocol，显示阶段和可恢复错误。

### C. Notifications 与 typed deep link

先定义稳定目标：`Room`、`Message`、`Thread`、`Task`、`InputRequest`、`Agent`、`Computer`、`Artifact`。URL 只是这个 union 的编码，不是 owner。Notification 只保存 target + category + lifecycle，不复制业务正文；点击时服务端重新做 ACL 与存在性检查。随后增加 content-free hint，polling 保留为可靠性 backstop。

### D. Search

在 Kernel/daemon 建 ACL-safe 搜索投影。首版索引 Room/DM 名称、Message、Task、Agent 与 Artifact metadata；SQLite FTS 只是索引实现，不成为真相。结果携带 typed deep link，点击后由目标页面重新读取 canonical 对象。Raft Search UI、过滤器尺寸和交互可以直接复用，但不能从浏览器本地缓存搜索历史真相。

### E. Agent maintenance 与 reset 产品链

先评审 Raft 原 Agent 普通启动、idle restart snapshot 与 RAH Room-scoped Activation 的权限适配；暂停另造独立维护上下文。source recheck 只证明大小，scoped ack 只确认通知，二者都不能证明语义整理完成。Memory reset 的 Human 控制面已有实现，不再把它与未实现的执行 restart/session reset 混为一项。

### F. Artifact/Files

先定义 immutable Artifact 与版本：digest、size、MIME/kind、producer Agent、RunAttempt、TaskSubmission、createdAt、storage owner 和 lifecycle。Computer 只上传/下载有能力令牌约束的 blob；Kernel 保存 metadata/ACL/provenance。Files 页面再直接复用 Raft 的 row/detail/preview 规格。裸绝对路径、当前 Git 状态和 Provider 临时附件都不能冒充 Artifact。

## 5. 收口门禁

每个 slice 必须同时满足：

1. unit/protocol/kernel/transport tests；
2. daemon/Core 重启后的恢复；
3. `1440x1000` 与 `390x844` 真实浏览器 keyboard/pointer 验收；
4. 与 Raft 同尺寸、同操作、同结果对照，视觉差异与后端语义差异分开报告；
5. 默认 fake Runtime，不使用付费 Provider；真实 CLI 仅做明确批准的最终认证；
6. UI 不扫描日志或本机路径，不建立第二业务 owner。

## 6. 当前发布结论

Human Inbox/InputRequest 已有浏览器产品证据；Agent Memory 普通形成、召回、更正、跨 Provider 延续已有真实模型证据，Memory 查看/reset 已有实现。autonomous maintenance、Search/通用 Notifications、全局 Tasks/Activity、强制改派、执行 restart/session reset 和 Artifact/Files 仍不能宣称与 Raft 等效。具体已验证范围见上方最新审计，不能用一个 slice 的成功替代全项目发布验收。

## 7. 2026-08-30 记忆审计后的下一执行批次

正常 Room Activation 由 Kernel 全局 per-participant lane 串行化；Memory reset fence 和 RunAttempt-scoped receipt 已实现，普通启动现为 v2/index_only。默认提示词的额外形成清单/项目分类规则已撤回，保留 Raft 原记忆规则与必要路径/权限适配。未闭合的是 cleaner 配置、idle 维护与执行 restart/session reset 的产品路径，不应重新开发已经存在的 receipt/reset 底座。

下一批按以下边界推进：

1. **可立即并行设计、顺序落地：** typed deep-link target/URL codec、通用 Notification projection、ACL 重新校验。它们不依赖 Runtime 管理 lease。
2. **先完成 operation owner 再开放 UI：** 安全强制改派。现有 cancellation fence 和 terminal proof 可复用，但必须增加 durable reassignment operation；当前 `todo + unclaimed` 的普通改负责人不能冒充强制改派。
3. **与记忆 reset 共用一个底座：** Agent exclusive management lease 的 Kernel/本机 Host Phase 1 已完成；下一步是 maintenance lane、restart terminal proof、远程 Computer control transport 与 orphan recovery。完整产品链完成前 restart/reset 按钮保持禁用。
4. **可先定义协议，不先画假页面：** immutable Artifact metadata/blob/provenance/ACL。完成上传/下载 owner 和冻结证据后再接 Raft Files UI。
5. **Search 最后接索引：** typed target 与 ACL gate 完成后再建 SQLite FTS projection；FTS 可删除重建，绝不成为 Message/Task/Artifact 真相。
