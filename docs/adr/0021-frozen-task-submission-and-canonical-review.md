# ADR-0021：冻结 Task 提交与 canonical Review

状态：Accepted\
日期：2026-08-29

## 背景

Task 的 Thread 文本可以承载讨论，但一条“审阅通过”消息本身不能证明它审阅了哪次提交，也不能阻止旧结论被误用于新版本。Raft 形态的负责人、协作者和审阅者仍应共享同一 Task Thread，但业务状态必须由 Kernel 拥有，不能由 Provider prose 或 UI 推断。

## 决策

1. 每次 `task.submit` 原子创建不可变 `TaskSubmission`。它包含递增 submission number、producer、summary、Thread message、时间及 `sha256` canonical digest。
2. 被选中的 reviewer 只有在包含当前 `task.submitted` 的 `task_review` Activation 中才能调用严格的 `task-review` command。请求不接受 actor、Room、submission id 或 digest；服务端从 credential 与当前 Task 解析这些字段。
3. `Review` 是独立对象，固定引用一份 `TaskSubmission`，disposition 只有 `approved` 或 `changes_requested`。它同时投影为 canonical Task Thread reply，但普通 `message-post` 不能替代 Review。
4. `changes_requested` 将 Task 重新置为 assigned `todo`、清除执行 claim 与当前提交投影，并唤醒负责人和协作者；负责人必须重新 claim/start/submit，产生新的 submission 与 digest。旧 Review 永远不满足新提交。
5. 有 reviewer 的 Task 只有当前 submission 获得全部 reviewer 的 `approved` Review 后，Task creator 才能执行 Human `task.complete`。Web 和 Kernel 都执行此门禁，Kernel 是最终 authority。
6. Human Client v3 通过 `/tasks/reviews/list` 按 Room 读取 submission/review 投影；Web 只显示提交编号、通过数和短 digest，不解析 Agent transcript。
7. schema v16 为旧 `submitted/completed` Task 从既有 `task.submitted` 事件和 Thread message 补建可证明的 submission；缺少可证明 message/summary 时 migration fail closed。

## 明确不包含

TaskSubmission v1 的 digest 绑定 Task anchor、submission message 与 summary，不等价于 frozen Git diff 或 Artifact 内容。Artifact registry、base/head、文件清单、构建产物与 verifier evidence 仍是后续 slice，UI 的“文件”页继续如实保持未接入。

## 验证

- Kernel 覆盖 Human 提前完成被拒绝、`changes_requested` 重开、第二次提交产生不同 digest、旧 Review 失效和全部通过后完成。
- protocol、Worker CLI 与 Worker Application Service 覆盖 actor-free schema、Activation delivery fence 和幂等重放。
- schema v15 回放测试覆盖旧提交 evidence backfill。
- 隔离真实 Chrome 门禁在 `1440x1000` 创建 Kimi owner + Alice reviewer Task，看到 Thread 中负责人提交与审阅结论后才出现 Human 完成，并继续通过 `390x844`、无横向溢出与 console error。

## 结果

Review 从“Thread 里的一句话”升级为可查询、可围栏、与具体提交绑定的业务事实，同时不提前伪造 Artifact/frozen diff 能力。
