# 文件评论数与引用图标

## 源码证据

Raft `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
本地授权分析版本 qA（pretty 142525–142546）：附件元数据使用10px、黑色45%，
评论数大于0且不是图片/PDF时显示分隔点、9px message-square、数量，gap/pl各4px。
Jw（121752–121762）：整文件引用使用9px file-text，文件名为10px粗体。
x6e/jy（94723–94737）为 file-text 原始SVG路径。

RAH 原组件调用不存在的 `file` sprite；现在用 `file-text`，将该图形的路径原样提入
ui-tokens 的维护型 interaction-icons.svg，保留来源注释。Lucide 的 [ISC 许可](https://github.com/lucide-icons/lucide/blob/main/LICENSE)
原文随正式包 `/legal/lucide-icons-LICENSE.txt` 一同保留，不改动其他素材通知。
message-square复用原共享图标。样式与条件为结构移植，评论持久化及刷新为RAH接线。
Multica当前 `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/editor/html-preview-body.tsx` 拆分预览内容与附件读取；本项继续用已有RAH预览/评论owner，未复制Multica代码。

## 单一所有者与协议

AttachmentCommentsService仍为评论唯一写入owner。`attachment_comment_links`是计数来源，
按附件ID和Room统计，普通Thread回复不计入；重复幂等提交不重复增加。
同一评论事务更新原消息attachments_json中的可重建commentCount显示投影，
启动从历史links恢复。原始消息事件、接收凭据与用户正文保持原样。
协议Attachment新增可选非负整数commentCount；旧服务/未评论文件缺失时UI不显示数字。
准备上传与发送仍使用原有字段挑选与附件ID，不接受客户端指定业务计数。

消息列表增量游标不会重新拉取旧父消息，因此评论数还接入已有MessageSocial的
有界挂载消息批量刷新；不为每张文件卡新建请求或计时器，不加载全部评论。
可选attachmentCommentCounts按附件ID传递，版本取reaction/comment对应Room事件的最大序号，
保留原客户端版本、作用域与卸载围栏。原Room读取授权先于计数投影。
文件卡复用此读模型更新，保持卡片/预览组件身份、草稿和关闭行为。

## 验证

先分别复现后端计数缺失、sprite引用无目标以及发表评论后卡片不刷新的失败。
Kernel验证同一消息两附件分开计数、普通回复排除、幂等、52条评论与10条分页无关、
权限拒绝和旧投影恢复。浏览器使用隔离Room/Fake provider，验证无评论隐藏、
发表评论后无需刷新变为1、HTML不串数、刷新保留、9px共享图标真实存在、
176px卡片及1440×900/390×844；截图已检查。无正式消息发送或付费CLI调用。

## 交付验证

- 评论/消息metadata专项14项通过，图标13项通过；新增file-text以精确追加段独立校验，
  原sprite摘要不变，未替换原整体摘要掩盖旧图形变化。
- Chrome、Firefox卡片/评论门禁通过，包含上述桌面与移动尺寸、实际发送及刷新。
  Raft回归、正式浏览器策略和双边证据登记测试通过。
  `npm run format:check`、`git diff --check`、UI库/组件规格和正式Web构建通过。
- **完整 `npm run check` 未全通过。** 共享工作区并行Task状态编辑改动与旧断言冲突：
  `client-application-service.test.ts` 仍要求状态编辑返回409；`protocol.test.ts` 的严格Task状态校验、
  `task-lifecycle-projection.test.ts` 的执行阶段映射仍按旧合同断言。
  链式检查停止后另跑Web单测，`conversation-page-family-contract.test.ts` 的完成按钮规则同样冲突。
  本批未改这些Task产品规则或降低其断言；四项为剩余全仓验证阻碍。
  此外初次图标检查发现新增资源尚未登记，已以来源固定的追加段验证修复并通过复测。
- 空闲检查通过，备份 `/Users/sun/.rah/backups/pre-restart-6dfc88c5-93df-42b9-8e58-e48cbcc8498f`
  验证完成；正式实例36025平稳替换为47841（监督进程47758）。冻结构建
  `873103e078b195c5f8d6142b58fd464988e9e5ffd08dac53ff40a74d1cf56e9e`。
  保留原LAN/Tailnet绑定、Room历史、Agent配置和私有文件。
- 新浏览器读取已有Markdown的2条评论和patch的1条评论，逐项核对卡片数量、9px图标引用、
  评论区file-text及320px展开完成后的截图，重载数量保持。
  本机、192.168.1.86、100.101.107.87正式构建一致，无页面异常。未发送正式评论或调用付费CLI。
- 证据：`/tmp/rah-file-count-{unit,browser,firefox,check,web-unit,icon-test,formal,restart}.log`，
  `/tmp/rah-file-count-formal-card-0.png`、`/tmp/rah-file-count-formal-preview-0.png`。

本批完成文件评论相关实现与本地正式验证，不宣称全仓测试绿色或在线Raft同条件双边像素验收。
