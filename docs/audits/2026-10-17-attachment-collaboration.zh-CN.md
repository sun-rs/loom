# Markdown附件协作纵向验证

沿用官方来源 a98ae003246a0360872a77d76dec2fccd0347ef7、FSL-1.1-ALv2 和 raft-ui 0.5.64。完整组合为 Attachments → 官方documentPreviewStore → DocumentPreview → 官方DocumentAttachmentPreviewModal/AttachmentPreviewShell/AttachmentCommentsPanel，Loom AttachmentCommentsOwner只提供数据与写意图。官方源码、尺寸、字体和移动端底部评论面板不变。

## 实现与验证

本轮修复跨消息切换附件的异步竞态：旧逻辑每个Attachments组件各自取消请求，不能取消其他消息发起的读取；较慢的旧响应有机会覆盖后选文件。现在所有预览读取共用一个取消所有者，官方store仍是展示所有者；旧组件卸载不取消新组件的读取，旧请求完成也不清除本组件后继请求的busy状态。单测先失败后实现，浏览器通过延迟第一份文件响应验证第二份文件始终保留。

新增真实Kernel/ApplicationService/Gateway、fake Worker执行的纵向浏览器fixture：

1. Role实例的Worker凭据准备并上传真实Markdown字节，显式消息发布附件，不创建Task。
2. Human通过原生附件预览/评论输入框提交问题。
3. 持久评论创建/使用对应消息列，并唤醒参与的附件作者实例。
4. 下一Worker执行以明确commentAttachmentId回复，原生评论面板自动读取到该回复。
5. 普通消息列回复不混入附件评论；刷新后评论与回复仍存在。

以上在1440×1000和390×844/DPR1通过。原有attachment-preview专项还验证选区md-section锚点、点击定位、丢失响应精确核实且不重复写、未决意图不能被Escape丢弃。本轮UI没有新增专属按钮。

## 不能混淆的边界

- fixture确实使用Role实例、Worker权限、真实文件存储和持久消息；但执行由测试驱动，没有启动模型。因此不是“真实模型每次都会正确发布并关联回复”的证明。
- 普通最终回复不会自动变为附件评论。官方AttachmentCommentsPanel本身也是明确文件关联的投影。现有Worker CLI已支持attachment-publish、attachment-comments及message-post --comment-attachment-id，保持显式关联避免同一消息中的多文件串线。
- Markdown/文本当前上限2MiB。模型生成磁盘文件仍需显式发布，纯路径不成为附件。
- HTML尚未接入。原生HtmlAttachmentPreviewModal不只是iframe：依赖服务端附加的几何/外链报告脚本，与attachmentPreviewBridge的nonce、document epoch、frame source校验共同工作。后续必须取得并接齐这一配套源码，不能用一个同源iframe替代。
- PDF仍下载。当前官方CrossOriginPdfFrame要求独立来源，且官方明确关闭PDF评论；阅读与批注不能捆绑宣称完成。

## 检查与部署

16项附件Kernel/ApplicationService/取消机制定向测试、5项来源/消息投影/取消机制检查通过（两组有重叠，不作唯一测试总数）；前端类型、要求的产品构建、格式和diff通过。两个附件专项均为隔离数据，未写用户频道或调用付费CLI。初版新增fixture的清理调用误写service.stop，改为真实close后成功，不将该次失败计为通过。

备份并优雅重启后18张业务投影不变；正式页面双尺寸只读smoke通过，未向真实频道注入测试附件。附件操作证据来自隔离浏览器链路，不冒充正式模型验收。见[证据](../evo/evidence/2026-10-17-attachment-collaboration/summary.json)。
