# 截至 2026-09-07 的代码、产品与交付深度审计

本轮为只读业务审计：不修改产品实现，不提交、不推送、不重启正式服务、不调用付费模型。
新增本报告及索引；复现程序和日志放在仓库外证据目录。

## 总体判定

RAH OS 已是有真实执行能力的单 Human / 单 Mac 多 Agent 工作台候选。
Room ledger、Activation、AgentHost、独立 Agent 配置与记忆、Task/Review 和前端业务链
均有代码及既有实测证据，不能再称为只有 UI 或缺生产 AgentHost，也不应重建上述 owner。
但当前工作区不是可宣布完成的 Raft 对齐版本：本轮复现了三项协作正确性问题、一项前端恢复问题，
当前全量检查失败，适用行为的完整双边验收仍缺。

架构方向成立，当前最需要的是跨环节反例验收与修复，不是再设计一轮平台架构。
未在本轮检查范围内确认 P0；这不表示完成了全源码安全证明。

## 审计对象与证据身份

- Git HEAD：`1dbb3547ea643bfc8739c9e05d3f5808d587796c`，外加未提交工作区。
- Web 构建：`2904a1ce8d8ba548d29bf39cfe38869458e2ff2322a463255e7b8f7da95194c9`。
- 当前正式入口：`http://127.0.0.1:4173`。本轮只读，并只在审计浏览器内模拟状态请求失败。
- 证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-deep-audit`。
- `source-start.json` 为逐文件 SHA-256；`working-diff.patch` 为取样时 tracked diff。
  审计开始时发现 Kernel 新增修改，待其落盘后取样；后续复查未发生产品源码漂移。
  最后复查发现 worker-cli、room-kernel、protocol 三个测试文件又有外部修改，记入
  `source-drift.json`；上述测试结果仅属于实际运行时的输入，未把新测试算成已执行。
  新修改不自动继承上一批通过结果，也不证明已加载到当前正式 daemon。
- Raft 对照沿用授权的 Web bundle/既有现场证据，以及本轮读取的 Computer 1.0.18
  `packages/shared/src/agentApiContract.ts`。本轮没有重新进行全站官网同条件操作。

这不是对每一行源码的穷尽审查。抽查重点为消息路由、输入与任务状态、幂等恢复、
执行/记忆边界、冻结交付、Computer/MCP 和证据管理，配合现有广泛自动门禁。

## 确定问题：按优先级排序

### F1 / P1：合并 Activation 丢失回复目标的可表达性

位置：`packages/kernel/src/room-kernel.ts:1413`、`packages/kernel/src/worker-message-routing.ts:11`、
`packages/protocol/src/worker-message.ts:6`。

同一 Agent 在执行前收到两个不同 Thread 的事件，会合并进同一个 Activation。
`postWorkerMessage` 固定取 `scope.toSeq` 的事件；存在 Task collaboration/review 时还会
固定取该范围中最后一个 Task。Worker 请求没有 causalEvent/message/thread 目标参数。
因此模型即便正确理解两件事，也无法通过普通 message-post 精确选择较早的 Thread。

本轮用真实 Kernel 临时数据库复现：建立 Thread A、B，再 lease 合并 Activation；发送
“Answer for A”实际持久到 B。随后第二条消息还被现有 freshness 逻辑 held。
测试不是靠解析文本判业务完成，而是读取 canonical event 的 threadId。
该路由结构在 HEAD 已存在，不是本轮新增 mention 解析独有的问题。

影响：多 Thread 讨论和多个审阅/协助请求混批时，回复、关注关系与工作归属可能错位。
不能用增加 prompt 或要求模型“注意 Thread”修复协议中缺失的目标表达。

建议：由 Kernel 校验可选的明确 causal target，目标必须属于该 Activation 已投递的事实，
同时满足当前 Room/Task 权限与执行围栏；单一目标可兼容省略，多目标应要求显式选择。
不要为每个 Thread 新建并行 Agent lane，也不要开放任意 Room ID。
出口：双 Thread、双 Task、混合顶层/Thread、held draft、旧目标撤权、重复发送均逐目标断言。

### F2 / P1：已提交消息的幂等重试依赖变化中的收件人集合

位置：`packages/kernel/src/collaboration-service.ts:1677`，及调用前的 `workerReplyRoute`。

当前路径先按最新成员/关注关系重新计算 recipients，再查询已提交事件；重放比较包含
新计算的 recipientIds/reasons。请求本身没有变化，但服务端派生关系变化会被误判为请求冲突。

复现：Worker 发言成功，Human 加入第三个 Agent，Worker 用完全相同输入和幂等键重试，
得到 `IdempotencyConflictError`。这不是授权已撤销：原 Agent、有效 Run 和 Room 均保持。

影响：响应丢失与正常成员管理同时发生时，客户端无法取得原成功回执；若改用新键，可能
重复发言/重复唤醒。已有幂等设计需要补齐这个跨状态边界。

建议：认证与现时权限检查仍保留；对已接受请求，用原始命令身份验证并返回已冻结事件，
不以变化后的派生 recipient 集合否定原回执。新请求才计算新的投递集合。
出口：成员新增/停用、Thread follow/unfollow、mention 状态变化后的原键重试，事件数和
Inbox/Activation 派生数不增加；真实改变 body/target 的同键请求仍必须冲突。

### F3 / P1：新放开的 Agent 来源 Task 尚未贯通 Human InputRequest

位置：`packages/kernel/src/task-intent.ts:247`、`:271`；
`packages/kernel/src/room-kernel.ts:1963`。

当前未提交变更允许 Agent 顶层消息转 Task，并把消息作者 Agent 保存为 creatorId。
但 `requestTaskInput` 仍固定把 creatorId 当 responder，且要求其为 Human。

复现：Agent A 发起工作，Agent B 认领、开始，随后请求 Human 澄清，命令直接抛出
“has no human creator available for input”，即使当前 Room 存在 Human owner。
这项是未提交扩展引入的下游合同缺口；HEAD 尚有 Human 来源限制，不把它倒算成历史部署故障。
Human 完成 Task 已有 manager fallback，本轮没有把它误报成“Agent 创建的 Task 永远无法完成”。

建议：先明确 Agent 发起任务时的 Human 决策归属；由 canonical owner 保存或确定 responder，
不伪造创建者，不让 Worker 任意指定他人。同步核对 blocker、assign/reassign、release、
通知与 Human 验收全部下游消费者。若该扩展尚未获完整裁决，暂缓交付扩展，保留已稳定链路。
出口：Agent 发起→另一 Agent 执行→请求 Human→Human 回答→重新激活→提交/审查/验收。
仅“Agent 消息可转 Task”的正向测试不够。

### F4 / P2：Computer 重启能力读取失败后没有本组件恢复入口

位置：`apps/web/src/components/workbench-service-restart.tsx:10`。

组件仅 mount 时读取状态，catch 丢弃错误；generation 缺失同时代表“确无能力”和“临时读取失败”。
后续按钮禁用，显示“当前连接未提供服务重启能力”，没有重试或自动恢复读取。

正式生产页面 Firefox 故障注入复现：初始状态请求暂时 503，待页面稳定后恢复服务响应，
独立 GET 已返回 200；再等待仍禁用且无组件重试。切页重新 mount 或刷新可以恢复。
测试关闭 Service Worker 以确保 Playwright 拦截实际页面请求；先前未控制该条件的尝试未成立，
没有把它们算作缺陷证据。没有向服务提交 restart。

建议：区分 loading/unavailable/error/online，错误提供只读重试；在重连后重新读取。
重启 mutation 的 generation 去重和后端 idle guard 不应因此放宽。

### F5 / P2：当前完整交付检查失败，不能继承上一批绿色结果

位置：`packages/core/test/source-boundary.test.ts:9`。

本轮 `npm run check` 返回 1：`RoomKernel` 为 6,928 行，超过既有 6,925 行限制。
问题出在当前新增路由接线，上一批 Computer 交付记录不能证明这份增量通过。

对账（2026-09-08）：F5 已于同日由本地 Claude session 修复——`assertWorkerTaskFreshContext`、`requireOwnedTaskClaim` 下沉至 `task-intent.ts`，`room-kernel.ts` 现为 6,890 行，`npm run check` 全绿；见 `2026-09-07-agent-collaboration-minimal-loop.zh-CN.md`。
这是模块边界/交付门禁失败，不把三行超限描述成运行时崩溃。

建议：在修复 F1/F3 时把适当的路由查询移入现有 owner，保持同一事务；不提高上限，
也不通过压行隐藏规模。完成后对同一源快照重新跑完整链路。

### F6 / P2：当前状态文档与证据登记不能可靠充当施工真相

位置：`docs/architecture/room-first-core.zh-CN.md:116`、
`docs/architecture/delivery-and-activation.zh-CN.md:112`、`scripts/ui-behavior-registry.mjs:137`。

两个长期 owner 文档仍分别声称没有冻结 Git evidence、没有 push publisher，与 ADR-0031、
当前 collector/Worker API 和已实现通知冲突。docs/README 又叠加多个“当前/下一步”的旧结论。
新 Agent 必须先解读大量历史才能判断什么真的没做，这本身就是错误施工的诱因。

84 条登记是混合颗粒度的页面/动作清单；`verified` 的校验主要检查枚举、ID 和 reason，
没有要求绑定当前 source snapshot、适用条件和可读取的成功运行回执。
现有脚本确实检查部分来源 hash 与 scenario 引用，但不能据此推出 verified 已通过实操。
登记自己明确不计算全产品完成率，这点应保留。

建议：保留原审计历史，长期 owner 只写现行合同；用单一当前入口引用最新状态。
将既有行为行逐步拆到可验收子动作，分别保存实现、自动测试、真实 CLI、官网双边和正式交付
证据；未经覆盖的状态必须保持未验，不以组件级成功覆盖整个页面族。
不另建第二套互相竞争的总表。

## 架构裁决：哪些应保留，哪些不能继续误解

| 部分                 | 当前事实与审计结论                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Room-first           | Room/Inbox/Activation/RunAttempt/显式动作是业务链；保留。F1/F2 是该 owner 内部的边界缺陷，不是要改回 Session-first。                                               |
| Agent 与计算资源分离 | AgentDefinition/revision、Placement/runtime context、Host/probe 已存在；角色、记忆不应随 CLI/model 改名或重建。                                                    |
| 可靠执行             | 已有 lease/fence、prepared runtime、terminal proof、恢复与 quarantine。诊断与退出不完成 Task。保留已有测试；本轮未重跑所有真实 Provider 生命周期。                 |
| Task/Review          | 已有单 owner、依赖、冻结 v3 submission、不可变 artifact、review 返工与 Human completion。Host 观测证据与 producer_declared 测试声明分开，是正确设计。              |
| 记忆                 | Agent 私有 MEMORY.md + notes、index-only 启动与按需读正文是当前基线；不恢复已撤回的自动切分/挑选策略。目录/API 隔离不是同 UID 全权限进程间的强安全沙箱。           |
| 前端                 | 内部 tokens/ui-web、正式 Web bundle、typed client 与 canonical API 路线正确；不把 Raft 整包 store/云账户逻辑当运行依赖。仍必须检验真实命中、焦点、异步及持久结果。 |
| 本地替代 Server      | 一个本地 daemon 可以承接原 Server 的业务职责，但不能把原 Server 等同于订阅管理。Raft agentApiContract 还包含权限、消息、搜索、Task、附件等合同。                   |
| 多 Agent 的价值      | 当前 Review 证明了协议和证据流可工作；预设 VERSION_ONE/VERSION_TWO 的真实模型测试不证明能识别任意实际缺陷，更不构成“防幻觉保证”。                                  |

不建议现在为了“最优架构”启动数据库重写、通用工作流引擎、新记忆库或第二套 UI。
当一个具体缺陷暴露 owner 边界时，才做有反例保护的小范围提取。

## 前后端尚未收口：严格区分功能与证据

| 范围                       | 已经具备                                                                  | 当前剩余                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent 配置/运行            | Web 配置、冻结 Run context、四 CLI adapter；既有指定真实模型回复/交付证据 | 每家 Provider 的改配置、取消、重启、失败重试组合未全部真实验收；不能从四家成功各一次外推。                                                                          |
| Room 协作                  | 成员投递、忙时排队、Worker 显式回复、Thread follow、精确 mention 增量     | F1/F2；合批、晚到、不同 Thread/Task 的语义正确性反例。                                                                                                              |
| Task/Review                | UI→认领→提交→驳回→新提交→批准→Human 完成；Git/文件冻结和重开证据          | F3；真实复杂任务的独立审查有效性、错误证据/拒绝配合等反例不等于脚本化协议通过。                                                                                     |
| Computer                   | 资料、注册日期、runtime 标签、绑定 Agent 扫描、批量 reset、指南和服务重启 | F4；可信创建者历史、孤儿/已删除 Agent 目录发现清理；升级来源与本机卸载/保留数据语义需要明确，非盲目实现云升级/云删除。                                              |
| MCP                        | 已配置 executor→真实 tools/list→目录/白名单→分配→执行                     | 本机 `managed-mcp.json` 是配置入口；Web 选择已配置连接，不是 Raft 的 URL/认证/OAuth 创建全流程。应做本机首个连接闭环或明确替代合同。                                |
| Agent API                  | Worker search/reaction、Room reply、Task、Reminder、artifact 等已有       | 自主 Channel 加入/退出、profile update、knowledge/wiki 等并无全部等价 Worker 入口。逐行为裁决单机适用性与 credential scope；不要再次误报 search/reaction 全部缺失。 |
| 消息/Search/Files/Tasks UI | 已有大量真实浏览器及持久状态回归，PDF/音视频基础预览已补                  | 完整同条件官方成功/失败/空态/键盘/关闭/刷新矩阵仍未齐；Finder reveal 与本地替代、onboarding/协议需明确。不能把未验一概变成新功能。                                  |
| 通知/PWA/发布              | Web Push 管线、typed click、安全 LAN 配对、本地冻结资产/备份重启          | 物理 macOS/iOS 通知呈现及点击、真实 PWA、长时间 soak、登录/重启恢复等证据；开发工作台不等于签名安装发行版。                                                         |

明确不进入本次首版缺口：多 Human、差异化 Human Room 权限、远程其他 Computer 添加、
大文件流式、订阅/账单/商店/中央账户，以及用户排除的翻译、语言和时区选择。
Cleaner 自治维护与记忆增强维持既有暂停/可选政策，不以追求 npm 代码行数对齐重新开启。

## 本轮运行结果

| 检查                              | 结果与含义                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                   | 失败；包测试 934 项中 930 passed、1 failed、3 skipped，唯一失败为源码规模限制。前置 identity/UI contract/typecheck 已通过。后续串行步骤不会因此自动执行。 |
| 单独 `test:web:unit`              | 369 passed。                                                                                                                                              |
| 单独 `test:parity:regression`     | 34 passed。                                                                                                                                               |
| 单独 `test:formal-browser-policy` | 10 passed。                                                                                                                                               |
| `repro.test.ts`                   | 3 个诊断性复现断言通过，表示 F1/F2/F3 的错误确实存在，绝不表示产品通过这些正确性要求。                                                                    |
| `restart-recovery.mjs`            | F4 在正式 Web 生产包的隔离 Firefox 中复现，只有浏览器拦截状态响应，无正式服务 mutation；截图已检查。                                                      |
| 既有证据                          | 上一批完整 Chrome/Firefox foundations、22 组广泛浏览器门禁、真实 CLI/Review 按各自源版本沿用为历史证据；本轮没有宣称全部重新跑过。                        |

`npm run format:check` 与 `git diff --check` 通过。本轮没有产品变更，故不另建 Web 包或
重启正在工作的正式服务。

首次诊断程序存在测试准备不足（Agent 请求缺 freshness、第二条回复实际为 held），修正夹具后
才得到上述三项复现。正式页面拦截前两次受 Service Worker 条件影响，没有算通过；最终明确
阻止 Service Worker 后验证。日志中的故障断言通过与正常门禁成功严格分开。

## 建议施工顺序与退出条件

1. **冻结当前候选、处理 F3 的扩展合同和 F5 门禁。** 不让正在扩展的 Agent Task 语义混入
   上一批交付证书；定义 Human responder 后走完整输入恢复链，或暂缓该扩展。
2. **关闭 F1 精确目标。** 同一 Agent 两个 Thread/Task 合批，各自回复持久到正确目标，
   保持单 lane、causal proof、权限和 held draft；不以增加模型提示替代协议。
3. **关闭 F2 原回执重放。** 改变成员/订阅后，原键仍返回原事件，不重复产生 attention。
4. **关闭 F4 Computer 异步恢复。** 失败、拒绝、不具备能力、重连和重复点击逐状态复验。
   再依次处理 Computer 已证实的目录生命周期和本地管理合同，不扩远程。
5. **收口首次 MCP 配置，再补适用页面的官方双边矩阵。** 每次一个动作族，来源→本地 owner→
   正反例→双边结果；不要新开大量页面施工掩盖未闭环。
6. **最终单机发布验收。** 对同一源/构建身份执行完整 gate；既有模型授权按当时范围处理，
   真机通知、PWA、长时运行与安装恢复单独列证。未具备条件的结果保持未验。

F6 的文档与证据修整随上述每次闭环更新，不应成为单独的大规模文档重构项目。
验收至少同时回答：对象归属是否正确、错误是否可恢复、重启后是否保持、官方适用行为是否对齐。
在 F1–F5 关闭且发布证据补齐之前，不宣布“全面收口”或“完整复刻”。
