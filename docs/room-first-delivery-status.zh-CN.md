# Room-first 当前交付边界

> 状态：当前事实入口，2026-09-06（Asia/Shanghai）。历史阶段说明只作为设计证据，不得覆盖本页与代码/门禁的当前结果。

## 已进入生产代码的 owner

- `runtime-protocol` 已拥有严格版本化的 Room、Principal、Membership、Message、Thread、Inbox、Outbox、Task、Submission、Review、Activation 与 RunAttempt 类型、请求校验和错误合同。
- `runtime-daemon` 已拥有 SQLite WAL canonical ledger、认证 Human 注入、统一 Principal 图、冻结 cursor 分页、精确请求幂等、事务性 Event/Inbox/Outbox、content-free wake、持久 Activation lane、lease/fence/quarantine，以及 Task 的 claim/start/submit/review/Human accept/cancel 语义。
- Task 的五列只由 canonical state 投影；Human “Done” 必须经过当前冻结 Submission、所需 Review 与显式 accept。驳回后的旧 Submission/Review 仍是审计历史，但不再伪装为当前交付。取消前置 Task 会在同一 canonical owner 中取消无法履行的依赖 Task。
- Room/Task 读取按 item 数、UTF-8 relation 预预算和最终 wire bytes 多重限制。Task 看板页只携带当前 Review 的有界身份/处置状态，不复制最多 100 份 Review 正文；完整 Review 仍保存在 canonical ledger，单个最大合法 Task 不再卡死列表。浏览器只保留 latest tail 与显式历史窗口；翻页保留可见锚点，并可返回最新窗口。dispatcher 从数据库内 durable published head 按最近 10,000 个序号窗口分批 GC 已发布回执，因此即使在发布落盘后、GC 前崩溃，重启后的空闲轮询也会自愈；pending、blocked、quarantined 项不删除。可解析但不满足 content-free schema 的毒记录会记录 `invalid_payload/actionRequired/sticky` 并停止重试；连 JSON 都无法解析的存储损坏记录进入 quarantine，这是独立诊断分支。
- Web/PWA 已通过 typed SDK 消费 Room catalog、Chat、Tasks、Members、精确 Inbox ACK 与通知。Room/Message/Task deep link 可选择目标 tab、按冻结 cursor 补页并聚焦目标；消息正文、Task 和成员资料不写入 localStorage/IndexedDB。
- `packages/client-web/src/room-ui` 是 RAH 内部英文 neo-brutalist 组件/资产 owner。生产构建不依赖同级 `raft-ui` 或 `rah_os`。与 Raft 重合的叶子样式和交互仍以 `docs/ui/evidence` 的官方页面/公开文档取证为依据；内部库不是自证的“Raft 官方源码”。
- 系统通知默认启用；浏览器在用户手势后请求权限，设置可关闭。Room/DM、直接回复/mention、Task assignment/input、Task review/completion attention 使用 typed Room/Message/Task URL。精确呈现 ACK 只允许在页面可见且聚焦、projection 已观察 canonical head 时发生：Chat 还必须处于 latest 窗口/底部且只确认实际消息；Tasks 由滚动容器内至少 50% 相交的具体 Task 卡片决定呈现集合，只确认该集合关联的 Task/Review attention。Members、后台页、横向/纵向屏外 Task、旧历史窗口和非当前目标均不 ACK。

## 当前可验收的协作链

Kernel 已能确定性验证：Human 创建 Task → assignee 取得带 fence 的执行权 → RunAttempt 启动 → Kernel 接受并冻结调用方提供的结构化 Host-evidence envelope → 独立 reviewer 审阅 → changes requested 后重新交付，或 approved 后等待 Human accept → 完成并释放依赖 Task。刷新、进程重开、丢失 HTTP 回执后的相同请求重放，都不得分裂结果。当前生产 AgentHost 尚未自动观察并生成该 envelope；fixture 合成 evidence 只用于验证 Kernel 合同。

浏览器验收必须同时断言 DOM 行为和重新读取后的 canonical Task/Inbox 结果。截图、看板颜色或 optimistic column 单独不能证明工作完成。

## 仍未收口，不能被测试夹具冒充

1. **生产 AgentHost/Room bridge**：当前 daemon 能产生、合并、租赁、恢复和隔离 Activation，也能保存 RunAttempt/Task 交付，但还没有常驻生产消费者把 Activation 交给 Codex、Claude、Kimi 或 OpenCode，并让运行中的 Agent 通过受认证 bridge 执行 `room_sync/claim/start/submit/review`。浏览器 smoke 使用隔离 fixture 证明 Kernel 合同，不证明真实 Provider 已自动完成这条链。在 bridge 接入前，activation receipt/queued lane 只有每 lane 500 个 RoomSeq 的合并边界、没有 terminal retention；长期无人消费会持续积累，因此这仍是实验性能力，不得作为无人值守运行承诺。
2. **冻结代码交付**：Submission 已支持 host-observed 摘要与显式 evidence digest，但自动冻结 Git base/head/patch、测试结果和不可变 artifact manifest 尚未接入生产 runner。Reviewer 目前不能仅靠 canonical record 证明检查的是同一份工作区版本。
3. **完整协作产品面**：public/workspace ACL、邀请制多 Human、附件/文件引用、跨 Room Reminder target、Computer/Placement/worktree 映射、Council/legacy Session 迁移尚未完成。单机本地文件浏览不等于附件引用、权限与 GC 合同已经完成。
4. **任意久远 permalink**：交互通知指向近期实体并可精确落点；当前浏览器为单次 deep link 设置有界补页上限，超出该边界的任意历史永久链接仍需 daemon 端按 ID 定位 cursor，不能通过客户端无限扫描实现。
5. **官方 UI 全产品一致性**：登记表覆盖 Room shell、分隔线、Tabs/空态、头像、Task 语义、历史和通知。本轮没有覆盖 Raft 的全部 Search/Settings/Computer/Human 页面组合，因此不能声称全产品 1:1。
6. **Activation batch 对应关系**：当前一次 Run 在租赁窗口后产生一条 canonical `message.posted`，会把该 lane 同一 batch 内的消息 attention 一并视为已处理。生产 AgentHost 接入前必须明确采用“一次回复覆盖整个 batch”，还是按 parent/thread/message 建立逐项 correlation；不能让任意回复误消除多个独立 prompt。

## 后续唯一合理顺序

1. 设计并实现受认证的本机 AgentHost/Room bridge，复用现有 provider runtime owner，不解析 stdout/TUI 作为业务真相。
2. 让 host 自动生成不可变交付 manifest（workspace、base/head、patch/artifact/test digest），再开放 agent-side Task/Review facade。
3. 用真实但非 Ultra 的隔离 Provider 跑完整驳回/返工/验收链；故障注入覆盖 daemon/worker/browser 重启。
4. 建立按实体 ID 定位的 daemon permalink cursor，再扩展附件、Reminder、ACL 和 worktree/Placement。
5. 对 Search、Tasks、Member/Human、Computer、Settings 页面族逐页增加官方同条件证据与组合矩阵；每个可见 mutation 同时断言 canonical 结果。

## 来源与验证

- UI 来源采用与回退规则：[`ui/room-ui-source-adoption.md`](./ui/room-ui-source-adoption.md)
- 可机器核验的行为登记：[`ui/raft-behavior-registry.json`](./ui/raft-behavior-registry.json)
- Room Kernel 设计与存储细节：[`room-ledger-v1.zh-CN.md`](./room-ledger-v1.zh-CN.md)
- 长期架构与外部项目边界：[`agent-os-room-first-architecture.zh-CN.md`](./agent-os-room-first-architecture.zh-CN.md)

门禁以 `AGENTS.md` 为最低集合；Room 页面另跑 `npm run check:room-ui-contract`。实机通知与交互分别使用
`RAH_NATIVE_BROWSER=chrome RAH_NATIVE_HEADLESS=0 bash scripts/room-browser-smoke.sh` 和
`RAH_NATIVE_BROWSER=firefox RAH_NATIVE_HEADLESS=0 bash scripts/room-browser-smoke.sh`；默认命令只代表 Chromium。
回执必须绑定实际浏览器产品/版本、最终 Web 构建字节、runner 输入与截图哈希。真实 Provider 验收不得使用 GPT-5.6 Ultra。
