# 2026-09-08 Worker 普通讨论附件收口

本批关闭“Agent 必须先创建 Task 才能发文件”的缺口。普通讨论可上传并发送文本文件或图片，最终由 canonical Room Message 发布；Task 冻结交付证据继续走原 Task Artifact 流程。未实现本期延期的大文件流式能力。

## Raft 来源与本地适配

Raft `raft-computer@1.0.18` 的授权提取源 `packages/shared/src/attachmentUploadContract.ts` 定义频道绑定 reservation、上传、complete 验证、取消、过期以及 consumed 状态；文件 SHA-256 为 `ee7eebd96e7b68df8378849c261a6e561e890548d8796bdf4822accd021a35e0`。同版本 `agentApiContract.ts` 的 `agentApiSendBodySchema` 支持 `attachmentIds`、可省略正文的文件消息和 held draft 重发参数。本地来源目录为 `/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/source-slices/`；本批是来源支持的结构适配，没有字节复制服务端代码。

现有 `RoomFiles` 已拥有 Raft reservation 状态、文件限额、摘要验证、落盘与 GC，优先复用该 owner，没有引入新 Blob store、上传队列或第二状态机。既有 Multica reuse ledger 没有提供低于现有 owner 适配成本的替代。HTTP `PUT` 完成时执行既有落盘、摘要与 complete 操作，CLI 不另发一个空成功确认。

## 已实现链路及权限

1. 当前有效 Worker 通过 authenticated facade prepare，Room/actor 来自凭据，不能从请求指定，也不要求 Task。
2. CLI 从实际本地文件读取，向实际 HTTP PUT 上传；`RoomFiles` 检查声明大小、MIME、上传状态与运行身份，写入并校验原 bytes。失败保留 failed 状态，重放 prepare 复用原 reservation，cancel 幂等，原 GC 清理过期未发布文件。
3. `message-post --attachment-ids` 最多绑定十个已 complete 的本人普通附件，允许省略 body。Kernel 事务内一次提交消息事件与 consumed 标记；事件写失败不会留下假发布文件。
4. held draft 保存附件快照；再次 hold、send-anyway 保持同一正文目标与附件，不能用发送参数替换。原回执可在文件取消后重放，但新发送已取消文件拒绝。
5. 同 Room 当前有效 Agent 可下载已 consumed 的普通 Human/Agent 消息附件和 Task 附件原 bytes；未发布、pending、跨 Room、失效执行与撤销成员拒绝。文件的 staged 写入归 durable Agent，上传过程中也重新检查当前权限。
6. 普通上传和发布不能消费、取消或改写 Task Artifact reservation；Task 准备、Run/claim 绑定、冻结 Submission 证据链维持原 owner。

协议新增 Worker message attachment prepare/cancel 与上传响应 schema，普通 message request 新增 attachmentIds。`worker-message-command` 只组合已有 route、collaboration、RoomFiles，仍在 Kernel 原事务内。`held_message_drafts` 增加 `attachments_json`（默认 `[]`）并走既有 additive migration，旧草稿兼容；没有新增表、队列或扩大模块行数门禁。

## 验证证据

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-08-collaboration-closure/`。

- `rah-message-attachments-red.log`：缺失普通 Worker 上传能力的失败测试。
- `rah-message-attachments-child-red.log`：真实子进程找不到 attachment-publish 的失败；接线后发现并修正测试使用旧 `ack` 拼写，正式命令为 `acknowledge`。
- `rah-message-attachments-child-green.log`：实际外部 Node child 使用 Worker CLI/HTTP，sync → 发布 TXT 和有效 PNG → 幂等 prepare → 同一 canonical 消息绑定 → 重放 → 下载对比原 bytes → acknowledge。它是无付费模型的受控外部进程，未将空 fixture response 当作上传结果。
- `worker-message-attachments.test.ts`（Kernel）：实际 bytes、pending/failed/cancel、原命令冲突、attachment-only、held/rehold/send-anyway、过期 GC、事务失败回滚、Task Artifact 拒绝、上传期间成员撤销。
- `rah-held-attachment-retry-red.log` / `rah-held-attachment-retry-green.log`：已 hold 后取消附件，原请求回执回放与新发送拒绝。
- 本批与原协作专项合计 21 项曾全绿；此后增加取消后回执及 Task 自创建来源反例，最终合并结果以本次主任务收口报告为准，不把施工中失败日志称为通过。

## 独立审计读工具

对同日 Worker read tools 的审计发现了冻结分页反例：普通 SQLite `room_events.rowid` 不保证删除后的全局单调性。删除另一 Room 的最后事件后，新消息复用旧 rowid，旧分页的 `frozenThroughRoomSeq` 从 4 变成 5。独立反例使用真正的 `deleteWorkspaceRoom`，见 `worker-read-independent-audit.test.ts` 与 `rah-worker-read-deletion-audit.log`。

已将反例交合同映射 owner，并纳入正式 `worker-read-tools.test.ts`。修复复用 discovery cursor owner，以当前 Room 单调 room_seq 冻结 history/taskHistory；Task list 以 canonical task.created 的 room_seq 冻结初始对象范围，其状态投影明确为 current。只读工具不 ACK、不认领，也不提供新的 mutation cursor。审计没有把脚本检查称为真实模型或官网双边验收。

## 证据限制

同日后续独立审计重新打开了上传期间权限检查的一条遗漏：成员/Run 围栏仍有效时，单独撤销 Worker bearer，普通附件与 Task Artifact PUT 会继续 completed。此后已沿 `RoomFiles` 原 owner 检查点接动态 facade 授权，在 I/O 前、关闭后和最终 rename 后提交前复验，失败清理 part/最终 bytes。两条 HTTP 正式 RED→GREEN 以及最终 rename 窗口回归，连同独立九项复验，见[自身资料审计中的相邻上传修复](2026-09-08-worker-self-profile-closure.zh-CN.md)。前面的历史通过数并未覆盖此边界；本补充明确保留这次重新打开与修复的事实。

代码与自动化链路不等于官网同条件对比、真实付费模型调用或正式部署验收。本批未运行付费 CLI、提交 Git、推送或重启正式工作台；这些整体收口由主任务统一执行。大文件流式仍是未来待核实项，普通附件没有扩大多 Human、远程 Computer 或中央服务端范围。
