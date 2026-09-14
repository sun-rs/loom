# 文件评论显示名称与引用层级

后续用户指定精简：[文件评论上下文](./2026-09-14-file-comment-context-presentation.zh-CN.md)取代本记录中每张卡片重复文件名的决定，保留章节位置和动态名称。

## 问题与表达

评论作者标题已经可能显示Hakase，但正文以无references的MessageMarkdown渲染，导致
`@owner` 成为普通文字，未参与既有动态显示名称解析。同时原引用标签以同一file-text图标
显示文件名或章节名，两者视觉层级相同。

现在整份文件引用保留“文件图标＋文件名”的灰色描边标签。存在锚点时，文件标签保持完整
文件上下文，下方额外显示“定位图标＋章节/时间点/区域/位置＋位置名称”，用浅青底与左侧线
表达文件内部的位置；章节不再占用文件名标签。引用原文继续独立显示，点击位置沿用既有定位。
这一层级是用户指定的本地改进，不宣称其颜色/布局直接取自Raft。

## 来源与单一所有者

Raft授权发布源 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
Jw评论引用（pretty121712–121770）以同一文件样式呈现anchor或filename；先前已提取的
file-text以及维护型map-pin符号继续复用，没有新资源或冻结快照修改。
动态提及沿用先前审计所列Cde/U的ID→当前显示名称原则。
Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/issues/components/source-context-comment-list.tsx`使用来源上下文评论快照，
未提供适用于本地文件内锚点的直接替代组件，本项未复制其代码。

AttachmentComments已有room.member.list权限结果限定提及目录，WorkspaceEntities负责当前
身份，MessageMarkdown/HumanIdentity负责提及解析、显示名称与资料浮层。正文现在接入这些
既有owner；Human作者标题/头像名称也读当前授权身份。未知人名、code与原始持久消息不改写。
不新增身份缓存/请求循环，不扩展成员可见性，不修改后端评论或锚点协议。

## 验证

先用真实消息组件浏览器用例复现缺少动态提及节点；修正后验证重复账户改名、旧评论正文、
作者、代码与未知提及不变、文件标签/章节行区分，以及390px布局。位置点击和身份悬停
沿用共享交互，并核对后端评论原文仍为旧handle。

完整 `npm run check`、格式/diff、正式构建与Chrome/Firefox新专项通过。
正式首轮发现Agent目录长名称覆盖评论短署名，因此把作者标题实时覆盖限定到Human，
Agent继续使用评论服务署名；该范围修正后再次通过typecheck、构建和Chrome专项。
未把Agent目录名称差异伪装成用户要求，也没有修改Agent名称数据。

正式工作台通过空闲校验、持久状态备份和优雅重启，最终备份为
`/Users/sun/.rah/backups/pre-restart-3fed433f-e2e5-4409-ad9f-897bdd671a3b`，
冻结构建 `511778d410ce9420224b4c6e2455f5aee6fd30e66e8045b7a69aa84f4692ba5e`。
新真实浏览器在1440px/390px读取用户所示文件，确认Hakase→Kimi顺序、正文`@Hakase`、
两个完整文件标签、仅章节评论显示章节定位行、点击后实际章节闪亮，以及刷新。
截图 `/tmp/rah-comment-identity-formal-1440.png` 已检查。
正式未发送评论、改名或运行付费CLI；未宣称该本地引用设计是Raft字节复制或双边像素验收。
