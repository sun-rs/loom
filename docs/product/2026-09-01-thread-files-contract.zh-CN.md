# Thread 附件与长历史合同

状态：2026-09-01 已实现并完成本地真实 Chromium 验收。来源与总体 Files owner 继续以[Files 与空间 / Computer 校准](./2026-08-31-files-and-computer-contract.zh-CN.md)为准。

## 1. 产品语义

- Thread composer 与 Room composer 复用同一附件上传组件和 RoomFiles 服务，但草稿按 `thread:<rootMessageId>` 与 `room:<roomId>` 隔离。
- 上传预约仍以 Room ACL 为边界；Thread 草稿 key 只属于浏览器表现层，不进入 Kernel 身份。
- Thread 回复允许“正文或附件至少一个”。附件-only 回复是 canonical Message，不是临时文件卡片。
- `thread.reply` 的 Message 插入、附件消费、Thread reply count、Room event 和 Agent attention 在同一 Kernel 事务内完成；失败不留下“Files 可见但消息不存在”的半提交。
- 丢失响应后的重试使用首个稳定 AttachmentId 形成 idempotency key；只能重放同一 Message，不能再次消费附件。

## 2. 页面与 Files

Thread 中的附件卡片复用 Message 附件预览/下载。发送成功后，同一文件同时出现在当前 Room 的 Files tab，并可定位到该 Thread Message 的稳定 MessageId。未发送的 Thread 草稿不进入 Files。

主聊天与 Thread 相互切换时，各自保留自己的文本和附件草稿；成功提交只消费本次快照，不清除另一 composer 或随后添加的附件。

## 3. 长历史

不新增第二套滚动实现。Room 历史继续使用 opaque frozen cursor、内存页缓存、虚拟窗口和 prepend anchor。Thread 附件引入的异步卡片高度必须通过现有 measured row 机制处理，不能用完整 10,000 条 DOM 或强制滚底规避。

## 4. 未包含

- Worker/Agent 发布本地产物；
- Task submission 的结构化 Artifact 引用与 Review provenance；
- Range 下载、大文件断点续传、更多二进制预览；
- 跨 Computer blob 同步。
