# 前后端补强施工前独立设计复审

日期：2026-08-31。范围：完整复读[施工方案](../product/2026-08-31-parity-reinforcement-plan.zh-CN.md)，重点独立复核 B Computer、C 未读摘要、D 导航安全及其 owner；承接[上一轮本地映射审计](./2026-08-31-third-party-local-mapping.zh-CN.md)。

结论：**有条件放行设计方向，不是实现或发布验收通过。** 不需要第二套 heartbeat、read-state 或通知业务数据库。B 必须先消除管理操作制造心跳的旧写入，C 必须共用 SQL 资格并明确聚合口径，D 必须以代次守卫而非仅 Abort 实现失效。以下 P1 项是实施及最终复审的拦截条件。

## 审计方法和独立性

- 复读 `AGENTS.md`、`README.md`、`docs/README.md`、ADR-0004/0005、Global Discovery 与身份交互 owner 文档；追查 Kernel、daemon inventory、Human HTTP/SDK、Web 回调和现有临时 fixture。
- 本审计员未改产品代码、未运行构建/测试、未操作浏览器、未访问用户凭据或正式数据库、未重启服务。
- 施工者与审计员共享工作树。下述“旧实现”指本次设计审查最初观察到的代码；结束前已观察到施工者开始删除 metadata 时间戳更新和增加 summary 测试，**不把正在编辑的片段当完整修复证据**。最终应复查稳定后的代码和测试输出。
- 行号用于定位本轮源文件，施工后可能移动；函数名、SQL 与测试名是稳定复查入口。本报告是 E0 设计与源码证据，不冒充 E2/E3。

## B：Computer 最小读模型

### P1-B1：先校正 lastSeen 的写入语义，再据此推断连接新鲜度

旧实现的三个管理写入会更新 `agent_hosts.last_seen_at/last_seen_ms`：

- `packages/kernel/src/workspace-agent-management.ts` 的 `grantHostParticipant`，原定位 687；
- 同文件 `revokeHostParticipant`，原定位 721；
- `packages/kernel/src/workspace-agent-provisioning.ts` 的 `grantHostParticipant`，原定位 452。

这不是 Host 发来的生命证据。尤其 revoke 遍历所有 active credentials，删除一个 Agent 可能给不相关、已经失联的 Host 同时刷新时间。仅把 HostRecord 包成 Computer 状态响应，仍会让它们被误判为刚在线。

**最小改造可以停止这三处 metadata 操作更新时间，不必另建 heartbeat 字段。** 核对理由：

- 这三处 SQL 只同步 `participant_ids_json` 与时间，不写 `instance_id/state`；保留 participant 同事务更新及 `WHERE host_id = ? AND credential_id = ?` 即可。
- `auth.ts:183` 的活跃代次验证读取 `credential_id/instance_id/state`，不读取 lastSeen。删除时间更新不影响 Host 作用域即时变更，也不应放松任何已有认证或 Offer fence。
- `room-kernel.ts:3353` 在 takeover 中消费 `last_seen_ms`。旧 metadata 写入反而会错误延长 incumbent 的拒绝接管窗口。
- `heartbeatHost` 才负责新鲜 heartbeat 与 generation 更新。credential revoke 和兼容迁移另会把 Host 置 offline 并记录时间；这些是明确的强制状态变更，不能为了字段“纯净”删除安全 fence，也不宜把 offline 行该时间对外称为“最后一次成功在线心跳”。

最小回归用已有 fake clock / 临时 DB fixture：

1. `workspace-management.test.ts` 的 `a Workspace manager atomically provisions a real runtime-bound Agent`（原 455）：先 heartbeat，前进时间，provision 后用 `listHosts()` 验证时间未改变。已有 Offer 租约为五分钟，可构造超过 Host stale 窗口但未过 Offer lease 的反例。不能用 `heartbeatHost(host)` 来读取断言值，因为它本身会刷新时间。
2. 同文件 `a Workspace manager atomically configures and controls a durable Agent`（原 981）已有两个 Host 与 configure/rebind/delete 流程：时间前进后，改派/删除不改变任何 Host 的 lastSeen；特别断言不相关 Host。保留已有“正在运行的 Host context 即时取得新 Agent scope”的断言。
3. `room-kernel.test.ts:445` 的 `a newer daemon instance fences an older context for the same Host credential`：在旧 heartbeat 与 takeover 之间加入管理操作；到原 heartbeat 的 deadline 即可接管，之后旧 instance 的 privileged mutation 仍拒绝。覆盖等于 deadline 的边界，不仅 deadline+1。

### P1-B2：最小授权、新鲜度和 UI 失败语义必须明确

现有 `/v1/local/runtimes/list` 在 `client-application-service.ts:394` 认证 actor 后进入 daemon。inventory 首先调用 `kernel.listAgentCatalog(actor)`，其 `room-agent-service.ts:102` 会拒绝非 Human，目录按 control Room membership 过滤。这是可以复用的既有权限路径，不需直接公开无 actor 的 `listHosts()`。

要求：

- 仅返回当前 daemon 的固定 Host 观测，不能新增任意 hostId 查询参数或把全部 HostRecord 序列化给浏览器。HostRecord 还含 processId、participantIds 等，UI 不需要就不扩散。最低字段是固定 Computer identity、观测时间、状态、适用版本及必要的非秘密名称/平台。
- 新字段沿协议 schema、HTTP、SDK 向下兼容传播；用真实 Kernel/HTTP fixture 验证未认证与 Agent actor 拒绝、Human 可见目录仍受 ACL，而不是只用 `listAgentCatalog: () => []` stub 当授权证明。
- 使用 daemon 配置 `hostStaleAfterMs`，和 takeover 的 `takeoverAfterMs` 保持同一边界。样本时钟一次读取；不能让 UI 自行另定 lease。`now - lastSeen >= threshold` 时不再是 fresh。
- 没有记录、时间不可解释/时钟倒退、请求失败与已证明 offline 是不同事实。未知不能变成离线提醒；显式 `offline` 保持离线，fresh `draining` 显式展示；“缺 CLI / 未配置 / Offer 过期 / Agent disabled”分别保留 readiness 与启停语义。
- 单飞刷新需在离页/换 client 时取消并失效；后台、失败与网络慢时不得累积并发请求。保留旧样本时应标注旧数据/错误，不能无限保留一个看似 fresh 的绿色点。旧请求成功或失败都不能覆盖新连接样本。

额外用例：无 CLI 的 fresh Host 在线；PATH 有 CLI 但 Host stale；新鲜 draining/offline；阈值前/等于/后；未来 lastSeen；零记录；离页晚返回；失败后旧样本的正确展示。该读模型只改善观察，不得据此新增业务完成或运行中状态。

## C：HumanActivity 全范围摘要

### P1-C1：共用资格计算，冻结计数及 Room 汇总口径

既有 `human-activity.ts:41` 已拥有 `thread_access → eligible → grouped → visible`：Room/Workspace ACL、关注/自动参与/Task assignee、未读精确 mention 的例外资格、顶层/线程独立 read 与 done frontiers，都已存在。`global-discovery.ts:23` 排除 control、归档 Room、非 active Workspace 和非成员。

`human-activity.ts:92` 的 `total` 是在分页之前 COUNT 卡片。`activity.list({ workspaceId, filter: 'unread', limit: 1 }).total > 0` 已能回答全 Workspace 是否有未读 Activity；但它不是未读消息总数，也不是当前页 items 长度。新增轻量 summary 合理，**应把同一 owner 内的资格 SQL 提取共用，而非复制第二个查询状态机**。

摘要合同还需明确：

- 全局 Activity 未读卡数、未读消息数、mention 标志分别命名，不能互换。
- Room/DM 侧栏到底只算顶层消息，还是汇总该 Room 内符合 Activity 资格的 thread？本轮可明确选择后者复用现有 owner，但不能把这个选择无说明地称为上游所有 channel unread 语义。线程根消息属于顶层，回复属于 thread，不能重复计数。
- Activity 的 done 不等于 Task 完成或 InputRequest resolve。按旧 observed throughSeq done/read 后的新消息仍应出现。顶层 read 不能隐式清 thread，thread read 也不能清其他顶层消息。
- summary 不接受当前列表 cursor/filter/limit 作为“全量”边界，不能求当前页之和。列表旧 cursor 使用 frozen ceiling，而新 summary 反映新消息，两者可有合理差异；测试比对应固定同一数据快照。
- 返回的全局标量与 per-Room 映射不含正文、日志或无权限目标。若对 Room 映射设上限，必须显式暴露不完整或分页机制，不能将被截断的遗漏项视为零。

最小测试扩展点是 `packages/kernel/test/global-discovery.test.ts`：现有 `Activity copies Raft conversation/thread identity...`、`explicit unfollow overrides participation...`、`every global page reapplies membership...` 及 2,000 message / 长线程测试。

必须先红后绿覆盖：超过一页且唯一未读在页外；own message 不算未读；明确 follow/unfollow；unfollow 后新精确 @mention 仍具资格而相似 handle 不匹配；顶层/线程独立水位；done 后新消息恢复；隐藏 Room、非成员 DM、跨 Workspace、退群后的摘要不泄漏；两名 Human 水位不串；长线程资格不退化为逐消息重扫所有回复。最终应验证摘要与未分页语义一致，而非仅增加一个小 fixture。

### P1-C2：圆点可见性与通知生命周期不可混写

- 当前 Activity 页隐藏 rail 粉点是展示选择，不推进 read/done；离页未实际阅读则恢复。真正水位推进仍由现有 visible-message owner 或显式 mark 发出，不拿 event replay、overscan、点击入口当阅读。
- Computer 系统注意事项来自 B 的有效观测；未知/采样失败不是已证明失联。打开通知和 dismiss 均不能 resolve InputRequest，也不能对所有 Rooms 批量清 read。
- dismiss 是可丢失的 UI 偏好，不是 canonical业务完成。key 至少约束 Human/连接/事项对象；版本必须代表稳定的事项变化，不能直接使用每次变化的 `sampledAt` 或 `lastSeenAt`，否则每轮采样都重新提示。
- 冻结“离线 → dismiss → 恢复 → 再离线”是否再次出现；旧 dismiss 不应静默吞掉下一次新故障。无需新建 durable 通知队列，但要用可解释的事项 identity/version 测试，而非颜色状态的松散组合。

## D：精确导航代次

### P1-D1：Abort 是资源清理，generation 才是正确性守卫

旧 `global-discovery.tsx:695` 的 Activity `mark(..., open=true)` 先 await `message.context`，随后 `onOpen`；catch/finally 也直接更新状态。列表 query hook 的取消不能覆盖这段独立预检。上一轮已用原回调受控 Promise 重现“点 Activity 卡 → 去 Settings → 旧响应把页面拉回 Room”。

最小 owner 应绑定连接和用户导航意图，不在 Activity、Search、轨迹各造一套：

- 用户选 surface、Workspace、Room/不同 message、再次请求、Back/Forward、关闭/卸载和换 client 时，同步 invalidate；不能只等 `useEffect` cleanup 执行后才失效。
- 请求冻结自己的 generation/target/context。成功 navigate、失败 error、finally pending cleanup 三个出口都核对身份；AbortSignal 被忽略或 Promise 已 resolve 时也安全。
- A 点击后再点击 B，A 的成功/失败/finally 都不能导航或清掉 B 的 pending。即使两个目标在同一个 Room，也必须是不同请求身份。
- 预检拒绝/过期不 markRead，不污染当前页面错误。正常精确 Thread 链接仍传 canonical Room/message/root 身份，由 mounted viewport 决定已读。

测试清单：A→Settings；A→B且B先完成；A在B之后失败；同Room不同message；切Workspace/client；Back/Forward；卸载；正常Thread成功。受控 transport 故意忽略 Abort 以证明 generation，而非只断言 signal.aborted。再由独立浏览器验证快速切页不回跳，不能以纯 owner 单测替代 App 所有入口的接线证据。

## 放行边界

A 发布隔离、E 动态解析、F 文件交互方向与本次 B/C/D 复审不冲突，但本文未重新认证其完整实现或浏览器表现。E 仍不得凭诊断文本扩大 ACL 或创造 canonical Task；F 仍须保留 AgentHost 私有目录安全与取消 owner。头像默认动态保留用户的明确本地选择，不能据单个官方账号偏好推定普遍合同；轨迹可见性不因为 hover 摘要重构而放开管理员/creator 边界。

最终独立复审必须检查上述反例的实际实现、测试与浏览器证据，并区分：代码完成、隔离 fixture 通过、正式进程/资产已切换。当前仅设计有条件通过，不授予重启、付费调用或发布权限。
