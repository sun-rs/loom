# 冻结 Task 交付证据验证审计

日期：2026-09-05
范围：Task Submission revision、RunAttempt/Placement/workspace 身份、Git 交付 patch、Artifact manifest、验证声明、Reviewer 读取、真实浏览器与正式重启。
结论：本批通过。它关闭“reviewer 可能只读到主 Agent 摘要或变化中的工作区”这一缺口；不等于系统已经自动执行测试，也不等于全产品 UI 已与 Raft 完全一致。

## 来源裁决

| 来源                                  | 本批采用                                                                                                | 未采用                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Raft 官方页面、文档与冻结前端证据     | Submission/Review 仍通过既有 Task、Thread、Files 和五态看板呈现；没有增加 Raft 未见的第二套公开交付流程 | 没有证据证明 Raft 官方公开了对应服务端冻结实现，因此不声称“复制了 Raft 后端源码” |
| 已取得的 Raft Computer / Runtime 代码 | 保留现有 Worker credential、RunAttempt 和本地 workspace owner                                           | 不把 Computer 诊断、Provider transcript 或当前工作目录当作 Review 事实           |
| Multica                               | 参考 review head revision 与 head-scoped dedup 的结构思想，把审阅绑定不可变 revision                    | 不引入 PostgreSQL、中央服务器、GitHub Issue 状态机或其模拟业务 owner             |
| RAH 本地适配                          | SQLite schema 50、Host 观测 Git、冻结 Room File、typed Worker API/CLI                                   | 不让 Web、CLI 或 producer 自报 workspace/repository 身份                         |

具体来源与采用边界见 [ADR-0031](../adr/0031-host-observed-frozen-task-delivery-evidence.md)。

## 业务合同

一次 Submission 现在固定：

- 当前 `RunAttempt`，以及存在时的确切 `Placement`、`Host`、workspace definition/mount revision/mode/digest；
- RunAttempt 启动时采集的 Git base，与提交时 Host 再采集的 head、完整 patch digest、仓库身份；
- 同一 RunAttempt 的冻结 Task Artifacts、有序 manifest digest；
- producer 明确声明的验证状态、摘要和所引用的冻结 Artifact，且明确标记为 `producer_declared`；
- version 3 submission digest。旧 v1/v2 submission 继续只读兼容，不会被静默升级为新证据。

Reviewer 的 Review 同时绑定 `submissionId` 与 `submissionDigest`。工作区后续变化不会改变已经审阅的对象；返工必须产生新的 Submission revision。Worker 可通过窄查询读取当前冻结 Submission，并通过限定路由下载其中已经冻结的 Artifact。

用户仍可提交最多 10 个交付附件。daemon 自动生成的 `rah-task-delivery.patch` 使用一个额外、仅由 Host 观测身份解锁的系统槽位；没有匹配 `patchAttachmentId` 的第 11 个普通附件仍被协议与 Kernel 拒绝。

## TDD 与失败证据

实现前的红灯分别证明：协议不接受 evidence/verification、workspace-aware credential 缺失、Git collector 缺失、CLI verification 参数缺失。最终边界审计又复现了“10 个用户 Artifact + 1 个系统 patch 被旧上限拒绝”，以及正式浏览器白名单遗漏只读 `POST /v3/client/messages/reference-read-states`。

修复没有放宽普通消息或普通文件限制：协议区分 producer Artifact 与 Host 系统 patch；正式浏览器策略只新增已经由 application service 和 Kernel 证明为 ACL-safe、最多 200 个 Message ID 的只读批量查询，未知 API 仍 fail closed。

## 自动验证

- `npm run check`：通过。C 批次当时包级 899 项，897 通过、2 项显式跳过、0 失败；D 批次新增完整组合测试后的最新累计结果见后续[团队业务闭环验证审计](./2026-09-05-canonical-team-workflow-verification.zh-CN.md)。
- source ratchet：`room-kernel.ts` 6,925 行，未提高上限；protocol entry 仍在既有上限内。
- Worker application integration：10 个 producer Artifact 加 1 个自动 patch 提交、冻结读取、下载、Review 和 Human completion 全链通过。
- Git collector：冻结 activation base、当前 tracked/untracked/binary patch；非 Git workspace 返回 provider-neutral unavailable evidence。
- `npm run test:web:ui-compare`：两组分别 50/50、68/68 matched；`different=0`、`uncomparable=0`、`approved-local-difference=0`。
- `git diff --check`：通过。

这些 UI 数字只覆盖机器登记和 fixture 的相同前置状态。内部视觉回归只防 RAH 退化；与 Raft 相同的完整页面、hover/focus/拖拽、权限与异常组合仍须继续按真实官方页面核验。

## 正式重启与真实浏览器

- 正式地址：`http://127.0.0.1:4173`
- 进程：PID 54886，健康检查 `online`
- Web build：`7452387e61035cad4a966b615a4c858d9317bb7564b56c9eb9a04a8dd329b751`，HTTP header 与 HTML meta 一致。
- 正式数据库：schema 50，`task_submissions.evidence_json` 存在。
- Chrome 152.0.7977.77 与 Firefox 150.0.2：设置页面族 12 区，1440 与 390×844 均通过；48 张截图 manifest digest 为 `847362780e2cf6980670b1450126088d9922b1ea29b847043809fd1d8721855f`。
- 浏览器错误、失败响应、拒绝请求均为 0；正式库前后保持 principals 6、rooms 6、messages 43、tasks 2、room_events 376，所有 Room 最大 sequence 未变。

正式重启产生的最新可验证备份为
`/Users/sun/.rah/backups/pre-restart-450f9f07-d9e0-43ef-a3ec-1f1a058570df`（约 52 MiB）。同轮较早备份仍保留，未在没有新的删除授权时擅自移除。

## 性能与安全边界

- Git 采集只在 Task submission 时运行，不轮询、不常驻，不增加 idle CPU；子进程不用 shell。
- 每次采集 10 秒超时、64 MiB 输出上限、最多 1,000 个 untracked 文件；超限或采集失败会阻止把不完整证据冒充为冻结交付。
- patch 在提交路径短暂驻留内存，随后只保存一次冻结 blob；数据库只保存 typed metadata 和 digest。大仓库最坏会让该次提交等待到超时，但不会形成后台扫描负担。
- Artifact 下载限制在当前 Worker credential、当前 Task Submission 与 canonical Room File，使用安全路径和有界响应；CLI 输出文件使用独占创建、`NOFOLLOW` 与 `0600`。

## 明确未完成

1. `producer_declared` 不是系统执行证明。独立 reviewer 已在下一批闭合；系统管理的测试执行器只有在取得可靠来源并绑定相同 Submission digest 后才能作为可选增强，不能冒充已观察到的 Raft 后端合同。
2. 必要助手须由有负责人和依赖的 Task 表达；该组合已在 D 批次验证，普通邀请仍不等于必须交付。
3. 远端 Computer 的完整 Host 观测采集尚未作为本批出口；当前用户优先级仍是单机。
4. 完整“方案审查 → 实施 → 助手交付 → 驳回返工 → Human 验收 → 下游启动”组合场景已由 D 批次关闭。
5. Search／Tasks／Message、Human／ACL、Computer 管理和通知设备的剩余 Raft 页面状态仍按 E 批次推进，不能由本报告替代。
