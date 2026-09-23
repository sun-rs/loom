# Role / Instance / Session 重构施工设计（Review 版）

日期：2026-09-23。状态：**用户已认可施工设计并要求继续；正式数据切换仍需满足 P0–P8 门槛**。后续确认的 [UI 范围合同](role-instance-ui-contract.zh-CN.md)共同约束施工：保留大页结构，Role 管理替代 Agent 管理，聊天左栏不再有私聊分区，四类详情复用右侧第三栏。

本稿是施工主文档，回答改什么、按什么顺序、各批怎样验收、如何切换和恢复。产品语义沿 [v0.1](role-instance-session-v0.1.zh-CN.md)，技术修订沿 [v0.2](role-instance-session-v0.2.zh-CN.md)。冲突时，本稿对施工和迁移的解释优先；现行产品在切换前继续执行原合同。

## 当前执行优先级：纵向 MVP（2026-09-23 用户最新决定）

**以 [纵向 MVP 计划](role-instance-vertical-mvp.zh-CN.md) 为施工顺序。** 下方 P0–P8 保留为完整架构与后续能力清单，不再要求横向做完整批次后才接 UI。P0 已通过；现在先连接最小业务路径，每一条新增功能仅实现其所需的协议、事务、执行与 UI。

用户要求：优先纵向开发实现 MVP，不横向过度拓展或为极低概率细节提前建设兜底。未知边界记录延期；已知的身份隔离、认证、幂等、原历史保留仍属于正常路径。

## 1. Review 摘要

重构目标是把“跨多个频道共用一个人格 Agent/session”替换为“Role 配置可复用，每个频道实例保持独立、持续的 session”。保留 Room 账本、Inbox、Activation、Task、显式发帖和租约机制，不重写这些已验证的基础。

明确采用：

- Role 更新不改旧实例；实例可以改模型/effort，不能换 CLI。
- 私聊使用私有 box，与原实例共享 session/执行 lane，排队、不打断频道工作。
- Side 使用隔离 session，可读已授权记忆，禁止写记忆。
- 持久 fork 是频道内的新实例；故障替代保留原实例 ID。两者不混用。
- 平台记忆独立于 session；授权先于检索，不能只靠 prompt 限权。
- 新增频道成员不自动成为旧消息列/task 的关注者；关注者必须是频道内有效实例。

推荐施工路径：**先在临时库闭合身份与调度，再接真实 CLI 和权限隔离，最后迁移正式数据。** 不在生产启动时顺便迁移，不按页面零散改造，不让新旧执行器竞争同一工作。

这不是全部实现完成报告。已有代码仅为 [绑定协议和纯规则](../audits/2026-09-22-instance-binding-foundation.zh-CN.md)，没有数据库、调度或正式迁移接入。它们也须服从本稿，不因已写代码就冻结未审设计。

## 2. 不变量与主动改变的合同

| 保留                                                                        | 主动改变                                                 |
| --------------------------------------------------------------------------- | -------------------------------------------------------- |
| Room event → Inbox → Activation → Host lease → RunAttempt → explicit action | 执行主体由跨 Room 的旧 Agent 变为频道实例                |
| 消息、任务状态不从 CLI 最终输出推断                                         | 原生 session 连续性绑定实例，不绑定模型/effort 配置版本  |
| 原子事务、幂等、freshness hold、执行代际隔离                                | 记忆由旧 Agent 私有文件归属，演进为平台管理和显式授权    |
| 单个执行主体最多一条主执行 lane                                             | 不同频道的同 Role 实例拥有独立 lane                      |
| Provider transcript 为诊断与工作上下文，不重建 Room 业务事实                | Side 使用受限执行策略，不能直接继承当前 full_access 默认 |

旧 ADR 的 Agent 身份、私有记忆归属和配置变更续聊规则，需要在对应施工批明确 supersede。不能在文档里同时留下两套互相矛盾的默认合同。第三方 MCP 平台管理、多 Human 协作不进入本次范围。

## 3. 现状到目标的模块映射

以下路径均相对仓库根目录，来自本次工作树核查；工作树包含先前未提交改动，不冒称冻结 commit。

| 当前实现                                                                            | 目标和处理方式                                                      | 单一 Owner                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------- |
| `kernel/schema.ts` 的 principals、memberships、agent_definitions/revisions          | 新 Role 聚合与实例聚合；保留旧身份和历史引用                        | Kernel                                   |
| `agent-host/provider-session-store.ts` 按 participant/profile/digest/mount 查找     | 旧路径保留到切换；新路径按实例的已提交 binding 寻址，不回退旧 key   | Kernel 决定有效绑定，Host 执行与记录诊断 |
| `kernel/placement-planner.ts`、activations、run_attempts                            | 实例 principal 作为执行主体；私聊和频道共享该主体的执行排他         | Kernel                                   |
| `kernel/auth.ts`、protocol 的 ActivationCredentialScope                             | 在现有凭据链增加实例 binding epoch、目标授权版本；不是新鉴权系统    | Kernel / protocol                        |
| `kernel/worker-task-scope.ts`、`worker-read-targets.ts`、`worker-target-context.ts` | 对私有 box 增加本次目标授权，保留合法公共历史查询                   | Kernel                                   |
| `kernel/activation-obligation-service.ts` 与展示/交付记录                           | 继续区分可见、已展示、待处理、已处理，不靠发帖数量消义务            | Kernel                                   |
| `agent-host/runtime-implementation-registry.ts` 与四家 driver                       | 读取新绑定和能力合同，新增 fork/checkpoint/权限控制，不拥有业务队列 | AgentHost                                |
| `daemon/runtime-profile-composition.ts`、standing-prompt 系列                       | 组装实例快照、目标和权限，避免配置刷新新建 session                  | daemon 组合、各领域 owner 校验           |
| `kernel/agent-memory-home.ts` 和 AgentHost memory 模块                              | 旧记忆只读兼容；新存储、授权、版本化和受限材料化                    | Kernel 元数据/授权，Host 文件执行        |
| application-service / client-sdk / client-core / Web                                | 新类型和 intents、实例 ID 展示、能力状态、旧历史兼容                | 各自既有分层                             |

文件名为设计 owner 或当前证据位置，不承诺只需改这些文件。每批提交前更新受影响读写路径清单，尤其是消息收件人、任务所有者、关注计数、在线状态、搜索和附件权限。

## 4. 数据设计与兼容策略

### 4.1 身份：一个实例对应一个 Principal

建议令 `instanceId = principalId`，不再增加另一套可互换的执行 ID。Role 是配置，不能作为消息作者或任务所有者。实例的 channelId 是归属频道；其私有 box 可复用该 principal，但不改变归属频道，也不生成第二个主实例。

同 Role 两个实例可以同名，但 @ 候选、消息作者、任务分配和关注关系全部按 ID，UI 提供频道内编号/短标识。删除 Role 采用归档模板：禁止继续创建，已有实例和历史 RoleRevision 仍可解析；这是本稿建议，避免级联删除运行实例。

### 4.2 建议新增的逻辑表

表名为施工草案，schema 版本号在落地时按当时基线分配，不现在预占。

| 逻辑表                                            | 关键约束                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| roles / role_revisions                            | Workspace/control Room 内稳定 roleId；revision 不可变；包含 CLI、模型、effort、prompt、skills 和默认策略 |
| member_instances / instance_config_revisions      | instanceId 引用 principal；归属频道、冻结 RoleRevision；model/effort override 独立版本；CLI 不可更改     |
| instance_session_bindings                         | 每实例至多一个有效绑定；host/runtime/native ID 的有效组合唯一；epoch 单调递增；原生 ID 不公开到普通消息  |
| instance_session_lineage                          | 保存原始、新建/fork/替代/重建原因、来源实例、checkpoint 和 operationId，不保存第二份业务历史             |
| instance_lifecycle_operations                     | create/fork/replace/remove 的持久阶段、有限重试和清理信息；只服务生命周期，不取代 Inbox/Activation       |
| private_box_links / side_conversations            | 私有 box 对应原实例；Side 对应隔离执行主体和临时目标；权限不可通过普通公开 Room 发现绕过                 |
| memory_records / memory_revisions / memory_grants | 来源、范围、版本和授权；正文按受控内容引用保存；删除/失效可追踪                                          |
| legacy_instance_mapping / migration_operations    | 旧 Agent×频道到新实例的映射、绑定选择、迁移校验和恢复点                                                  |

实例未初始化时没有有效 native binding；不能用假 ID 占位。移除实例保留 tombstone，禁止删除历史作者。bind 表不能同时容纳两个 active epoch；旧 epoch 作为 lineage 留存。

现有 principals 的 Agent kind 可作为底层兼容类别继续使用，产品层区分 legacy_agent、member_instance、side_actor；不能仅靠显示名推断类别。

### 4.3 事件、事务和 API

Role 变更写入 Workspace/control Room 的账本；实例生命周期写归属频道；私聊正文写私有目标；Side 正文不进入主频道；记忆授权/修订写受限控制记录，不广播私有正文。每个操作确定一个主事务 owner，相关 projection、event、Outbox 在同一事务内完成。

建议命令族：role.create/revise/archive、instance.create/updateModel/remove、instance.fork、instance.recover/rebuild、privateBox.open、side.open/close、memory.read/query/write/revise/revoke。实际命名服从现有协议规范；不在此阶段添加未实现的 enabled API。

Human 变更带幂等 key、expectedRevision/bindingEpoch 和主 Room 的 basedOnRoomSeq。身份来自认证上下文。Host 完成 native 操作只能带签发给该 operation 的回执，不能自己决定实例 ID 或新 epoch。

所有现有 Worker 入口（消息、任务、artifact、review、关注、跨目标读取）列入凭据矩阵，不能只给 message.post 加检查。

## 5. 关键事务和状态流

### 5.1 新实例建立

事务创建 pending 实例、配置快照、生命周期 operation 和 Outbox → Host 用 operationId 建 native session → 验证实际 CLI/ID → 事务检查预期版本与成员状态，提交 binding 并激活成员。创建失败保持 pending/failed，不投递普通工作。Host 成功但回执丢失时先按 operation 查已创建对象，禁止盲目再次创建。

### 5.2 正常执行与模型调整

选择已就绪实例 → 事务取执行租约、冻结配置及有效 epoch → Host resume 原 ID → Worker 操作校验 lease/host generation/epoch/目标权限。model/effort 变更形成待应用配置，在安全边界应用；成功后确认 actual 配置，不修改 session ID。Provider 拒绝则保留旧配置并显示失败。

配置不是会话身份，但 prompt/skills 等变化也不能悄悄替换历史 system 内容：旧实例继续冻结模板，只有本次明确允许的模型/effort override 进入现有实例。需要不同 CLI 或新模板时创建新实例。

### 5.3 Fork 与恢复替代

```text
请求并记录 operation
  → 锁定源 binding 和已完成 checkpoint
  → 检查该 CLI 的忙时能力，必要时等待安全点
  → Host 原生 fork，得到待验新 ID
  → 验证身份、权限、截止点
  → Kernel 原子提交新成员（fork）或新 epoch（replace）
  → 恢复允许的待交付工作
```

fork 不复制任务/收件义务/运行租约。replace 保留原实例与未完成义务，但必须先 fence 旧执行。发出取消并不证明进程已停止：旧进程业务写入由服务端拒绝；外部文件/网络副作用还需执行隔离、进程确认和幂等检查。无法确认安全时进入 needs_attention，不自动开第二个写代码的执行者。

SQLite 与 Provider 文件不是一个事务。operation 阶段至少覆盖 requested、native_created、verified、committed、cleanup_pending、failed。每阶段可从崩溃恢复；补偿只回收本 operation 创建的 orphan，不删来源 session。

若两个恢复请求竞争同一 epoch，只允许一个提交；失败者的 native 副本进入清理，不成为成员。推荐有限尝试为一次原 ID resume 加一次 fork 替代；次数是可审配置，不能无限循环。原记录不存在时不自动摘要重建，由用户选择 box 重建并标记上下文不连续。

### 5.4 私聊调度

privateBox.open 幂等创建 Human 与实例的私有目标；它不增加主执行 lane。用户消息进入既有持久投递体系，实例忙时排队。主频道执行凭据不包含待调度私聊目标；私聊执行开始才授予该目标权限。私聊结果明确发到私有 box；结束后旧授权不能继续发帖。

隐私是目标访问隔离，不能承诺同一模型上下文忘掉私聊。fork 继承已有私聊上下文这一取舍已确认，但不能因此继承继续读取私有 box 的权限。Side 则有独立上下文。

### 5.5 Side 与记忆

先验证 CLI 的隔离能力，再创建临时 box 和隔离执行身份。副本使用新凭据，只可读授权记忆；所有 memory 写接口和文件/后台绕过路径都拒绝。Session 文件正常持久化不自动等于写长期记忆，必须区分目录和行为。

本机 Node 沙箱实验仅证明基础原语，不代表四家 CLI 已可发布。尤其是共享 OpenCode/Kimi 后台服务可能在沙箱外写入：需专属受控服务或能够执行同等隔离的适配方式，不能只沙箱客户端。禁止为了实现隔离修改用户全局账户/CLI 配置。

关闭 Side 撤销全部临时能力、停止自身执行并清理临时记录；不通知主频道、不自动回写共享记忆。Provider 的日志保留能力不同，UI 不承诺供应商侧完全无痕。

## 6. 施工批次与阻断门槛

此表保留为架构依赖与未来验收清单；施工顺序已由上方纵向 MVP 决定替代。只为当前纵向路径完成必要依赖，不以未启用的 Side/fork/全平台记忆门禁阻断基本业务。每个纵向切片遵守先失败测试、再最小实现。

| 批次               | 改动和产物                                                                   | 退出条件                                                               | 不通过时                                      |
| ------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| P0 基线与合同      | review 本稿；记录工作树/冻结资产；分类修复现有检查失败；权限和 fork 能力清单 | 明确可执行基线、身份/事件/迁移合同及未支持项                           | 停留设计/隔离验证，不动正式库                 |
| P1 Role/实例聚合   | protocol、Kernel 表/服务、RoleRevision 和实例 principal；内部假适配器        | 同 Role 多实例可区分；旧模板更新不影响实例；旧历史仍可读               | 仅丢弃临时库，修正 schema                     |
| P2 绑定与生命周期  | Kernel binding 事务、operation、native ID 唯一、凭据 epoch；Host 回执        | 并发恢复只提交一次、旧 epoch 全部业务入口拒写、重启可恢复 operation    | 禁止接真实 Provider；保留旧生产路径           |
| P3 频道/私聊调度   | 现有 Inbox/Activation 以实例为主体；私有 box ACL；Guide/等待和公平性         | 两频道并行、同实例私聊串行、无提前读取、无消息零模型轮询、取消重发不丢 | 使用假运行器复现，不能降低 freshness/ACK 要求 |
| P4 Provider 与隔离 | 四家 resume/config/fork/checkpoint；Side 禁写；实际能力探测                  | 每个发布能力有真实证据；不支持准确禁用；身份与权限无继承漏洞           | 按 CLI 禁用具体能力，不静默摘要替代           |
| P5 平台记忆        | 版本化存储、授权、有界索引、按需正文、旧记忆导入工具                         | 并发写不覆盖；撤销/删除/来源失效可处理；shell 和后台无法绕过禁写       | 不开启平台记忆迁移或 Side                     |
| P6 Client/UI       | SDK、client-core、Role 编辑、成员与私聊/Side 界面、能力状态                  | 真实浏览器完整流程、刷新/缩放/断线/晚响应不串身份；移动端检查          | 保持旧 UI 默认，不连接假成功                  |
| P7 迁移演练与质量  | 正式备份的隔离副本、有限真实项目审查、恢复演练                               | 历史/任务/关注/记忆校验通过；有质量及 token 报告                       | 修正后重演，不在正式库边迁边调                |
| P8 正式切换        | 冻结入口、排空、备份、迁移、启动冻结资产、真实页面验收                       | 只有新路径消费已迁移工作；首轮和续聊确认；回滚点完整                   | 按第 8 节恢复，保留全部新增证据               |

P4 的非计费权限原型可以在 P1–P3 期间独立研究；实际 native 接入依赖 P2/P3。P5 的 schema 可先设计，但功能启用依赖其权限验证。不要把这种依赖并行误解为要求多 Agent 并行施工。

P0 原始基线包含 RoomKernel 行数超限、图标快照哈希不符和 12 个格式问题；完整检查进一步暴露旧 Web/回调测试合同未同步。分类修复与实际门禁结果见 [P0 审计](../audits/2026-09-23-role-refactor-p0.zh-CN.md)。不放宽行数门槛或替换冻结哈希；P1 只能在基线门禁收敛后开始。

## 7. 正式数据迁移设计

### 7.1 迁移前生成可审清单

只读生成旧 Agent、有效频道成员、私聊、关注消息列/task、任务所有权、待交付义务、活动 Run、ProviderSessionStore 记录、旧 memory home 的映射清单。列出不可恢复 session、缺失正文/附件、冲突 ID 和未完成外部操作。清单含引用和摘要，不暴露凭据。

不能从某一个旧 key 文件推定“这是唯一最新 session”：旧配置版本可能留下多个候选，需结合实际 Run 证据确认。所有选择形成稳定 migrationOperationId 和审核后的映射，不在启动时随机挑选。

### 7.2 迁移规则

1. 旧 Agent 的当前配置生成 RoleRevision，保留旧 revision 来源；每个有效频道成员关系创建一个新实例。没有频道归属的旧私聊不擅自归到某频道，先作为只读历史保留，由迁移清单指定承接实例后才能续聊。
2. 历史消息、Room events、旧 Task/Run 的作者 ID 不改写；保留旧 principal 和身份展示。映射支持追溯，不冒充新实例过去发过这些消息。
3. 进行中任务在排空后通过显式转交事件交给对应实例；已完成任务保留旧所有者。每项转交有幂等记录。不能直接改历史 event JSON。
4. 关注关系仅迁移实际存在且有效的旧关注者到该频道对应实例，不按 Role 全量补入；已删除/移出频道者不复活。
5. 一个旧 native session 最多一个直接继承者；其他实例用已验证 fork，或由用户选择 box 重建。fork 的混合旧历史不会自动清洗跨频道/私聊内容，迁移报告必须说明。
6. 旧记忆按来源导入受限 legacy scope，默认只授予明确的迁移后继实例；不自动向所有同名 Role 或全平台公开。跨频道共享需显式授权，原文件保留只读备份。
7. 未完成 Inbox/Activation 不简单复制所有行。先按旧义务、已处理事实和转交映射生成迁移计划；新义务引用旧 obligation/migration ID，旧执行者在同一受控切换中停用，避免一份工作被双方消费。

### 7.3 每一阶段的校验

校验分开比较：历史消息/事件/附件引用不变；旧 ID 可解析；映射唯一；有效成员/关注无遗漏无额外增加；待处理义务能逐条对账；任务单一 owner；没有活动旧凭据；新实例 native ID 不重复；memory 正文/授权和索引一致。

先迁移临时副本，再演练程序崩溃在每个 operation 阶段的恢复。正式 schema 扩展不是自动启用新调度；当前二进制对不支持的新 schema 继续 fail closed。

## 8. 切换、回滚与发布

推荐采用维护窗口整批切换。可以让 legacy 数据只读保留，不让同一频道的新旧调度混跑。不为方便灰度而建立双写同步器。

正式步骤：

1. 记录待发布代码/资产摘要和数据库版本，确认所有相关门禁。
2. 暂停新业务提交，浏览器明确显示维护状态；安全排空运行和待提交外部副作用。无法排空就报告阻断，不强杀后假装安全。
3. 一致备份 SQLite、附件、旧记忆、绑定索引和迁移 manifest；记录 Provider 原生 session 的保护/备份策略，不擅自复制用户整个认证目录。
4. 执行审核过的迁移计划；外部 session 操作通过 operation 恢复，不能持 SQLite 事务等待 CLI。
5. 核对数据后切换 execution mode，启动验证过的冻结资产；验证新进程及真实页面，健康接口不代替验收。
6. 先验证一个实例的首次/续聊/私聊，再开放工作；保留可观测性和迁移回执。

回滚分三种情况：

- **新调度尚未运行**：停止新实例，恢复一致备份和旧资产；回收新建 orphan。确认没有新增业务事实后才能无损恢复。
- **新调度已运行但尚未产生业务/外部副作用**：先 fence/停止新执行，再验证条件并恢复；不能只凭“没看见回复”判定无副作用。
- **已经产生消息、记忆或代码/外部修改**：优先前向修复；需要回退时先导出新增事实、工作树和对应操作记录，制定重放/保留方案后恢复。直接回滚 DB 会丢新事实，原生 session 也可能仍含新上下文，不能宣称一键无损回退。

浏览器刷新和 daemon 重启不触发迁移、不创建新实例、不重置 session。旧二进制不写新 schema。不得用改变模型或清空历史来“修复”验收数据。

## 9. 验收矩阵与证据格式

| 场景                                      | 必须证明                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| Role 更新、同名多实例                     | 冻结快照不变、身份明确，@/任务/关注不混同                                        |
| 三轮续聊、进程关闭恢复、model/effort 切换 | 原 native ID 连续，早期具体细节可核查，未静默新建                                |
| 两频道无关任务并行                        | 独立实例/session/lane，权限和上下文输入无串线                                    |
| 频道忙时私聊                              | 不进入当前 turn 或被 check 提前读；后续回复在私有 box                            |
| 用户 Guide、同伴消息、turn 结束竞态       | 正确排队/追加，未消费不当已处理，重复 hint 不重复提交                            |
| Fork 与 replace                           | checkpoint 正确，新身份/旧身份取舍正确，任务和权限不继承，双请求只有一个有效结果 |
| session 丢失/认证变化/late write          | 有限恢复、旧执行拒写、不能恢复时等待用户，不反复花 token                         |
| Side 与记忆                               | 授权读取成功，工具/文件/子进程/后台写入均失败；不影响主上下文                    |
| 并发记忆修订/撤销/删除                    | 无覆盖、无标题索引泄露，历史版本可追溯                                           |
| daemon 崩溃/迁移中断/重复提交             | operation 幂等恢复，无幽灵成员、双 lane 或丢义务                                 |
| 真实浏览器 Web/PWA                        | 同一数据语义、导航/目标正确、重载及晚响应不串页面                                |

每行记录代码 revision、配置/CLI 版本、测试命令、结果、证据路径和未覆盖范围。自动化、真实 CLI、双边 Raft、正式部署分别打标，互不替代。

性能与质量使用固定 Git 项目的限定审查任务，多轮追问、恢复再问、并行不同主题。匹配模型/effort、工具和历史前提；分冷/热缓存统计生成次数、输入/缓存/未缓存/输出 token、首回复及完整完成延迟、误报遗漏和证据引用。累计输入不当作上下文大小。先给出原生/Raft/旧RAH基线，再报告新RAH；不预设“必然省 token”或编造统一延迟阈值。

真实付费测试按明确授权和既定模型矩阵执行，预算/任务范围先限定。本轮未运行新测试。

## 10. Review 已认可的施工取舍

用户已对本稿回复“没问题”并要求继续；以下施工取舍保留为验收依据：

1. **历史保留、新身份执行**：不改写旧事件作者，用映射承接任务、关注和义务。
2. **维护窗口切换**：不用新旧双写/双消费者，先临时副本完整演练。
3. **旧私聊不强行归频道**：无明确归属先只读，迁移清单选择承接实例后续聊。
4. **旧记忆受限导入**：不把旧私有资料因为“平台记忆”而自动公开。
5. **能力未达标即禁用**：某 CLI 不满足 fork/Side 隔离时，只禁用该能力，不静默退化成摘要新会话。

按纵向 MVP 主流程继续施工；P0–P8 保留为能力清单，各条路径只执行其必要门槛。已写的绑定基础仍为未接线模块；后续需要调整其字段或接口时正常修改并更新测试。UI 不提前重排大页，具体验收遵守 UI 范围合同。
