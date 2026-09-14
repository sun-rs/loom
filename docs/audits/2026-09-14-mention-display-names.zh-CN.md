# 聊天提及动态显示名称

## 问题与来源

账户改名后，HumanIdentity 悬浮资料卡已经读取新的显示名称，MessageReferenceToken 却继续
渲染 token.value（例如 `@owner`）。正文与资料卡因此出现不同名称。

Raft 授权源 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`：
Cde（pretty 144263–144284）将底层 name 映射到 id 和 displayName；
提及渲染器 U（144423–144432）按 type/id 获取当前实体，显示
`@${displayName}`，缺失时退回底层名字。Agent 和 Human 使用同一规则。

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/editor/extensions/mention-view.tsx` 非issue/project分支使用持久 label/id，
不提供本次按当前资料动态刷新的优势，未复制其代码。

## 本地实现

正文提及通过原有解析器识别身份；在已有授权 references 候选中找到对象后，以
WorkspaceEntities 的当前实体解析显示名称。Human 与 Agent 共用该显示规则，
无显示名称时退回 handle。样式、已读点、悬浮资料、点击资料入口保持原有组件。
这是源行为的结构移植，React 上下文接线是 RAH 自有实现。

单一所有者仍为 WorkspaceEntities：账户保存、资料观察和目录刷新由现有身份同步流程处理。
没有新增请求、轮询或名称缓存，也不会将全工作区不可见实体扩充到消息候选集。
消息原文、持久引用、身份ID、用户名和通知目标均不改写；代码块/行内代码与未解析文本不替换。
因此旧消息仍可保留 `@owner` 原文，但其可交互标签展示当前显示名称。

## 验证

先用隔离浏览器通过设置/账户将测试Human改名，复现标签仍显示 `@sun`、
aria-label已经显示Hakase的失败。实现后验证两次改名、旧频道消息、旧私聊消息、
资料悬浮卡、行内代码不改写、未知提及不改写、原消息持久化不变和刷新恢复。
所有修改资料/发送消息仅在临时Kernel与Fake Provider内进行。
Chrome、Firefox专项通过；`npm run check`、`npm run format:check`、
`git diff --check` 与正式 Web 构建均通过。

正式服务完成空闲检查、备份和优雅重启。备份
`/Users/sun/.rah/backups/pre-restart-1a4509b1-ecd9-4647-84e0-830cba2f9b52`；
冻结构建 `6d2d8146bf559dea58ab83b8ca4db19d09e50e6490ddbe8bc8d6ed26929e8ee9`。
新建真实浏览器页面从历史消息定位到消息列，原来的owner提及显示为Hakase；
悬浮资料显示Hakase与用于识别身份的@owner。刷新和LAN/Tailnet构建一致性验证通过。
截图 `/tmp/rah-mention-name-formal.png` 已目视核查。
正式验证只读，未改动真实用户资料或发送消息；本轮未执行线上Raft双边截图验收。
