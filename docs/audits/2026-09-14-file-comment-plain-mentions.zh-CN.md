# 文件评论用户提及取消黄底

用户要求文件专属评论区中的@用户不再突出显示，普通聊天继续原样。实际差异来自富文本解析：
账户handle被识别为当前Human时渲染self-reference黄底，直接写显示名称的普通文本未必成为
身份token，导致同一个人出现不同样式。本次不修改消息原文、身份识别或动态显示名称。

唯一owner是apps/web/src/attachment-comments.css：在文件评论正文内覆盖self-reference的
背景、边框、字重/字号、内距和行内对齐，使其跟随正文；选择器同时覆盖普通与hover状态。
保留HumanIdentity资料浮窗和点击入口，保留键盘焦点轮廓。Room、DM和Thread的聊天黄底不受影响。
这不是通过移除references回退为旧账户名，也没有改变评论的接收人或文件关联。

来源沿用授权Raft `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`，
pretty Jw 121712后的评论卡片与既有共享富文本展示。Multica
`11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/issues/components/source-context-comment-list.tsx`复用ReadonlyContent。
本次为用户指定的局部展示差异，无新复制代码或资源，既有来源/notice保持；不是Raft像素复刻。

测试先断言评论提及普通/hover透明、无边框、字重继承，在旧实现得到rgb(255,212,64)的预期失败，
再加样式。专项继续覆盖动态改名、原始代码/未知提及、资料浮窗、位置点击、390px布局、
正常发送、Human评论标签，并新增普通Thread仍然高亮的断言。

Chrome和Firefox专项通过；共享样式匹配证据和UI目录已重建。完整npm run check、format:check、
git diff --check及正式Web构建通过。没有运行付费CLI或新的Raft在线双边验收。

正式实例空闲检查、备份和优雅重启完成，备份为
`/Users/sun/.rah/backups/pre-restart-4020d536-b1ef-4f5e-a0a4-f0059a6f7168`，
冻结构建 `603d9a381d5f319460928d3eb378831ae886727c22e22fcc1408eab48117648a`。
新浏览器只读打开既有报告，在1440px/390px和刷新后验证当前@Hakase仍正确解析、评论提及
透明无边框且字重继承、聊天仍高亮，文件上下文/关闭返回不回归。截图
`/tmp/rah-comment-plain-formal-1440.png`与`/tmp/rah-comment-plain-formal-390.png`已检查。
