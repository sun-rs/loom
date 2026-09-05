# Room Ledger v1：第一条可回滚纵切

> 状态：已实现内部 Kernel 与认证只读 Application Port，尚未接入公开 HTTP、Web 页面或 Provider runtime。
>
> 日期：2026-09-06（Asia/Shanghai）

## 1. 目的与边界

本批不是把现有 Session/Council 页面改名为 Room，也不是先搭一套没有后端真相的 Raft 风格页面。它建立 Room-first 迁移所需的第一个可执行 owner：

- `packages/runtime-protocol/src/room.ts` 持有 Room、Principal、Membership、Message、Event、Inbox、Outbox、Sync 的 provider-neutral 类型和请求校验。
- `packages/runtime-daemon/src/room/room-ledger.ts` 持有 SQLite WAL、单调 Room cursor、事务、授权、幂等和投影读取。
- `packages/runtime-daemon/src/room/room-actor.ts` 把 daemon-owned 设备认证映射到稳定 Local Human Principal；浏览器不能自报 actor。
- `packages/runtime-protocol/src/room-read.ts` 持有严格可辨识的客户端事件 DTO 和只读请求/响应；`packages/runtime-daemon/src/room/room-read-service.ts` 只接受 daemon 认证上下文，并将内部数字窗口转换为不透明游标。
- `packages/runtime-daemon/src/room/room-cursor-key-store.ts` 持有独立于设备 token 的持久 cursor key/generation；正常重启复用，数据库恢复或回滚后显式轮换，使恢复前 cursor 失效。
- 当前 Session/Council owner 不变；新 ledger 未接入公开路由，因此可以独立回滚，不影响 1.x 的输入接受、历史和 Provider lifecycle。

公开 HTTP 暂不开放。Application Port 已统一注入稳定 Local Human Principal，但尚无 HTTP adapter、最终 wire envelope 预算或生产启动接线；直接接受浏览器传入的 `actorId`/`participantId` 仍会形成权限漏洞。

## 2. 来源登记

| 来源 | 冻结状态 | 本批采用 | 未采用 |
| --- | --- | --- | --- |
| Raft runtime/页面取证 | 本机取证仓库；Room/成员/inbox/wake 行为证据 | Room 是协作真相；Agent identity 与进程分离；wake 不携正文、不推进阅读状态 | 没有可采用的官方中央 Room 后端源码，因此没有声称“复制 Raft Server” |
| RAH OS Kernel | `0fa8f89b5981536c5c52ccd1c4b998316bd97c20` | `node:sqlite`、WAL、Room 单调序号、同事务 event/inbox/outbox、精确幂等意图、冻结 sync window | 没有复制完整 Task/Activation/Reminder/ACL 状态机，也没有建立跨仓库运行时依赖 |
| Multica | `11861145abc59a0d39c8c8f24ad837d4584e664f` | durable queue、索引、幂等和 keyset 读取的工程约束作为交叉参考 | 不引入 PostgreSQL、云 workspace/account 或其产品状态机 |
| RAH 1.x | 当前仓库 | 沿用 daemon 作为唯一运行时 owner、严格客户端边界和隔离测试 | 不让 Room ledger 解析 Provider transcript，不改变现有 Session truth |

## 3. 已冻结的不变量

1. 每个 Room 的 `roomSeq` 单调递增，事件读取只接受 `afterSeq/throughSeq/limit`；`throughSeq` 冻结一次分页链的上界。普通 cursor 读取只返回可折叠的 `RoomEvent`；`bootstrap: latest` 不允许同时传入 `afterSeq` 或 `throughSeq`，并返回当前物化快照与独立的 `recentMessages` 时间线窗口。bootstrap 类型不再返回普通 `RoomEvent[]`，从协议上消除把已进入快照的事件再次折叠的路径。
2. 同一 actor 的同一 `idempotencyKey`、同一命令和同一规范化请求只返回原结果并标记 `deduplicated`；不同意图复用同一键必须冲突。
   Direct Room 中不会改变业务结果的显式 mention 在计算意图摘要前被归一化。
3. 业务投影、RoomEvent、InboxItem、content-free outbox 在一个 `BEGIN IMMEDIATE` 事务中提交；任何失败不允许留下半条事件或半个提醒。命令回执只保存规范化意图摘要与 event 引用，不额外复制消息正文。
4. Attention 由 daemon 根据 Room 类型和已验证的成员关系推导：direct Room 自动提醒另一位成员，channel 只接受显式 mention；客户端不能提交 `attentionReason` 或任意收件人来伪造 `room_policy` 等系统原因。
5. wake/outbox 只包含 event/Room/participant/cursor/reason，不包含消息正文。outbox 使用全局单调序号、限时 lease、持久 attempt count、每次领取唯一的 fencing token、延迟重试和发布回执；过期 lease 在 daemon 重启后仍可重新领取。完成/失败必须同时匹配 worker 与 token，旧 attempt 即使复用同名 worker 也不能完成新 lease；相同 claim token 的完成重放幂等。
6. wake、outbox 发布和 `syncRoom` 均不改变 Inbox acknowledgement。只有显式 `acknowledgeMessage` 可以推进状态，并产生 `message.acknowledged` 事件。ACK 的 `basedOnRoomSeq` 必须已观察目标消息，但不要求等于当前 Room head；不同客户端重复 ACK 返回同一 canonical acknowledgement。
7. Membership 写入带 `basedOnRoomSeq`；过期页面不能静默覆盖较新的成员状态。只有 Human 可以创建首版私有 channel/direct Room；成员变更要求 owner/admin，只有 owner 可以授予 owner；direct Room 限两位 participant。
8. 客户端请求体不能携 `actorId`。未来 HTTP adapter 必须从 daemon-owned authenticated principal context 注入 actor。Local Human identity 写入 ledger metadata；即使默认 `owner` handle 已占用，也以稳定 principal ID 建立不会碰撞的新 handle。
9. Inbox 使用独立的全局单调 `inboxSeq` 翻页，不能拿各 Room 可能重复的 `eventSeq` 充当跨 Room cursor。所有普通读取默认且最多返回 500 条；Room 成员最多 500，Principal 字段有固定长度上限。`room_sync`、`listMessages` 和 Application Port 的 1 MiB 约束都针对最终完整 JSON 响应；latest bootstrap 与 event page 是可辨识的两种响应，默认同步不全量驻留长 Room。
   大正文候选在 SQL window 内依据存储 JSON 或 `json_quote(body)` 的转义后字节数预先截断，再进入 JavaScript；最终响应仍会按实际 `JSON.stringify` 结果二次裁剪。消息历史页返回 `forward/backward`、冻结的 `throughRoomSeq`、`cursorAfter` 与 `hasMore`，可从 bootstrap 的最早消息继续向前翻页。
10. schema 使用 `PRAGMA user_version = 1`；空库可以初始化，未知的未来版本在任何 schema 写入前拒绝打开。首版未发布 schema 不承诺原地迁移。
11. 一条命令只产生一个 canonical occurrence time。Message/ACK 的物化时间与对应 Event 时间相同，事件 payload 同时携带重建投影所需的 `createdAt/acknowledgedAt`，不能让 bootstrap 与后续增量折叠产生时间漂移。
12. 私有 Room 的存在性在成员鉴权前不可观察；未加入的 actor 探测存在或不存在的 Room 都得到相同 `forbidden` 边界。
13. 客户端增量事件是严格的 discriminated union；未知 type、未知 payload 字段、错误 aggregate、零/负序号和不一致 occurrence time 均不得越过 Application Port。内部 command `idempotencyKey` 不进入客户端 DTO。
14. `room.created` 原子携带 Room、owner Membership 与 owner Principal；`membership.added` 原子携带 Membership 与 Principal。客户端不需要另建头像/名称私有查询即可把 bootstrap snapshot 延伸成统一身份图。
15. event、older-message 与 Inbox cursor 使用 HMAC-SHA256，绑定 schema version、key generation、cursor kind、认证 Human subject，以及适用的 Room/冻结上界。三类 cursor 不能互换、不能跨 Room/Human 使用，篡改在进入 ledger 前拒绝；cursor 重放只执行确定性读取，不产生 acknowledgement 或其他副作用。

## 4. 物理存储决策

第一阶段使用 Node 内建 SQLite，启用 WAL、foreign keys 和 250 ms busy timeout。原因是 RAH 是单机 daemon，SQLite 可以让 event、projection、Inbox 和 outbox 共享真正的提交边界，而无需部署 PostgreSQL；短 busy timeout 避免异常外部锁长期卡住同步 daemon。事务 admission 失败会映射成 typed `unavailable`，不会在未开始事务时错误执行 rollback；事务内部失败后的 rollback 自身即使失败，也不会遮蔽原始业务/存储错误。`node:sqlite` 在 Node 22.5 引入，但到 22.13 才无需 `--experimental-sqlite`（见 [Node 官方 SQLite 版本记录](https://nodejs.org/api/sqlite.html)）；RAH 的常规启动不携该开关，因此仓库 `engines` 明确要求 Node 22.13 或更新版本。

Cursor 密钥不复用配对 cookie、Bearer token 或公开配置。Key store 以 owner-only 权限原子落盘；多个 daemon 同时首次启动时通过 no-replace 发布选出唯一赢家，其他进程读取赢家，不能继续持有未落盘 key。损坏状态拒绝静默重建；普通 daemon 重启加载同一 generation，因此已有只读 cursor 可以续页。恢复旧 Room 数据库、从备份替换数据库或有意回退 ledger 时，恢复流程必须以 expected generation 取得独占 rotation lock、轮换 key，并重新启动 Application Port；这会使恢复前可能高于当前数据水位的 cursor 统一失效。当前 port 尚未接入生产启动，因此正式文件位置与恢复命令需在 HTTP 接线批次冻结。

没有采用“多个 JSON/JSONL 文件分别落盘”的方案：单条 append-only 文件适合审计，但 projection 与 outbox 分文件时无法获得同一原子提交。未来如需要可导出 append-only audit JSONL；它是 SQLite canonical ledger 的派生物，不反向成为第二个 owner。

也没有采用 Multica 的 PostgreSQL schema。只有出现多 daemon 并发写、远程主从或 SQLite 经过真实压测不能满足的写入规模时，才通过 ADR 重新评估 PostgreSQL；迁移必须保持本页协议和幂等语义不变。

## 5. TDD 与验收证据

自动测试覆盖：

- protocol 拒绝 actor 注入、未知字段、无 reason 的 Attention、重复 recipient、越界游标和越界 limit；
- Room create/member/message 的确定序号；
- 相同命令重放与不同意图冲突；
- 非成员读取拒绝、owner/admin 成员写边界；
- 冻结 sync window 与 latest bootstrap；
- wake/sync 不推进 Inbox，显式 acknowledgement 才推进；
- 两个 Room 产生相同 `eventSeq` 时，Inbox 仍通过全局 `inboxSeq` 无遗漏翻页；
- stale membership 写入完整回滚；
- agent 不能创建 Room，admin 不能授予 owner，普通 member 不能改成员，direct Room 不能加入第三人；
- outbox lease 排他、同名 worker 的旧 fencing token 拒绝、过期后恢复、失败延迟重试、同 claim 完成重放和有界已发布 GC；
- bootstrap 使用独立消息窗口，完整 sync/listMessages 响应受字节预算约束，超长 Principal 字段被拒绝；
- 大正文查询在 SQL 读取阶段按 `json_quote(body)` 的真实 JSON 转义体积受预算约束，消息页具有冻结的正向/反向续页语义；
- 冻结事件与历史链在中途 append 时无重复/遗漏，链结束后的 live cursor 精确接收新增事件；控制字符扩张后的完整 Application response 仍不超过 1 MiB；
- 只读请求拒绝 actor/participant 注入；management、本机与配对设备映射为同一 Human，Inbox 只能读取当前认证 Human；
- client event DTO 四种变体的 payload/aggregate/time/identity graph 严格校验，Room/Membership 事件可独立延伸统一 Principal 图；
- cursor 的签名篡改、跨 Room、跨 kind、跨 Human、错误 generation 均拒绝；相同 key/generation 可跨正常重启续页，显式 rotation 会使旧 cursor 失效；
- Message/ACK 的 Event 与投影共用 canonical occurrence time，非成员不能借消息写入枚举私有 Room；
- 关闭并重新打开数据库后 Room、Message、Inbox、Outbox 仍一致，未完成 lease 在进程重启后仍可恢复；
- 未知未来 schema 版本在修改数据库前被拒绝。
- 写事务被另一连接占用时，在 250 ms 边界内返回 typed `unavailable`，且不产生 stray rollback 或局部写入。

隔离性能探针现已可复跑：`npm run benchmark:room-ledger -- 5000 64`。2026-09-05 本机 Node 25.9.0、临时 SQLite、单进程顺序写、64-byte 消息且无 Attention 的三次结果中位数为 1,161.23 ms（约 4,305.77 条/秒）；latest bootstrap 读取 500 条消息中位数为 1.88 ms，完整响应 104,127 bytes；关闭 WAL 后主数据库为 5,054,464 bytes，进程 RSS 相对探针起点增加中位数为 42,893,312 bytes。时间与 RSS 受机器噪声影响，三次样本仍不能用来宣称容量或长期稳定性。

该探针只用于发现明显退化，不是容量承诺，也未覆盖并发 writer、大正文、附件、Inbox fan-out、磁盘耗尽、锁竞争或长时间堆稳定性。已加入的崩溃场景仅验证 outbox lease 跨关闭/重开恢复；公开 application port 前仍需进程强杀、磁盘故障和持续运行基线。

本批不包含浏览器验收，因为没有新增可见页面或公开路由。后续 HTTP adapter、Council adapter 和 UI 消费 canonical SDK 后，必须补真实桌面与 390×844 浏览器路径；不能用本批单元测试代替页面验收。对于与 Raft 相同的页面和交互，仍必须回到官方同条件浏览器取证；内部组件库只消除 RAH 自身分裂，不自动等于 Raft 证据。

## 6. 下一施工顺序

1. 为只读 Application Port 增加尚不注册路由的 HTTP adapter：统一 typed error/status 映射，并对最终 wire envelope 单独执行 1 MiB 预算 TDD；冻结生产 cursor-key 路径和数据库恢复时的 rotation 接线。
2. 设计带稳定冻结键的只读 Room list，以及 direct Room 配对唯一性；不能拿不稳定时间或页面本地列表充当 canonical cursor。
3. 增加真实 outbox dispatcher 的启动/停止、退避与观测；当前 ledger 已具可靠领取协议，但尚没有常驻发布进程。
4. 从 Council 建立单向兼容 adapter，验证同一消息只写新 ledger 一次；旧 Council store 保持可回滚，不做双向双写。
5. 再增加 queued Activation/per-participant lane、lease 和 AgentHost；Inbox.available 只作为 durable work 的前置，不等于已经启动模型。
6. 最后让 Raft 风格 Room 页面消费 canonical SDK。UI 对齐仍需官方同条件浏览器取证和组件状态矩阵，不能把内部模板当绝对标准。

明确仍未实现：public/workspace ACL、control Room、邀请制多 Human、线程/Task/Review、附件与文件引用、Room list、direct 配对去重、正式 dispatcher、HTTP/WS、Council 迁移、Activation/Run、浏览器 UI。此页的“已实现”只指内部 ledger 与认证只读 port，不能外推为 Room-first 产品已经交付。
