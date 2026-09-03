# 消息多选与转发 Raft-first 合同

日期：2026-09-03

## 决策

这是 P2 交互深度能力，不阻塞 Room、Task、InputRequest、Files 的核心闭环，但它已经是
Raft 消息上下文菜单中一个真实可见的动作，不能继续用空按钮或普通“复制引用文本”冒充。
施工分成两个可独立验收的子批：

1. **P2.1 选择模式**：同一个 Room 或 Thread 内多选消息、全选、取消、复制链接、复制
   Markdown；选择状态只属于当前浏览器内存，切换会话或按 Escape 必须退出。
2. **P2.2 canonical 转发**：以稳定请求 ID 向最多 10 个已有可见目标发送不可变
   `forwarded-bundle` 快照，并返回逐目标结果。没有服务端快照、ACL、幂等与附件语义时，
   不开放“转发”动作。

翻译不与本批捆绑。Raft 的翻译是另一套 Provider、语言偏好和缓存合同；Multica 也没有
可以直接移植的聊天消息翻译 owner。把模型临时调用塞进按钮会引入费用、隐私和结果归属
问题，因此继续单列。

## Raft 可证明合同

授权来源：Raft UI `286c3c5d99b56d8be5e3339510de310b4b7fe727`；冻结发布物
`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。

- byte offset `2855000..2856200`：选择 owner 保存
  `channelId/threadRootId/threadRootChannelId/selectedIds/isActive`。进入 Thread 时默认选择根
  消息；`toggleWithThread` 会把根消息与回复一起选中或取消。
- byte offset `2983000..2985200`：选择工具栏显示选择数、全选、取消、转发、复制链接与
  更多动作；窄屏按可用宽度收纳动作。
- byte offset `3016000` 附近：从当前 Room/Thread 已加载缓存解析选择项，补上
  `isThreadChild`，按 seq/时间排序；有未解析 ID 时不静默丢失，而是报告
  `unresolvedCount`。
- byte offset `3187200..3188500`：进入选择模式后隐藏普通 composer；Escape 退出，但
  图片预览打开时优先关闭图片预览；切换会话时清理旧会话的选择状态。
- byte offset `3204100`：最多选择 10 个转发目标。
- byte offset `3207500`：目标搜索调用
  `GET /messages/forward/targets/search?q=<query>&limit=20`。
- byte offset `3225000..3231500`：客户端只提交
  `destinationChannelIds/requestId/sourceMessageIds/note`；服务端负责从源消息构造快照。
  同一个 `requestId` 用于失败后的剩余目标重试；响应按目标返回成功或失败，允许部分成功，
  已成功目标不会再次发送。
- 转发快照为 `kind: "forwarded-bundle", version: 1`，每项至少保留源消息 ID/seq、
  Thread 父子关系、作者快照、创建时间、目标快照、正文快照和附件快照；嵌套转发、系统
  消息和 action card 不可作为源。
- 失败分支明确区分 `cross_source_bundle`、`source_not_found`、
  `forwarded_source_not_supported`、`unsupported_source_message` 与
  `cross_server_source`。因此“拿当前 DOM 拼成 Markdown 再发一条普通消息”不符合 Raft
  合同。

## Multica 复用裁决

审查提交 `11861145abc59a0d39c8c8f24ad837d4584e664f`。全仓没有聊天消息多选、
forwarded bundle、转发目标搜索或逐目标幂等结果实现；已有 multi-select 只用于标签、技能、
成员等表单，不能代替消息语义。Multica 本批没有可直接复制的业务实现，不为满足“第二来源”
而牵强移植。

## RAH OS 本地化边界

RAH OS 不存在 Raft 的跨服务器、加入远程频道或中央目录：

- 目标只来自当前 Workspace 中 Human 已经加入且可读写的 Room/DM；转发对话框不顺带
  加入频道，也不创建 DM。
- 源消息必须来自同一个 Room/Thread；Kernel 重新读取 canonical 数据并排序，绝不信任
  浏览器传入的作者、正文、时间或附件元数据。
- 转发本身不表示 `@Agent`，不自动产生 Agent Activation。只有用户另写明文提及才进入
  attention 路径。
- 每个目标独立提交和独立幂等，整体返回逐目标结果；一个目标失败不得回滚已经成功的其他
  目标，也不得在重试时重复写入成功目标。
- 来源后续被编辑、删除或失去权限时，目标中的正文与作者仍显示当时快照；“查看原消息”
  仍需实时通过源 Room ACL，不能由快照绕过权限。

## 附件的安全闸门

当前 `room_files` 把 Attachment 身份、Room 所有权和本地 blob 路径绑定在同一行，且
`message_id` 是单一消费 owner。直接复用源 Attachment ID 会让目标 Room 绕过源 Room ACL；
逐目标复制 200 MiB blob 又会造成最高 10 倍磁盘放大，并留下文件系统/SQLite 双写崩溃窗。

P2.2 第一版曾以结构化 `attachments_not_supported` fail closed。P2.3 现采用本文预先要求的
“同文件系统 hard-link intent + reconciler”：每个目标使用独立确定性 Attachment ID/ACL/GC 行，
相同字节使用同 inode，不直接复用源 ID，也不逐目标复制数据块。完整不变量与验收见
[转发附件 projected identity 与本地 blob 合同](./2026-09-04-forwarded-attachment-projection-contract.zh-CN.md)。

## Single owner 与数据模型

```text
MessageSelectionStore（Web 内存态，仅选择与键盘行为）
  -> ForwardComposer（目标/预览/note/部分成功重试）
  -> Client SDK typed message.forward
  -> Application Service（鉴权与 schema）
  -> Kernel MessageForwardingService
       - 源/目标 ACL、同源校验、canonical 排序
       - nested/system/action/attachment eligibility
       - destination-specific idempotency
       - immutable forwarded-bundle snapshot
  -> CollaborationService / RoomEventWriter（message.posted 唯一账本）
  -> Message projection / renderer
```

同一 `actor + requestId` 的源消息集合、首批目标集合、附言和完整 bundle 在 Kernel
`message_forward_requests` 中一次冻结。部分成功后只能重试首批目标的子集；作者改名、换头像或源消息
随后变化，都不能让同一请求的不同目标得到不同快照。该请求记录是幂等证据，不是浏览器草稿或第二份
Room timeline。

选择状态不能进入 localStorage/IndexedDB，也不能成为第二份消息缓存。转发结果必须仍是
`message.posted`，Room timeline、Search、Activity、Notification 和 deep link 继续消费同一个
canonical event；`MessageForwardingService` 只拥有“如何从源构造转发快照”。

### Escape 分层协议

选择模式与其上层 dialog/drawer 不能各自把同一次 Escape 当成独立操作。最上层 overlay 处理
Escape 时必须 `preventDefault` 并只关闭自身；Room/Thread 的选择 owner 在退出选择前同时检查
`event.defaultPrevented` 和当前是否仍有 modal。这样第一次 Escape 从转发对话框返回消息选择，第二次
Escape 才退出选择并恢复 composer。该规则由共享纯函数拥有，Room 与 Thread 不复制判断；关闭上层
overlay 时同步卸载 DOM 也不得让同一键盘事件穿透到底层。

## 验收顺序

1. Protocol/Kernel 红测：跨源、无权限、缺失、嵌套、附件、目标上限、幂等重试、部分成功。
2. Projection 红测：源删除后仍渲染快照；源链接重新做 ACL；转发消息不产生 Agent
   Activation。
3. Web 红测：菜单进入选择模式、Thread 根/回复联动、切换 Room 与 Escape 清理、上层转发 dialog
   单层 Escape 消费、未解析项 fail closed、桌面与 390px 工具栏。
4. 隔离真实浏览器：选择两条纯文本消息，向两个已有 Room 转发；确认逐目标一条、刷新后仍在、
   deep link 正确、失败重试不重复。
5. 完整检查、格式、diff、数据库迁移与正式 4173 安全重启；正式实例只做非写入 UI/键盘
   复核，不转发用户消息。

## 2026-09-04 实施状态

- P2.1 已完成：Room/Thread 内存态选择、Thread 根/回复联动、全选、取消、复制链接与
  Markdown、切换会话清理和顶层弹层 Escape 优先级。
- P2.2 纯文本第一版已完成：Protocol、SDK、Application Service、Kernel、SQLite v46、目标搜索、
  请求级冻结、逐目标结果、部分失败重试、刷新持久化、转发 bundle 渲染与来源 typed deep link。
- 转发不生成 Agent Inbox/Activation；空附言通知显示“转发了 N 条消息”；历史作者头像被 GC 引用图
  保留。
- 明确未开放：嵌套转发、系统/action 来源、跨 Workspace/跨 Computer 转发、转发 bundle
  全文进入 Search。这些分支 fail closed，不能被 UI 拼接文本绕过。
- P2.3 已开放附件转发：目标获得 `attachmentPolicy: "projected"` 的独立 ID，并复用统一 Files
  预览/下载；同 inode hard link、目标 ACL、源/目标删除 GC、事务回滚和启动孤儿清理有专项合同与测试。
- 自动化与真实浏览器结果由
  [专项审计](../audits/2026-09-04-message-selection-forwarding-verification.zh-CN.md)记录；本节不把代码存在
  外推成 Raft 全站一致。
