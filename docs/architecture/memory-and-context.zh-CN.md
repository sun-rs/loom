# Memory 与 Context Fabric

状态：目标架构，尚未实现。

## 1. Memory 不等于历史

必须区分：

| 层                            | 作用                               | 是否业务真相                       |
| ----------------------------- | ---------------------------------- | ---------------------------------- |
| Conversation/Room history     | 发生过的消息和事件                 | RoomEvent 是                       |
| Agent scratch memory          | Agent 私有工作笔记、偏好和经验     | 否                                 |
| Room/Project knowledge        | 团队可复用的事实、决策、约束、教训 | 经验证后是知识投影，不替代原始事件 |
| Provider session context      | 某 CLI 当前上下文窗口/本地 session | 否，opaque 且可删除                |
| Task/Decision/Artifact/Review | 业务状态与交付                     | 是；不得降级成向量记忆             |

“保存了聊天记录”“能 resume session”“有 MEMORY.md”都不等于可靠的跨对话长期记忆。

## 2. Owner 与可移植性

Memory owner 是稳定的 AgentDefinition、Room、Project 或 Workspace，不是 RuntimeProfile、Model 或 ProviderSession。

同一 Agent 从 Codex 切到 Kimi、Claude 或 OpenCode 时：

- identity、ACL、Task ownership 和 active memory 不变；
- 创建新的 RunAttempt 和 ContextManifest；
- 旧 ProviderSessionRef 可以失效；
- runtime-local memory 只能作为 cache，Kernel 版本是恢复基线。

## 3. MemoryRecord

建议最小结构：

```ts
type MemoryRecord = {
  memoryId: string;
  scope: "agent" | "room" | "project" | "workspace";
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

## 4. Promotion 流程

```text
Room event / Artifact / Review
  -> extractor proposes MemoryCandidate
  -> policy validates provenance, ACL, conflict and retention
  -> human/reviewer/authorized policy activates
  -> later correction supersedes or retracts
```

- 自动总结只能创建 candidate；
- transcript/thinking 不能直接进入 active shared memory；
- private scratch 可由 Agent 写入，但仍要有版本、配额和删除策略；
- shared memory 的纠错不能静默覆盖旧记录；
- prompt injection 内容不得因为“Agent 说要记住”就获得长期权限。

## 5. ContextManifest

每个 RunAttempt 启动前冻结一个可审计清单：

```ts
type ContextManifest = {
  contextManifestId: string;
  runAttemptId: string;
  roomId: string;
  throughRoomSeq: number;
  eventRanges: Array<{ fromSeq: number; toSeq: number }>;
  taskVersions: Array<{ taskId: string; version: number }>;
  memoryRevisions: Array<{ memoryId: string; revision: number }>;
  artifactHashes: string[];
  instructionRevision: string;
  retrievalPolicyRevision: string;
  tokenBudget: number;
  contentHash: string;
};
```

它回答“这个 Agent 当时究竟看到了什么”，而不是假设 Provider session 完整。Run 的业务 mutation 携带 `basedOnRoomSeq`；如果关键上下文已变更，Kernel 可以 hold/reject 并返回新 delta。

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
- [Multica Agents](https://multica.ai/docs/agents) 证明 identity/instructions/skills/history 能跨 Run；未发现已发布的跨无关工作项 episodic memory 契约。
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
