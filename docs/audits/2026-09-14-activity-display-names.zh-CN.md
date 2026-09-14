# 全局动态卡片显示名称

## 问题与所有者

全局动态直接输出activity.list的senderName和原始body切片，未像聊天正文一样通过当前身份目录
解析显示名称。因此历史卡片作者仍是owner，摘要中的@owner也没有变化。

本次由GlobalActivity接入已有WorkspaceEntities以及当前Human/授权搜索目录，按latestMessage.actorId
显示当前Human名称。摘要与消息列标题采用activityDisplayText，将协议既有messageMentionCandidates
解析出的可见Human提及替换成显示名称。该辅助函数只负责纯文本展示，不产生可点击嵌套按钮，
不改写持久消息、账号handle、API字段、提及投递、动态分页/未读/完成状态。

当前账户结果优先于较旧的搜索目录；身份投影沿用既有归属和更新规则，不新增缓存或轮询。
缺少身份、空显示名称和同名歧义保留原文。代码、链接、URL、邮件、数学和HTML沿用协议解析器
的保护范围；整段解析后再按既有800字符限制截取摘要。Agent署名不因本次Human修复改成长描述。

## 来源

Raft授权发布源 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
pretty 140879的回复署名采用senderDisplayName优先；146274–146300的Agent消息身份优先当前displayName，
Human分支仍回退senderName。本次Human动态展示是用户指定的本地补齐，不将上游回退作为必须复制的限制；
本地延续此前聊天提及修复的身份解析合同，不声称动态卡片是Raft整段字节复制。
Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/core/workspace/hooks.ts`复用当前members目录构建getActorName；其任务活动结构与本地
Room动态不同。本项复用本地已有身份/提及所有者，未复制Multica代码（Apache2及附加条款）。

## 验证

浏览器用例先复现账户改为Hakase后动态作者仍为sun的失败。单元验证Unicode、重复改名、
未知/歧义身份、代码和链接不变。隔离浏览器创建无Agent的临时频道和消息列，验证两次账户改名，
作者、摘要和消息列标题、刷新、390px布局，并读取原始活动消息确认body未改写。

完整 `npm run check`、`npm run format:check`、`git diff --check` 和
`npm run build:web:workbench` 通过。Chrome/Firefox新专项通过，测试未使用真实付费CLI。

正式工作台通过空闲检查、状态备份和优雅重启，备份为
`/Users/sun/.rah/backups/pre-restart-1fcbf665-4531-42f0-8c81-f39ad52463dd`，
冻结构建 `99ec22b22c7a36c6a0c1f614fe506511a4d37f14612b2d0553edd0d77ddd14da`。
新真实浏览器在1440px/390px及刷新后读取已有动态卡片，对照当前principal及原始活动消息，
验证作者owner→Hakase、摘要@owner→@Hakase、标题和顺序；正式未发送消息、改名或处理动态。
截图 `/tmp/rah-activity-names-formal-1440.png` 与 `/tmp/rah-activity-names-formal-390.png`
已检查。本项不宣称Raft在线双边像素验收。
