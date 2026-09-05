# Canonical 团队业务闭环验证审计

日期：2026-09-05
范围：方案 Task、必要助手 Task、实施 Task、冻结 Submission、独立 Review、驳回返工、Human 验收、依赖释放、数据库重开与真实浏览器。
结论：D 批次通过。RAH OS 现已证明一条 canonical 团队工作链能在同一组 Task、Submission、Review、Room event 与 Activation 事实中闭合；普通 Room 邀请不会被冒充为必要交付。本结论不等于所有页面族或全部 Raft 产品能力已经一致。

## 来源与裁决

| 来源                                    | 采用                                                                                                             | 未采用                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Raft 官方 Task 页面、文档与冻结行为证据 | 保留五态看板、Task Thread、Files、提交/审阅/完成的可见顺序；相同功能继续使用既有 Raft UI 合同                    | 未发现可证明“任意本地测试命令由 Raft 服务端执行并签名”的公开后端合同，因此不编造第二套 attestation 页面或业务状态机 |
| 已取得的 Raft Computer / Runtime 代码   | 继续使用 Activation、RunAttempt、Worker credential 与 Host/Placement 边界                                        | 不把 Provider 输出、当前工作目录或主 Agent 的自然语言总结当作完成证明                                               |
| Multica                                 | 仅保留不可变 revision、review head 与依赖关系的结构性参考                                                        | 不引入中央服务器、PostgreSQL、Issue 状态机或参考项目的模拟状态                                                      |
| RAH 本地适配                            | 用 Room-first Kernel 组合现有 Task dependency、冻结 Submission、独立 Review、Human completion 与 Activation 唤醒 | Web、CLI 和测试 fixture 都不能成为业务真相 owner                                                                    |

独立 reviewer 是当前闭环的必要组成；producer 的验证说明仍明确标记为 `producer_declared`。未来若增加系统管理的验证执行器，它必须绑定相同 Submission digest 并形成新的有来源证据类型，不能静默把 producer 声明升级为系统证明。

## 已证明的业务链

隔离场景建立四个有明确负责人和依赖的 Task：

1. 方案与验收标准 Task，由独立 reviewer 审阅；
2. 必要助手交付 Task，依赖方案完成；
3. 主实施 Task，同时依赖方案和助手交付，并指定独立 reviewer；
4. 下游 Task，只有主实施真正完成后才能得到 Activation。

验证顺序为：方案提交、批准、Human 完成；仅助手被唤醒。助手必须认领、启动、提交并由 Human 完成；随后才唤醒主实施。主实施首个冻结 Submission 被 reviewer 明确 `changes_requested`；Kernel 在此时关闭并重新打开同一个 SQLite 数据库，恢复 Host heartbeat 后仍保留 Task、Submission、Review 与依赖状态。主实施形成第二个 Submission revision，reviewer 对新 `submissionId`/digest 批准，Human 完成后才唤醒下游负责人。

最终 Review 历史严格为 `changes_requested`、`approved`，而不是覆盖首个结论。普通 Room 成员或受邀 Agent 没有对应负责 Task 时，不进入必要交付条件。

## TDD 与真实浏览器

- Kernel 组合测试覆盖完整业务链、精确依赖释放、首版驳回、同 Task 返工和中途数据库重开。
- 测试曾因使用旧 Room sequence 失败；修正为只使用 Worker 实际收到的最新 delivery cursor 与 Human 最新同步 sequence。这不是放宽并发控制，而是让验收遵守生产 causal contract。
- 隔离 fake Runtime 在 reviewer Activation 中先读取当前冻结 Submission；仅第一版请求修改，第二版对新的 Submission identity 批准。幂等键绑定 participant、Task、Activation、operation 和 Submission，并使用 SHA-256 保持协议长度上限。
- 真实 Chrome 门禁从桌面进入 390×844，操作现有 Raft 形状的 Task 看板、Thread 与 Files，并断言同一 Task 至少有两个 owner Submission、明确的修改请求和最终批准。
- 没有新增第二套公开“团队编排”页面。与 Raft 相同的五态、菜单、卡片、Thread 和 Files 仍消费内部共享 UI owner，并保留官方同前置比较义务。

## 自动验证

- `npm run check`：通过。包级 900 项，898 通过、2 项显式跳过、0 失败；Web 单元 331 项、历史回归 34 项、浏览器策略 8 项全部通过。
- `npm run test:web:browser`：通过真实 Chrome；首版驳回、第二版交付与批准均由 canonical 数据断言，不以截图或按钮可点击替代业务完成。
- 同批正式 Chrome 152.0.7977.77 与 Firefox 150.0.2 设置页面族验收通过；1440 与 390×844 共 48 张截图，无浏览器错误或失败请求。
- UI 自动比较两组分别为 50/50 与 68/68 matched，`different=0`、`uncomparable=0`、`approved-local-difference=0`。
- `git diff --check` 与 source ratchet 通过，未提高 `room-kernel.ts` 或协议入口上限。

UI 数字只证明登记中的相同 fixture/前置状态。RAH 内部基线不能替代 Raft 官方实页；Search、Tasks、Message、Human/ACL、Computer 管理及通知设备仍须继续真实双边验收。

## 发布状态

生产代码的最后变化已随 C 批次正式重启进入 `http://127.0.0.1:4173`：Web build `7452387e61035cad4a966b615a4c858d9317bb7564b56c9eb9a04a8dd329b751`，数据库 schema 50，健康状态 `online`。D 批次新增的是组合验收、fake Runtime 审阅分支、浏览器断言与文档，没有再次改变生产 bundle 或数据库 schema，因此没有为制造另一份约 52 MiB 备份而重复重启。

## 明确未完成

1. 系统管理的测试执行与签名 attestation 是可选增强，目前没有足够 Raft 官方来源，不能被写成已复刻功能；当前只承诺 Host 固定证据、producer 声明和独立 reviewer。
2. Search／Tasks／Message 的剩余组合状态、Human／ACL、Computer 管理与通知设备送达进入 E 批次；相同 Raft 页面继续做 UI、鼠标、键盘、焦点和功能双边验收。
3. 远端 Computer 的完整 Host 观测交付不在当前单机优先范围内。
4. 本报告证明一条代表性闭环，不把它推广为所有多 Agent 组合、Provider 或长期负载都已完全验证。
