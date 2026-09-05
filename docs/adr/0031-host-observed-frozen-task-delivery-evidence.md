# ADR-0031：Host 观测的冻结 Task 交付证据

状态：Accepted
日期：2026-09-05

## 背景

ADR-0021 已把每次提交固定为不可变 `TaskSubmission`，并将显式 Artifact
纳入 v2 digest。但是，Reviewer 仍无法只凭一份 Submission 判断它对应哪个本地
workspace、哪个 Git base/head，或此后工作区是否已经变化。Agent 在 summary 中声称
“测试通过”也不是可验证证据。

Raft 的公开产品与真实页面可以证明 Task、Thread、Files 与 Review 的可见行为合同；当前
没有可证明来源的 Raft 官方服务端实现可直接移植此内部证据链。因此本决策不把推测的
Raft 服务端行为写成事实，也不为了后端证据增加一套 Raft 页面上不存在的 UI。

Multica 提供了可采用的结构性先例：

- `server/pkg/db/queries/github.sql` 的 `GetIssueReviewHeadSha` 把审阅对象定位到具体
  `head_sha`；
- `server/pkg/db/queries/agent.sql` 的 reviewer-loop 去重只把相同 `head_sha` 当成同一
  待审对象，HEAD 前进后必须形成新的工作。

RAH 不复制其 GitHub/PostgreSQL/中央服务模型，只采用“审阅身份必须绑定不可变
revision”这一规则，并由本机 Host 与 Room Kernel 实现。

## 决策

1. 本机 Application Service 在签发 Activation credential 前，由 Host 对规范化后的
   workspace root 采集 Git baseline。采集使用参数数组启动 Git，不经过 shell；禁止交互，
   并限制时间和输出大小。
2. `task-submit` 时 Host 再次采集同一真实 workspace/repository。如果路径、repository
   identity 或 base identity 漂移，提交失败关闭；不能由 Worker 请求覆盖这些字段。
3. Git 证据包含 `repositoryId`、`baseCommit`、`headCommit`、二进制完整 patch 的
   SHA-256、字节数，以及该 patch 对应的不可变 Task Artifact。tracked 与 untracked
   变化都进入 patch。
4. Kernel 从 authenticated execution 对应的 RunAttempt 与持久化 Placement
   `decision_json` 派生 workspace evidence，冻结 Host、RunAttempt、Placement、
   workspace definition、mount revision/digest 与 mode。Worker 不得提交这些身份。
5. 新 Submission 使用 `rah/task-submission/v3` digest，覆盖 Task anchor、message、
   summary、Artifact references 和完整 evidence。旧 v1/v2 Submission 保持按原规则读取，
   不伪造历史 evidence。
6. Artifact manifest 使用独立 canonical digest。patch Artifact 的 id、digest、size
   必须与 Submission 的 Artifact references 完全相符。
7. Worker 可附 `passed`、`failed` 或 `not_run` 的验证摘要及已冻结 Artifact id；其来源
   固定标记为 `producer_declared`。这只是一份交付声明，不是 Reviewer 或系统 attestation。
8. Reviewer/Worker 通过 submission metadata 接口读取当前冻结 Submission，通过受
   Activation/Task/RunAttempt/Room scope 约束的 Artifact 下载接口取得原始证据。文件内容
   不进入 JSON 上下文，也不默认增加模型 prompt。
9. 非 Git workspace 记录明确的 `not_git` 降级；collector 不可用、采集失败或 workspace
   未绑定也使用可区分的 unavailable reason。不得生成虚假的 commit/patch。
10. 当前远端 Computer 尚未提供与本机等价的可信 collector，因此只获得
    `workspace_not_bound`/Artifact 证据；多 Computer 完整证据链另行设计，不在本批冒充完成。

## 幂等与变化

相同 idempotency key 和相同用户输入重放第一次已冻结的 Submission，即使工作区随后发生
变化，也不能静默换成新证据。需要提交新工作区状态时必须产生新的 Task revision 与新的
idempotency key；`changes_requested` 后的重新提交继续沿用 ADR-0021 的新 Submission
number 与旧 Review 失效规则。

## UI 边界

本决策不新增独立“证据中心”或第二套任务状态。Raft 已有的 Task 卡、Task Thread、Files
和 Review 操作继续由内部共享 UI 组件呈现；patch 作为普通的冻结 Task Artifact 使用同一
附件/下载行为。以后如 Raft 出现同功能的证据 UI，必须按同前置条件补做双边 UI、鼠标、
键盘、焦点、加载和错误态对齐。

## 验证

- protocol 拒绝 Worker 伪造 evidence source，并校验 patch、Artifact 与 verification
  references 的一致性；
- Kernel migration、v1/v2 兼容、v3 digest、RunAttempt/Placement workspace identity
  与幂等冲突有定向测试；
- Application Service 以 fake collector 验证 baseline/current、自动 patch Artifact、
  submission metadata 与 scope-safe download；
- daemon collector 在临时真实 Git 仓库验证 tracked/untracked patch，并验证非 Git 降级；
- Worker CLI 验证 producer declaration、metadata 查询和排他/无符号链接的有界下载；
- 完整回归、正式重启和真实浏览器结果记录在对应审计，而不是写入本 ADR 作为永久事实。

## 结果

Reviewer 审查的是一份稳定、可下载、可散列核验的交付版本；Agent summary 不再是唯一证据。
本地 Git 采集不增加模型上下文负担，也不把 Multica 的中央 PR 数据模型带入 Room-first
Kernel。生产 UI 仍按 Raft 可见合同演进，Kernel 保持交付事实的唯一 owner。
