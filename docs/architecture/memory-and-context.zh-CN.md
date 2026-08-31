# Memory 与 Context Fabric

状态：Raft-conformant Agent 文件记忆、cleaner 调度、per-Agent typed App Inbox 与 scoped check/ack/recheck、启动 index-only receipt v2、本机 Human inspect/read 和安全幂等 reset 已进入 daemon 源码。新旧收据兼容、实际子进程启动与隔离浏览器频道/私聊/文件查看见[当前启动收缩验收](../audits/2026-08-30-memory-index-only-rollout-audit.zh-CN.md)；本轮未部署到用户在线实例，未验收真实模型记忆质量。

active Runtime notice/idle maintenance start、跨 Computer single-writer handoff、Artifact/pack materialization 与 shared knowledge promotion governance 仍未完成。源码来源见[Raft 移植账本](../audits/2026-08-29-raft-memory-source-extraction.zh-CN.md)，owner 与 reset 见 [ADR-0023](../adr/0023-agent-private-memory-app-inbox-and-maintenance.md)。旧版本的真实模型/浏览器记录不得替代当前版本验收。

## 1. Memory 不等于历史

必须区分：

| 层                            | 作用                                  | 是否业务真相                                                      |
| ----------------------------- | ------------------------------------- | ----------------------------------------------------------------- |
| Conversation/Room history     | 发生过的消息和事件                    | RoomEvent 是                                                      |
| Agent private memory          | 单个长期 Agent 的工作笔记、偏好和经验 | 否；Raft-compatible `MEMORY.md` + `notes/`                        |
| Room/Project knowledge        | 团队可复用的事实、决策、约束、教训    | 经验证后是知识投影，不替代原始事件，也不冒充某个 Agent 的私人记忆 |
| Provider session context      | 某 CLI 当前上下文窗口/本地 session    | 否，opaque 且可删除                                               |
| Task/Decision/Artifact/Review | 业务状态与交付                        | 是；不得降级成向量记忆                                            |

“保存了聊天记录”“能 resume session”“有 MEMORY.md”都不等于可靠的跨对话长期记忆。

## 2. Owner 与可移植性

Agent memory 的唯一 owner 是稳定的 Agent 身份（当前以 Agent participant/AgentDefinition 绑定），不是 Room、Project、Workspace、RuntimeProfile、Model 或 ProviderSession。Room/Project/Workspace 可拥有共享 Knowledge，但它是另一个治理对象，不能为了“共享方便”而并入任一 Agent 的私人 memory。

同一 Agent 从 Codex 切到 Kimi、Claude 或 OpenCode 时：

- identity、ACL、Task ownership 和 active memory 不变；
- 创建新的 RunAttempt 和 ContextManifest；
- 旧 ProviderSessionRef 可以失效；
- 每次 Activation 仍由 AgentHost 注入同一个 `RAH_AGENT_MEMORY_INDEX` 与 `RAH_AGENT_MEMORY_DIR`；
- Provider-local memory/session 只能作为 cache，不能成为第二个 Agent memory owner。

当前 RAH OS 与 Raft 一致地先落地透明文件协议：

```text
<Computer owner-private state>/agent-memory/<opaque stable Agent key>/
├── MEMORY.md   # 小而完整的恢复索引
└── notes/      # 大的长期细节
```

`MEMORY.md` 只在 Agent 第一次启动时 seed。换 Room、模型、effort、RuntimeProfile、Provider session 或 daemon process 不会重写它。RAH 当前项目目录仍是 Runtime cwd，因此 Agent memory 通过绝对环境路径注入；这避免多个 Agent 在同一个 WorkspaceMount 根共享或争用 `MEMORY.md`。

运行时 standing prompt 复用 Raft 1.0.18 的关键顺序：每次启动先读 index，再按本轮需要读取 notes；显著学习主动写入；长任务前后维护 Active Context。RAH 附加的记忆价值筛选、跳过清单、项目标签与时间写作规则已撤回；只保留路径/传输绑定、禁止凭据进入记忆和 canonical 权限权威。提示词不是强制写入或真实模型效果证明。

这里的“Agent 私有”首先是产品 owner 与默认注入边界。当前最高自治 Runtime 仍以同一 OS 用户运行，0700/0600 不能阻止恶意同 UID 进程主动扫描其他目录；在 per-Agent OS/container isolation 落地前，不得把逻辑隔离误报成强安全 sandbox。

Raft 的 memory cleaner 也必须保持独立所有权：其 `system.cleaner/memory_size_hint` 是 Computer 本地、per-Agent、transient 的 typed App Inbox item，没有 sender、Room message identity 或 Room cursor。RAH OS 已移植同一阈值/interval/revision fence/upsert/drop 调度核心，并在下一次匹配 Agent 的真实 Activation 中注入该 item；standing prompt 明确它只授权私有 housekeeping，不授权 Room 回复。Human UI 同时从 Computer 重新测量的 snapshot 展示“正常/需要整理”，不把 hint 当完成证明。active Runtime safe notice 和 idle maintenance restart 仍未实现。不得为了“尽快唤醒”而把它伪造成聊天消息，也不得只发布 content-free wake 后就声称 memory 已整理。

### Raft 基线、小索引与 Computer home

当前以 [Raft 基线优先合同](../product/agent-memory-raft-baseline.zh-CN.md)及修订后的 [ADR-0026](../adr/0026-compact-agent-memory-and-project-hints.md)为准：默认完整读取原始 `MEMORY.md`，再按需读取 notes。上游 memory/compaction 两个 prompt builder 原样冻结并接入，仅独立适配 cwd 和 RAH 安全边界。撤回 512-byte 分块选择，不再生成部分索引、重建标题或改写换行。4096-byte JSON 是 transport envelope 上限；默认没有正文，显式内部测试选项才可逐字内联整份索引，放不下即整份回退原文件读取。它不是 token 或磁盘读取成本上限，不是强制 memory-off。

M2a 支持 Computer 操作者的可选 `.project-bindings.json`：多个目录显式映射到同一短 key，physical realpath 冲突拒绝，最长显式目录边界匹配；相关项目不合并记忆。完整准备来源保存在 materialization receipt 的 `source` 中，只有短 `{key,label}` 与解析状态进入 envelope。目录配置错误记为 `unavailable`，不猜项目、不阻断正常记忆；真实 cwd/私有根安全错误仍失败。来源不证明某条笔记的知识来源或 Provider 后续自行 cd。网页编辑、跨 Computer canonical 项目身份与逐条来源自动绑定未完成；见 [M2a 合同](../product/agent-memory-project-bindings.zh-CN.md)。

生成顺序、上游来源和限制见 [ADR-0025](../adr/0025-agent-memory-home-and-index-formation.md)。Key Knowledge 保留可扫描的主题和 notes 路径；正文沿用 Raft 规则，Active Context 是恢复点。撤下额外的默认 4 KiB 写作指标，保留上游“简洁但完整”规则与 64 KiB cleaner 告警。普通 Run 已不再全量扫描 notes；索引读取成本和模型上下文成本仍存在，不能宣称启动成本与索引大小无关。

Kernel schema v19 在 managed Agent 首个 RunAttempt 前固定 Computer home，跨 Host lease/Placement/Run 与 Memory 管理操作均拒绝无迁移的接管。旧历史含多个 Host 时升级为 conflicted，不猜测哪份 Memory 正确。同 Host 重启/换模型不影响归属；显式 reset 不迁移归属。这一安全门已经实现，导出/导入/digest/原子 handoff 尚未实现。

cleaner 补齐 Raft 10 秒 measurement timeout 和 wake error 隔离，并合并重复 pending wake；正常 Room Activation 不等待维护 receiver，shutdown/revision change 作废迟到结果。正式自治 runner 仍未接线，不能以这些测试宣布 idle maintenance 完成。

## 3. Future shared KnowledgeRecord

下列结构是未来对 Room/Project/Workspace 共享知识和 provenance 的增强，不是 Agent 私有 Markdown memory 的替代品，也不是首轮 Raft parity 的前置条件。建议最小结构：

```ts
type MemoryRecord = {
  memoryId: string;
  scope: "room" | "project" | "workspace";
  scopeId: string;
  kind: "fact" | "decision" | "constraint" | "lesson" | "summary";
  state: "candidate" | "active" | "superseded" | "retracted";
  content: string;
  authorId: string;
  sourceEventIds: string[];
  sourceArtifactRefs: string[];
  visibility: "private" | "room" | "project" | "workspace";
  confidence: number;
  validFrom?: string;
  validUntil?: string;
  supersedes?: string[];
  revision: number;
  createdAt: string;
};
```

正文可以是 Markdown，但身份、scope、state、provenance 和 revision 必须结构化。

## 4. Shared knowledge promotion 流程

```text
Room event / Artifact / Review
  -> extractor proposes MemoryCandidate
  -> policy validates provenance, ACL, conflict and retention
  -> human/reviewer/authorized policy activates
  -> later correction supersedes or retracts
```

- 自动总结只能创建 candidate；
- transcript/thinking 不能直接进入 active shared memory；
- Agent private memory 可由该 Agent 主动更新；cleaner、配额、显式 reset 与备份策略由 AgentHost/产品控制面管理；
- shared memory 的纠错不能静默覆盖旧记录；
- prompt injection 内容不得因为“Agent 说要记住”就获得长期权限。

## 5. ContextManifest

Kernel schema v11 已在创建每个新 RunAttempt 的同一事务内冻结一个可审计清单。当前实际协议为：

```ts
type ContextManifest = {
  schemaVersion: 1;
  contextManifestId: string;
  runAttemptId: string;
  activationId: string;
  roomId: string;
  participantId: string;
  throughRoomSeq: number;
  eventRanges: Array<{ fromSeq: number; toSeq: number }>;
  agentDefinition?: {
    agentDefinitionRevisionId: string;
    contentDigest: string;
    instructionRefs: VersionedContentRef[];
    skillRefs: VersionedContentRef[];
    memoryPolicyRef: VersionedContentRef;
  };
  placement?: {
    placementId: string;
    runtimeProfileRevisionId: string;
    runtimeProfileDigest: string;
    workspaceDefinitionId: string;
    workspaceMountRevisionId: string;
    workspaceMountDigest: string;
    workspaceMode: WorkspaceMode;
  };
  createdAt: string;
  contentDigest: string;
};
```

清单经 canonical digest 校验，随远程 Computer launch claim 传输，并以不可由 RuntimeProfile 静态环境伪造的 `RAH_CONTEXT_MANIFEST_JSON` 注入真实子进程。它回答“这次 Run 被授权读取哪个 Room 范围，并冻结了哪些 Agent/Runtime/Workspace 与 content reference”，不假设 Provider session 完整。`memoryPolicyRef` 只是策略引用。

Computer 的 RunAttempt-scoped materialization receipt 现为 v2：`coverage=index_only`，files 严格只有 `MEMORY.md`，记录索引 digest/bytes/mtime、Agent/Room/Activation/RunAttempt/Host、完整 policy ref 和可选来源；没有全树 snapshot digest。启动不枚举、不读取 notes。同 Run 的 owner、身份、策略、来源或索引内容漂移仍拒绝；正文变化不再属于这份收据的校验范围。旧 v1 全量收据可读且不改写，不能以 index-only 结果重验旧 Run；必须由现有生命周期使用新 RunAttempt。新旧版本都不证明模型读取或可还原备份。

显式 Human inspect 仍可有界全树检查，read 只校验所选文件及其祖先路径；这是按需管理操作，不是每次聊天的前置条件。正常工作台 bootstrap 通过既有 Registry import/probe/activate 生成新 prompt revision，不热改旧 revision；已有运行进程不自动升级。见[当前收缩验收](../audits/2026-08-30-memory-index-only-rollout-audit.zh-CN.md)。

Human 读取使用同一 owner 模块：先由 Workspace ACL 把 `AgentDefinitionId` 解析成稳定 participant，再只允许 `MEMORY.md` 或安全的 `notes/...` 相对路径；拒绝 symlink、hardlink、非 owner 文件、路径穿越、非 UTF-8、读取中变化和超过 1 MiB 的文件。Web 不接触绝对路径。reset 要求固定确认字面量和 idempotency key，正式 daemon 取得 Kernel 全局 fence 后同时 quarantine Memory 与该 Agent 的 Provider continuity，持久化 receipt 后才释放 fence；相同请求重放只返回既有 receipt，不能再次清掉新 seed 的 workspace。

这仍不等于“全部内容已实际注入”。已实现的 Raft-conformant Workspace instruction pack protocol/installer只接受根 `AGENTS.md`、`CLAUDE.md` 和两个受限 skill 目录，限制 64 文件、单文件 64 KiB、总计 256 KiB，验证每文件与 pack hash，并以 owner-controlled、拒绝 symlink/可写祖先、可回滚事务安装到 RAH namespace。Server assignment、Artifact 内容解析、packId 写入 Context materialization proof、Task/Artifact/Memory revision 选择和 token budget 尚未接通；在这些完成前不得宣称 ContextManifest 记录了“模型实际看见的全部文本”。

Run 的业务 mutation 继续携带 `basedOnRoomSeq`；如果关键上下文已变更，Kernel 可以 hold/reject 并返回新 delta。

## 6. 检索与注入

上下文顺序建议：

1. 安全/身份/Task 约束；
2. 当前 Task、InputRequest、Decision、Artifact/Review projection；
3. Activation 覆盖的 Room delta；
4. active Room/Project knowledge；
5. Agent private memory；
6. Provider session resume 作为可选 cache。

向量索引、FTS、摘要和 reranker 都是 projection。删除索引后必须能从 canonical MemoryRecord 重建；检索分数不能改变 ACL 或 active/superseded 判定。

## 7. 外部经验

- [Raft workspace](https://docs.raft.build/features/agents/workspace/) 证明本地文件 memory 能跨 session reset，但可移植性、provenance 和冲突治理不足。
- [Multica Agents](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/agents.mdx) 证明 identity/instructions/skills/history 能跨 Run；其官方 [workspace memory issue #838](https://github.com/multica-ai/multica/issues/838) 仍明确写着“当前 Agent 不具备跨 issue 持久记忆”。其 index-only 注入、按需 get 与 typed CRUD 是值得吸收的提案，不是可直接复制的既成 memory runtime。
- [Commonly ADR-003](https://github.com/Team-Commonly/commonly/blob/main/docs/adr/ADR-003-memory-as-kernel-primitive.md) 证明 runtime-agnostic memory envelope 可落地；其 history/versioning 明确仍是 non-goal。
- [OpenClaw Memory](https://docs.openclaw.ai/concepts/memory) 提供透明 Markdown、daily notes 和搜索的实用体验。
- [Letta](https://github.com/letta-ai/letta) 提供跨 conversation 的 memory block/shared memory 参考。
- [LangGraph persistence](https://langchain-ai.github.io/langgraph/concepts/time-travel/) 区分 thread checkpoint 与跨 thread store。

RAH 的目标不是发明“又一个 memory API”，而是把 memory 与 Room evidence、业务对象和每次实际 context injection 连起来。

## 8. 验收门禁

- session reset、Host restart、runtime swap 后 active memory 一致；
- private Agent memory 不能泄漏给其他 Agent/Room；
- superseded/retracted record 不再作为 active context；
- 每条 shared memory 都能回溯 source event/artifact；
- 冲突事实不能被自动合并成单一“真相”；
- 删除全部 Provider session/transcript 后仍能构造等价 ContextManifest；
- 每次回答可输出使用过的 memory revision；
- memory 检索失败只降低上下文质量，不修改 Task/Room truth。
- 每个正式 RunAttempt 都有 Computer-owned receipt，且 receipt 只声明 materialized、不声明 model read；
- Human 只经鉴权后的 Computer control port 读取相对路径，reset 重放不可重复破坏新 workspace；
- 同一 Agent 跨 Computer 前必须完成 single-writer handoff；未实现前不得自动复制或双向同步 Markdown。
