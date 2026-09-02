# ADR-0021：冻结 Task 提交与 canonical Review

状态：Accepted\
日期：2026-08-29

## 背景

Task 的 Thread 文本可以承载讨论，但一条“审阅通过”消息本身不能证明它审阅了哪次提交，也不能阻止旧结论被误用于新版本。Raft 形态的负责人、协作者和审阅者仍应共享同一 Task Thread，但业务状态必须由 Kernel 拥有，不能由 Provider prose 或 UI 推断。

## 决策

1. 每次 `task.submit` 原子创建不可变 `TaskSubmission`。它包含递增 submission number、producer、summary、Thread message、时间及 `sha256` canonical digest。2026-09-01 起，新提交使用 v2 digest，并覆盖按稳定 ordinal 排序的显式 Task Artifact references；旧 v1 submission 继续按原 digest 读取，不重算历史证据。
2. 被选中的 reviewer 只有在包含当前 `task.submitted` 的 `task_review` Activation 中才能调用严格的 `task-review` command。请求不接受 actor、Room、submission id 或 digest；服务端从 credential 与当前 Task 解析这些字段。
3. `Review` 是独立对象，固定引用一份 `TaskSubmission`，disposition 只有 `approved` 或 `changes_requested`。它同时投影为 canonical Task Thread reply，但普通 `message-post` 不能替代 Review。
4. `changes_requested` 将 Task 重新置为 assigned `todo`、清除执行 claim 与当前提交投影，并唤醒负责人和协作者；负责人必须重新 claim/start/submit，产生新的 submission 与 digest。旧 Review 永远不满足新提交。
5. 有 reviewer 的 Task 只有当前 submission 获得全部 reviewer 的 `approved` Review 后，Task creator 才能执行 Human `task.complete`。Web 和 Kernel 都执行此门禁，Kernel 是最终 authority。
6. Human Client v3 通过 `/tasks/reviews/list` 按 Room 读取 submission/review 投影；Web 只显示提交编号、通过数和短 digest，不解析 Agent transcript。
7. schema v16 为旧 `submitted/completed` Task 从既有 `task.submitted` 事件和 Thread message 补建可证明的 submission；缺少可证明 message/summary 时 migration fail closed。

## 明确不包含

TaskSubmission v2 的 digest 绑定 Task anchor、submission message、summary 与 canonical Artifact metadata/provenance；Artifact 内容由 RoomFiles 保存的 SHA-256 与不可变 Message owner 证明。它仍不等价于 frozen Git diff，也不包含 base/head、自动工作区文件清单、构建日志或 verifier result。只有 Agent 通过严格 Worker command 显式发布并在提交事务中绑定的文件属于 submission evidence；当前 Git 状态和 Provider transcript 均不属于。

## 验证

- Kernel 覆盖 Human 提前完成被拒绝、`changes_requested` 重开、第二次提交产生不同 digest、旧 Review 失效和全部通过后完成。
- protocol、Worker CLI 与 Worker Application Service 覆盖 actor-free schema、Activation delivery fence 和幂等重放。
- Artifact 测试覆盖显式本机路径不进入网络协议、Task/Agent/Room/RunAttempt scope、未提交不可见、原子消费、v2 digest、跨 scope 注入失败和旧 v1 digest 兼容。
- schema v15 回放测试覆盖旧提交 evidence backfill。
- 隔离真实 Chrome 门禁在 `1440x1000` 创建 Kimi owner + Alice reviewer Task，看到 Thread 中负责人提交与审阅结论后才出现 Human 完成，并继续通过 `390x844`、无横向溢出与 console error；Artifact 扩展门禁另外验证 fake Agent 文件同时出现在精确 submission Thread 与 Room Files，可预览、可触发下载、可从 Files deep link 回到同一 Thread reply。

## 结果

Review 从“Thread 里的一句话”升级为可查询、可围栏、与具体提交绑定的业务事实；显式 Artifact 已进入同一冻结证据，但 frozen diff/verifier 能力仍保持未声明。
