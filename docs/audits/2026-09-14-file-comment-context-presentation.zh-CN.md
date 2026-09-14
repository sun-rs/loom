# 文件评论上下文精简与回复关联分析

## 已实施的显示约定

用户要求优先于此前Raft对齐：共享聊天消息行按当前Principal.kind显示Human的
“评论：文件名”，Agent保持“回复：文件名”。只渲染已有attachmentComment投影，
不根据消息文字、作者名称或同Thread内其他附件推断关联。Room、DM和Thread复用同一消息行。

AttachmentComments内文件名只在标题和composer占位提示出现，各评论卡片删除重复文件标签；
章节/区域/时间点等位置提示、引用原文和受支持的点击定位继续保留。整文件评论没有空定位按钮。
composer沿用已删除“打开讨论”的决定，并删除“评论已发送”成功文字。发送中禁用、失败反馈、
幂等重试和定位结果提示保持。唯一展示owner为apps/web两个既有组件，没有新增业务状态。

本约定取代[此前文件名与章节分层方案](./2026-09-14-file-comment-identity-and-location.zh-CN.md)
中“侧栏每张卡片保留完整文件名”的决定；章节的独立表达继续有效。

## 来源与差异

授权Raft源 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`，
分析pretty文件Jw 121712–121770为作者/时间/附件锚点卡片，121814后为紧凑composer。
Raft每卡片仍显示文件名或锚点；这里是用户指定的本地精简，不称为逐字复制或Raft参数提取。
既有图标、notice及来源边界不变，没有新增第三方资源。

对照Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/issues/components/source-context-comment-list.tsx`：按来源上下文显示评论历史，
不提供可以直接迁入RAH的Room/附件回复关联协议。未复制代码（Apache2及附加条款）。

## 为什么有的Agent回复没有文件标签

实际链路是WorkerMessagePostRequest.commentAttachmentId（CLI为--comment-attachment-id）
传给Kernel AttachmentCommentsService.workerMetadata；只有显式指定才生成关联，且校验附件
真实属于当前Room和Thread。bindWorkerResult把关联原子写入attachment_comment_links；
文件评论列表据此筛选。字段缺省时返回普通消息，因此遗漏标签也意味着回复不在文件评论列表。
关联文件与章节anchor不同：Agent可关联整个文件且anchor为null，不要求伪造章节位置。
held draft重发读取已保存关联，不能临时替换文件目标。

当前行为不是UI按语义决定隐藏标签，而是Agent选择的发消息参数不同。本批保留协议现状，
没有补写历史消息，没有让前端把同Thread全部消息纳入文件评论。

建议采用“明确回复关系决定归属，Agent决定是否另起话题”：直接回答一条文件评论时继承
它的文件关联，即使问题是“你是什么模型”，读者仍应在原评论区看到完整问答；主动发普通
讨论消息或明确切换话题时允许不关联。不要基于文本语义或最后一个附件强制归档：同Thread
可能包含多份文件、普通聊天和合并唤醒，位置锚点也不能随文件关联自动复制。

该建议尚未实施。可靠落地需要协议提供可校验的直接回复消息身份/明确脱离选择，由Kernel
唯一维护继承规则，并覆盖多文件混合、普通发言、草稿重发、ACL、重复请求等测试；仅加提示词
无法称为严格保证。当前API的可选commentAttachmentId继续由Agent显式提供。

## 验证

依次运行修改后的身份/位置浏览器测试，分别观察到重复文件标签、成功文字及Human“回复”前缀
的预期失败，再实施最小修复。专项覆盖重复改名、代码内提及不替换、章节定位、移动端无横向
溢出、发送成功后清空且无成功文字、Thread里的Human前缀。

Chrome/Firefox身份与位置专项通过；Chrome完整附件评论门禁通过（八种预览、115条评论三页、并发插入、刷新及重试去重），附件卡片/自动增高专项通过。完整npm run check、格式检查、diff检查、最终类型检查与正式构建通过。

正式实例空闲检查后备份、优雅重启，备份位于
`/Users/sun/.rah/backups/pre-restart-a9e79177-bbf7-4992-aa87-afcd217469a0`，
冻结构建为 `cc4cc51e523874f729a30c5ab43b90394e3068534b6499bf128235e5d0061c6b`。
新真实浏览器在1440px和390px对既有报告核验Human“评论”及Agent“回复”标签、侧栏去文件名
且章节保留、无成功文字/讨论链接、×关闭回原讨论和刷新。截图
`/tmp/rah-comment-clean-formal-1440.png`、`/tmp/rah-comment-clean-formal-390.png`已检查。
正式验证为只读，没有发送评论或改变Agent设置。没有运行付费CLI或新增Raft在线双边验收。
