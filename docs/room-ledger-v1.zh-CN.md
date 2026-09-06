# Room Ledger v1：第一条可回滚纵切

> 状态：历史 Phase 1 纵切设计与证据。后续写入、Task、Activation 和 Web 已继续实现；当前事实见 [Room-first 当前交付边界](./room-first-delivery-status.zh-CN.md)。
>
> 日期：2026-09-06（Asia/Shanghai）

## 1. 目的与边界

本批不是把现有 Session/Council 页面改名为 Room，也不是先搭一套没有后端真相的 Raft 风格页面。它建立 Room-first 迁移所需的第一个可执行 owner：

- `packages/runtime-protocol/src/room.ts` 持有 Room、Principal、Membership、Message、Event、Inbox、Outbox、Sync 的 provider-neutral 类型和请求校验。
- `packages/runtime-daemon/src/room/room-ledger.ts` 持有 SQLite WAL、单调 Room cursor、成员目录 cursor、direct 配对唯一性、事务、授权、幂等和投影读取。
- `packages/runtime-daemon/src/room/room-actor.ts` 把 daemon-owned 设备认证映射到稳定 Local Human Principal；浏览器不能自报 actor。
- `packages/runtime-protocol/src/room-read.ts` 持有严格可辨识的客户端事件 DTO 和只读请求/响应；`packages/runtime-daemon/src/room/room-read-service.ts` 只接受 daemon 认证上下文，并将内部数字窗口转换为不透明游标。
- `packages/runtime-daemon/src/room/room-read-http-adapter.ts` 把认证 Principal 与五种只读操作转换为预序列化的 typed HTTP envelope；`room-read-http-route.ts` 只在严格版本化路径上解析有界请求体并原样写回该 Buffer。
- `packages/client-web/src/room-api.ts` 是 Web/PWA 的 typed Room read SDK；页面不能自行拼 URL、解释非 JSON 错误或注入 actor。
- `packages/runtime-daemon/src/room/room-runtime.ts` 统一拥有生产数据库、cursor key、只读端口与生命周期；`room-application-lease.ts` 同时锁定“只解析父目录的稳定公开位置”和“当前完整 realpath 物理路径”，两种身份各自在稳定父目录 `.rah-room-locks/` 中以哈希定位 SQLite lease，并按路径排序后用 `BEGIN EXCLUSIVE` 取得；身份相同时自动去重。随后还取得 Room 根内的 `.rah-room-owner.sqlite` lease，它会随数据目录改名而移动，确保活动数据库不能从改名后的新路径被第二个 runtime 打开。
- `packages/runtime-daemon/src/room/room-cursor-key-store.ts` 持有独立于设备 token 的持久 cursor key/generation；正常重启复用，数据库恢复或回滚后显式轮换，使恢复前 cursor 失效。
- 本文冻结时 Session/Council owner 不变，首批路由只有读取能力；后续生产实现已经增加写入、Task、Activation 与 Room 页面，但仍保持 provider lifecycle 不由页面接管。

本文冻结时生产只读 HTTP 开放五个 `POST /api/room/v1/{rooms,bootstrap,events,older-messages,inbox}` 端点。当前版本另有 Task 读取与严格 Human command 路由；所有路由仍由 `DeviceAuthManager.authenticate()` 注入 Principal，浏览器不能传入 `actorId`/`participantId`。

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
6. wake、outbox 发布和 `syncRoom` 均不改变 Inbox acknowledgement。只有带精确目标的显式 `acknowledgeMessage` 或 `acknowledgeInboxItem` 命令可以推进状态；消息 ACK 还产生 `message.acknowledged` 事件。ACK 的 `basedOnRoomSeq` 必须已观察目标实体；不同客户端重复相同 ACK 返回同一 canonical acknowledgement。
7. Membership 写入带 `basedOnRoomSeq`；过期页面不能静默覆盖较新的成员状态。只有 Human 可以创建首版私有 channel/direct Room；成员变更要求 owner/admin，只有 owner 可以授予 owner；direct Room 限两位 participant。同一 workspace 的同一无序 participant pair 只能完成一个 direct Room；第二个未完成壳可以创建，但加入第二位成员时必须冲突并完整回滚。
8. 客户端请求体不能携 `actorId`。未来 HTTP adapter 必须从 daemon-owned authenticated principal context 注入 actor。Local Human identity 写入 ledger metadata；即使默认 `owner` handle 已占用，也以稳定 principal ID 建立不会碰撞的新 handle。
9. Inbox 使用独立的全局单调 `inboxSeq` 翻页，不能拿各 Room 可能重复的 `eventSeq` 充当跨 Room cursor。所有普通读取默认且最多返回 500 条；Room 成员最多 500，Principal 字段有固定长度上限。`room_sync`、`listMessages` 和 Application Port 的 1 MiB 约束都针对最终完整 JSON 响应；latest bootstrap 与 event page 是可辨识的两种响应，默认同步不全量驻留长 Room。
   大正文候选在 SQL window 内依据存储 JSON 或 `json_quote(body)` 的转义后字节数预先截断，再进入 JavaScript；最终响应仍会按实际 `JSON.stringify` 结果二次裁剪。消息历史页返回 `forward/backward`、冻结的 `throughRoomSeq`、`cursorAfter` 与 `hasMore`，可从 bootstrap 的最早消息继续向前翻页。
   客户端只接受与请求 `roomId` 相同的 bootstrap、event 和 older-message 数据；任何声称 `hasMore=true` 却没有返回一项进度的列表页都失败关闭，避免跨 Room 串线或无限自动翻页。
10. schema 使用 `PRAGMA user_version = 2`；空库可以初始化，v1 原地迁移会按 `joined_at/room_id/principal_id` 确定顺序回填成员目录，并为恰好两位成员的 direct Room 回填无序配对。若旧库已经包含重复 direct pair，迁移整笔回滚并保留 v1；未知未来版本在任何 schema 写入前拒绝打开。
11. 一条命令只产生一个 canonical occurrence time。Message/ACK 的物化时间与对应 Event 时间相同，事件 payload 同时携带重建投影所需的 `createdAt/acknowledgedAt`，不能让 bootstrap 与后续增量折叠产生时间漂移。
12. 私有 Room 的存在性在成员鉴权前不可观察；未加入的 actor 探测存在或不存在的 Room 都得到相同 `forbidden` 边界。
13. 客户端增量事件是严格的 discriminated union；未知 type、未知 payload 字段、错误 aggregate、零/负序号和不一致 occurrence time 均不得越过 Application Port。内部 command `idempotencyKey` 不进入客户端 DTO。
14. `room.created` 原子携带 Room、owner Membership 与 owner Principal；`membership.added` 原子携带 Membership 与 Principal。客户端不需要另建头像/名称私有查询即可把 bootstrap snapshot 延伸成统一身份图。
15. event、older-message、Inbox 与 Room-list cursor 使用 HMAC-SHA256，绑定 schema version、key generation、cursor kind、认证 Human subject，以及适用的 Room/冻结上界。四类 cursor 不能互换、不能跨 Room/Human 使用，篡改在进入 ledger 前拒绝；cursor 重放只执行确定性读取，不产生 acknowledgement 或其他副作用。
16. HTTP 合同不复用旧服务器的字符串错误推断：九类 RoomDomainError 与 `internal` 的 wire status 由 `runtime-protocol` 单表拥有，daemon adapter 与 Web SDK 必须共同消费，未知实现异常只返回泛化 500。`forbidden` 消息统一，不能通过错误正文区分存在但不可访问的 Room。成功 envelope 的固定包装开销由单一预算 owner 计算，Application Port 预留该开销，适配器再对最终 Buffer 做精确复核。
17. 进入 SQLite TEXT 且参与事件/投影的自由文本共用同一 storage-safe Unicode validator：拒绝 `U+0000` 与孤立 UTF-16 surrogate，保留合法 surrogate pair/emoji 和其他可往返控制字符。Room name、Principal displayName 与 Message body 必须在写入前通过该边界，避免 event JSON 与 SQLite projection 分裂。
18. 响应预算不能制造“200 但永远不前进”：单个 event/message/Inbox item 在配置预算内无法装入时返回 typed `resource_exhausted`。当最大合法 Principal snapshot 与大正文不能同页时，bootstrap 即使 `recentMessages=[]` 也必须从 `throughSeq + 1` 给出 older-message cursor，使已进入 snapshot 水位的消息仍可回读；event cursor 不能吞掉这段历史。
19. 生产 Room Application Port 在 `~/.rah/room`（或当前 `RAH_DATA_HOME/room`）独占 `room.db` 与 `cursor-key.json`。同一公开位置和同一物理数据目标都只能有一个跨进程 owner；另一个 daemon 或 `rah room-cursor` 维护进程必须失败。公开位置 lease 锚点通常位于稳定的 `RAH_DATA_HOME/.rah-room-locks/<location-hash>.sqlite`；若 Room 根本身是 symlink，还会在物理目标的稳定父目录取得 `<physical-hash>.sqlite`。外部锚点不属于 Room 数据备份、恢复替换或文件 GC 的目标，运行期间不得替换其稳定父级；根内 `.rah-room-owner.sqlite` 则必须作为 Room 数据集的一部分随目录原子移动。外部双身份锁阻止原路径替换和 alias 绕过，内部锁阻止活动数据根被 rename 后从新路径直接接管，三者共同保证一个数据库只有一个 owner。daemon 先停止接收并排空 HTTP，再关闭 ledger 与 lease；通知偏好落盘、WebSocket、engine 或 Room 任一关闭步骤失败时，其他资源仍必须全部尝试释放，最后统一报告关闭错误。启动初始化或监听失败、遗留 rotation lock、未知 schema 都必须同时释放已取得的 engine/Room owner 并失败关闭。

20. Room 目录只投影当前认证 Human 的 Membership，不因 `visibility=public` 暴露未授权 Room；public workspace ACL 在有 canonical workspace membership owner 前保持关闭。目录以不可变 `catalog_seq` 倒序分页，首请求冻结 `throughCatalogSeq`，中途新建或新加入的 Room 只出现在新的分页链。direct 条目从同一 Principal 图投影 `directPeer`，同时携带 participant count、Room head 和当前 Human 的 pending Attention count；页面不得另建人名/头像缓存。

21. Web 的自动 ACK 是精确实体呈现协议，不是打开某个 tab 就清空 Room。文档必须可见且聚焦，projection 必须已观察 canonical head；Chat 还要求 latest 历史窗口和底部，只 ACK 当前渲染消息；Tasks 由滚动容器的 `IntersectionObserver` 维护至少 50% 相交的 Task ID 集合，只 ACK 该集合绑定的 Task/Review Inbox。Members、横向或纵向屏外 Task、旧历史窗口、后台文档、stale head 和非目标实体保持 pending。daemon 仍以 `inboxItemId + eventId + entity + basedOnRoomSeq` 逐项鉴权，浏览器没有通用的“全部已读”捷径。

22. Task 列表是有界看板投影，不是 Review 正文归档。它携带当前 frozen Submission 以及每位 reviewer 的身份、处置、目标 digest 和时间，但不重复 Review summary；否则 100 位 reviewer 的最大合法多字节摘要可让一个 Task 自身超过 1 MiB，从而永久阻塞冻结列表页。Review 正文不截断、不删除，继续由 canonical ledger 保存；后续详情/审阅读取必须使用独立的实体定位与有界分页合同。

## 4. 物理存储决策

第一阶段使用 Node 内建 SQLite，启用 WAL、foreign keys 和 250 ms busy timeout。原因是 RAH 是单机 daemon，SQLite 可以让 event、projection、Inbox 和 outbox 共享真正的提交边界，而无需部署 PostgreSQL；短 busy timeout 避免异常外部锁长期卡住同步 daemon。事务 admission 失败会映射成 typed `unavailable`，不会在未开始事务时错误执行 rollback；事务内部失败后的 rollback 自身即使失败，也不会遮蔽原始业务/存储错误。`node:sqlite` 在 Node 22.5 引入，但到 22.13 才无需 `--experimental-sqlite`（见 [Node 官方 SQLite 版本记录](https://nodejs.org/api/sqlite.html)）；RAH 的常规启动不携该开关，因此仓库 `engines` 明确要求 Node 22.13 或更新版本。

Cursor 密钥不复用配对 cookie、Bearer token 或公开配置。Key store 以 owner-only 权限原子落盘；多个 daemon 同时首次启动时通过 no-replace 发布选出唯一赢家，其他进程读取赢家，不能继续持有未落盘 key。损坏状态拒绝静默重建；普通 daemon 重启加载同一 generation，因此已有只读 cursor 可以续页。恢复旧 Room 数据库、从备份替换数据库或有意回退 ledger 时，恢复流程必须以 expected generation 离线轮换 key，并重新启动 Application Port；这会使恢复前可能高于当前数据水位的 cursor 统一失效。

Rotation lock 是已 fsync 的恢复证据，包含 expected/target generation 与目标密钥。进程在 key 发布前或发布后崩溃，后续 `loadOrCreate()` 都失败关闭；显式 recovery 会分别续做发布或核验已发布目标，然后才清除 lock。16 进程并发轮换只有一个目标能提交，迟到竞争者不能留下伪中断 lock。恢复不会在线热换已经构造的 codec：操作者必须先停止 daemon，再运行 `rah room-cursor status`，随后使用带 `--expected-generation` 的 `rotate` 或 `recover`，最后重新启动 daemon。同一 SQLite exclusive lease 会阻止任何运行中的 Room 端口与维护命令并存；进程被 `SIGKILL` 后，内核自动释放数据库锁，不执行任何带竞态的 stale-file 删除。

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
- outbox lease 排他、同名 worker 的旧 fencing token 拒绝、过期后恢复、失败延迟重试、同 claim 完成重放、毒 payload sticky block，以及基于 durable published head 的有界 GC/空闲重启自愈；
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
- HTTP adapter 的五类分派、匿名拒绝、请求 actor 注入、私有 Room 存在性隐藏、全部 typed error/status 映射、未知异常脱敏与最终 wire Buffer 的 1 MiB 预算。
- NUL/孤立 surrogate 在协议和 daemon 边界被 typed 拒绝；合法 emoji、引号、反斜线、换行、制表与退格在 Room/Principal/Message 的 event 和 projection 间 byte-exact 往返。
- rotation 在 lock 发布后、key 发布后的真实子进程 `SIGKILL` 恢复；遗留 lock 启动失败关闭；损坏恢复证据不被自动删除；16 进程并发 rotation 只有一个提交。
- 500 成员最大身份字段与 100,000 字符高 JSON 转义正文的真实 adapter 组合下，bootstrap 和 older-message 两个 envelope 各自不超过 1 MiB，正文仍可 byte-exact 取回；自定义小预算无法容纳单项时返回 413，而不是重复同一 cursor 的空 200。
- 真实 HTTP 服务器上的五个版本化只读端点、单次 daemon 认证、64 KiB 请求上限、malformed JSON、匿名请求、actor 注入、原样 Buffer/`content-length` 与 CORS 保留。
- v1→v2 真实 SQLite 迁移、目录确定回填、direct pair 回填，以及重复历史 pair 时无局部表或版本推进；Room 目录冻结分页不因中途新建 Room 重复/漏读，非成员 Room 不进入结果。
- Web typed SDK 的五条只读路由、共享 cookie/CORS transport、protocol-owned error code/status、跨 Room 响应串线拒绝、无进度 `hasMore` 页拒绝，以及非 JSON、错误 operation envelope 的 fail-closed 处理。
- 同一 Room 数据根的进程内和真实子进程排他；父级/root 级 symlink alias、`room/` 原子替换及 rename→symlink 回旧数据库的组合不能绕过 owner；维护命令在 daemon 运行时拒绝；持锁子进程 `SIGKILL` 后由 SQLite/内核释放；16 个同步恢复竞争者严格只有一个成功；daemon 初始化或监听失败后 engine 与 owner 都释放。
- `rah room-cursor status/rotate/recover` 只暴露 generation，不输出 secret；rotate 使用 expected-generation compare-and-swap。

隔离性能探针现已可复跑：`npm run benchmark:room-ledger -- 5000 64`。2026-09-05 本机 Node 25.9.0、临时 SQLite、单进程顺序写、64-byte 消息且无 Attention 的三次结果中位数为 1,161.23 ms（约 4,305.77 条/秒）；latest bootstrap 读取 500 条消息中位数为 1.88 ms，完整响应 104,127 bytes；关闭 WAL 后主数据库为 5,054,464 bytes，进程 RSS 相对探针起点增加中位数为 42,893,312 bytes。时间与 RSS 受机器噪声影响，三次样本仍不能用来宣称容量或长期稳定性。

该探针只用于发现明显退化，不是容量承诺，也未覆盖并发 writer、大正文、附件、Inbox fan-out、磁盘耗尽、锁竞争或长时间堆稳定性。现有真实 `SIGKILL` 只覆盖 cursor-key rotation 的两个关键窗口，outbox lease 覆盖关闭/重开恢复；ledger 写事务强杀、磁盘故障和持续运行基线仍未完成。

本批不包含可见页面验收。新增公开路由已通过真实 loopback HTTP 请求，但这不等于浏览器产品流程；UI 消费 canonical SDK 后，必须补真实桌面与 390×844 浏览器路径。对于与 Raft 相同的页面和交互，仍必须回到官方同条件浏览器取证；内部组件库只消除 RAH 自身分裂，不自动等于 Raft 证据。

## 6. 历史下一施工顺序

1. 增加真实 outbox dispatcher 的启动/停止、退避与观测；当前 ledger 已具可靠领取协议，但尚没有常驻发布进程。
2. 从 Council 建立单向兼容 adapter，验证同一消息只写新 ledger 一次；旧 Council store 保持可回滚，不做双向双写。
3. 再增加 queued Activation/per-participant lane、lease 和 AgentHost；Inbox.available 只作为 durable work 的前置，不等于已经启动模型。
4. 让 Raft 风格 Room 页面消费 canonical SDK。与 Raft 相同的 Room/DM 列表、空态、hover、浮层、拖拽和断点仍需官方同条件浏览器取证与组件状态矩阵；内部组件库负责消除 RAH 自身分裂，但不是官方真相。
5. public/workspace ACL 与个人 Manual/Recent/A–Z 排序各自建立 owner 后再接 UI，不能把 schema 中的 `public` 或页面本地排序误当已授权业务事实。

本节记录当时的待办，不能作为当前完成度清单。当前未收口项以 [Room-first 当前交付边界](./room-first-delivery-status.zh-CN.md) 为唯一入口；尤其生产 AgentHost、冻结代码交付、ACL/附件/Placement 和全页面官方 UI 取证仍不能外推为已交付。
