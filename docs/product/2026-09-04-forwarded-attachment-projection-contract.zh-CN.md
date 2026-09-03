# 转发附件 projected identity 与本地 blob 合同

日期：2026-09-04

## 决策

RAH OS 开放消息附件转发，但不复用源 Room 的 Attachment ID，也不为每个目标复制文件字节。
每个目标 Room 获得独立、确定性的 Attachment ID 与 `room_files` 行；本机同一私有 blob 目录内使用
POSIX hard link 投影相同字节。源、目标任一 Room 删除时只删除自己的目录项，另一个 Room 的 ACL、
下载与文件列表不受影响。

`RoomFiles` 是文件身份、字节投影、回滚与孤儿清理的唯一 owner；`MessageForwardingService` 只拥有
源快照、目标 ACL、请求冻结、逐目标幂等与 canonical `message.posted`。Web 只渲染服务端返回的
`attachmentPolicy: "projected"`，不复制字节、不提交可信附件元数据。

## Raft 依据

授权冻结发布物：
`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。

- JavaScript 字符串索引约 `3225000..3226500`：转发预览把源附件冻结为 `attachmentSnapshots`，并标记
  `attachmentPolicy: "projected"`、`provenanceState: "available"`。
- JavaScript 字符串索引约 `3229800`：浏览器向 `/messages/forward` 只提交
  `destinationChannelIds/requestId/sourceMessageIds/note`；附件身份与快照不是浏览器权威输入。
- JavaScript 字符串索引约 `2907900..2909000`：只有 `attachmentPolicy === "projected"` 的附件可点击；
  图片走预览组，其余走文件 chip，均使用投影后的 attachment ID。

Raft 中央 Server 的 blob/数据库实现没有随当前授权前端与 Raft Computer 源码公开，因此本批是
`behavior-contract port + RAH OS local glue`，不是后端逐字复制。

## Multica 交叉依据

Multica revision `11861145abc59a0d39c8c8f24ad837d4584e664f` 的 media reconciler 提供了已在
RAH OS 使用的 durable GC receipt、有限批次、重试与 tombstone 经验；它没有 Raft forwarded bundle
或目标附件身份 owner。本批继续复用既有 `RoomFileGcService`，不引入第二套 GC 或 Multica
Workspace/PostgreSQL 表。

## 不变量

1. Kernel 从 canonical 源消息和 `room_files` 重读元数据；浏览器不能指定目标 attachment ID。
2. 目标 ID 由 `actor + requestId + destinationRoomId + sourceAttachmentId` 的 domain-separated SHA-256
   确定生成；同一请求重试得到同一目标身份，不同目标得到不同身份。
3. 源行必须属于源 Room、由该源消息消费、状态为 `consumed`，且文件为私有目录中的普通文件；
   filename、MIME、size 与 SHA-256 必须和冻结快照一致。
4. hard link 只在同一受控目录内创建；目标路径若已存在，只接受与源相同 device/inode 的孤儿目录项。
5. 目标 `room_files` 行在 canonical 目标消息的同一 SQLite 事务内写入，状态直接为 `consumed`，并绑定
   目标 message ID。事件 append 失败时删除本次创建/接管的目录项；进程在文件系统写入与事务提交之间
   崩溃时，确定性重试可接管同 inode 孤儿，启动 reconciler 会删除没有数据库行的 UUID 最终文件。
6. 在源 Room 与请求回执仍存在时，已投递目标的 replay 只核对冻结请求和确定性目标 bundle，不重新
   读取源字节；源 Room 永久删除会按既有合同擦除请求回执，但已投递目标及其附件继续独立存在。
7. 转发不产生 mention、Inbox 或 Activation；附件存在不改变该规则。
8. 源 Room 删除只回收源 link；目标 Room 删除继续由既有 durable file-GC receipt 回收目标 link。

## 明确边界

- 只支持当前单机 Core 的同一 blob filesystem；不声明跨 Computer 文件传输。
- nested forwarded bundle、system/action 来源、跨 Workspace 仍 fail closed。
- hard link 节省数据块，但每个目标仍消耗一个目录项与一行索引；这与独立 ACL/GC 身份是同一成本。
- 外部人为删除 blob、磁盘/文件系统损坏不由消息 replay 静默修复，下载保持 fail closed。

## 验收

- Kernel：新目标 ID、目标 ACL、两目标不同 ID/同 inode、Files 列表、下载字节、幂等 replay、
  源删除后目标仍可下载、目标删除 GC、孤儿启动清理、元数据/缺失源 fail closed。
- Protocol/Web：`projected/available` 形状；转发卡渲染可点击附件并复用统一文件预览/下载组件。
- Application Service：带附件的真实上传→发送→转发→目标读取 round trip。
- Browser：桌面与 390×844 选择带附件消息、转发、目标预览/下载入口、刷新持久化与来源跳转。
