# Agent Artifact 来源复用审计

日期：2026-09-01

## 结论

本批不新建第二套文件存储，也不从 Provider stdout、工作目录或 Git
状态推断产物。实现应沿用现有 `RoomFiles` 的预约、流式写入、摘要校验、
Room ACL、消息绑定与下载 owner；只增加受 Activation credential 限定的
Agent 发布入口，并把被发布文件冻结进 `TaskSubmission`。

采用的成熟方案分工如下：

- Raft 定义产品事实：文件是显式上传的消息附件；Channel Files 是附件
  聚合投影，支持预览、下载和跳转原消息；Agent workspace 中的普通文件
  不会自动进入 Room。
- Multica 提供服务端结构经验：Agent 上传必须绑定当前 task-scoped token；
  暂存记录带 `task_id`，Task 完成时只把仍未归属的文件原子绑定到 Agent
  回复，不能抢走已被其他消息占有的附件。
- RAH OS 保留更强的本地安全属性：稳定 Activation/RunAttempt provenance、
  `basedOnRoomSeq`、单 owner Task、内容 SHA-256、精确长度、SQLite 事务、
  owner-private Blob 目录与每次下载重新检查 Room membership。

## Raft 证据

- 来源：授权留存的 `https://app.raft.build` Web build
  `666bab60d8658d9e382e2c286ce1e423231e8f31`。
- Bundle：`index-WTraJnrd.js`，SHA-256
  `fdba93dedef323ded9aba6f87cc211a25885230cbc0ade677b81b209bc881725`。
- 本地证据：`/Users/sun/Code/repos/raft-ui/vendor/raft/manifest.json`、
  `WEB-FUNCTIONAL-INTERACTION-GUIDE.zh-CN.md` 的“频道文件”与
  “产出文件并审查”。
- 可采用合同：显式发布、Message owner、Room ACL、Files 聚合、预览/下载/
  原消息定位；i18n 键包括 `message.channelFilesPanel.previewFile`、
  `jumpToMessage`、`downloadFile`。
- 不可证明部分：留存 Web bundle 不能证明 Raft 云端 Blob 事务、数据库
  约束或失败恢复；这些不能标记为“复制了 Raft 服务端”。

## Multica 证据

- URL：`https://github.com/multica-ai/multica.git`。
- 审计提交：`11861145abc59a0d39c8c8f24ad837d4584e664f`。
- 许可证：仓库 `LICENSE` 是带 Part I 附加条件的 **Multica License**，
  不是单独的 Apache-2.0。UI 派生、托管/嵌入服务和非 UI 再分发均有额外
  条件。本批只做结构移植，不复制 Multica UI；来源和改造必须保留记录。
- 关键文件：
  - `server/internal/handler/file.go`：task-token、Agent、Task、chat session
    四重绑定；拒绝普通成员或伪造 task header。
  - `server/pkg/db/queries/attachment.sql`：
    `CountUnboundChatAttachmentsForTask` 与
    `BindChatAttachmentsToMessage`。
  - `server/migrations/164_attachment_task_id.up.sql`、
    `165_attachment_task_id_index.up.sql`：Task 是上传期间的临时绑定，
    Message 才是持久 owner。
  - `server/internal/handler/chat_attachment_reply_test.go`：覆盖空文本但有
    文件、跨 Task 注入、已归属文件不可抢占、失败不绑定等边界。

## 复用分类

| 能力                         | 来源            | 分类         | RAH OS 处理                                   |
| ---------------------------- | --------------- | ------------ | --------------------------------------------- |
| Files 是 Message 附件聚合    | Raft            | 产品合同移植 | 继续由 Room Message/Files 投影拥有            |
| Agent 显式发布而非扫描 cwd   | Raft            | 产品合同移植 | 仅显式 `rah worker artifact-publish`          |
| Task-scoped 暂存后完成时绑定 | Multica         | 结构移植     | 绑定 RAH Task + Agent + Activation/RunAttempt |
| 未归属条件与不可抢占         | Multica         | 结构移植     | 只消费 `completed` 且未绑定的记录             |
| 二进制存储、摘要、ACL        | 现有 RAH OS     | 直接复用     | 扩展 `RoomFiles`，不复制 Blob owner           |
| frozen submission evidence   | 现有 RAH OS     | RAH 增益     | TaskSubmission digest 覆盖 Artifact 元数据    |
| Provider 输出推断 Artifact   | 无              | 拒绝         | stdout/JSONL/tool output 只作诊断             |
| k-carrier release artifact   | Raft Computer/K | 不适用       | 是程序升级产物，不是协作 Task Artifact        |

## 设计二审结论

1. Worker 请求不能提交 actor、Room、RunAttempt 或任意 Message owner；这些
   全部来自 Activation credential。
2. `artifact-publish` 的 `taskId` 必须是当前 Room 内由该 Agent 持有并处于
   `in_progress` 的 Task。文件路径只由 Computer 内的 CLI 打开；Server
   永远不接受“替 Agent 读取某个任意路径”的命令。
3. 发布时精确冻结 filename、MIME、size、SHA-256、producer、Task、
   RunAttempt。`task-submit` 原子创建 Thread Message、冻结
   TaskSubmission Artifact references、消费文件并追加 Room event。
4. `task-submit` 不接受客户端传入的 Artifact ID 列表；沿用 Multica 的
   Task-scoped 自动绑定，避免漏绑与跨 Task 注入。只绑定当前 producer 为该
   Task 暂存且仍未归属的文件。
5. Review 引用的 submission digest 必须覆盖排序稳定的 Artifact reference；
   工作区文件后来变化不影响已提交证据。
6. 首批不做工作区目录自动扫描、位置锚定评论、多 Computer Blob 复制、Range
   下载或 Finder reveal；这些不能阻塞本机 Agent 产物进入 Room 的 P0 主链。

## 落地审计结论

首批实现遵守上述分工，没有把来源混写为“全部复制 Raft 服务端”：

- **Raft 产品合同已移植：** 显式附件、Message owner、Room Files 聚合、预览、
  下载入口和跳回原消息；Web 继续复用已有附件/Files 组件。
- **Multica 结构已移植：** `task_id` 暂存、仅选择未归属完成文件、Task 完成时
  绑定到回复；代码按 RAH Kernel/SQLite/Activation 边界重写，未复制其 UI。
- **RAH 既有 owner 被直接扩展：** RoomFiles blob/ACL/hash/消费与
  TaskReviewService digest 没有另造平行仓库；Worker scope 额外冻结原
  RunAttempt。
- **已拒绝自行猜测：** 不扫描 cwd，不解析 stdout/tool log，不让请求提交
  actor、Room、RunAttempt 或 Message owner，也不把当前 Git 状态冒充证据。

协议/Kernel/CLI/Application Service 的定向 94 项测试与 `1440x1000` 真实浏览器
主链均通过。浏览器曾发现预览关闭后 daemon 崩溃和 Files deep link 只落到 Task
根消息两个 P0；前者改为独立 fd stream 并在 open 时重验 ACL，后者让 exact
Thread reply deep link 自动打开根 Thread。修复后预览、下载入口、reload 和精确
跳转重新通过，fixture 进程保持在线。
