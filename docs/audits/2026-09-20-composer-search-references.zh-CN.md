# Composer 与搜索页 @ / # 引用

## 来源与边界

Raft 发布页面 `https://app.raft.build` 的分析归档
`/tmp/raft-20260916-audit/web-index.js`，SHA256
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
复用性质是结构移植及 RAH 数据接线，不是字节复制；发布 bundle 仅作分析证据，
没有引入产品依赖，沿用仓库已有来源与授权记录。

- `channel-autocomplete-popover`：左右 12px，向上间距 4px，高度上限 192px；
  行 padding 8px 12px、gap 8px、14px/20px，频道图标 20px／1px 边框。
- `Sn.index` 是键盘当前候选，普通粉色，归档 10% 黑色；普通悬停明黄色，
  归档悬停 5% 黑色。归档字体 45%，说明 30%，右侧徽标 9px、粗体、1px 边框。
- 搜索 `VF -> gxt/Wfe -> hxt -> DI` 从已有目录匹配，`#` 限频道，`@` 限人员，
  独立于消息搜索请求。搜索结果使用边框卡片及 32px 图标，不使用 composer 浮层。
  Raft 此版本目录预览截取 5 条；用户明确要求列出全部，此处不截取。

也核对 Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`apps/mobile/lib/use-mention-input.ts`、
`apps/mobile/components/issue/mention-suggestion-bar.tsx`：共享 caret/query
hook 与候选条，面向 RN 和 issue/member/squad，不符合本次频道样式，未移植其实现。

## 本地唯一 owner

- `useComposerMention`：既有 Room/DM/Thread/审批讨论 composer 共享入口，继续保留
  `@` 的成员范围与身份处理，不给非成员增加投递能力。附件评论复用此入口。
- `ComposerChannelContext`：由 App 已鉴权 Room 目录输入，包含归档；按工作区隔离，
  不另建网络请求或持久缓存。不扩展名称、模型或配置文本框。
- Protocol `visibleMessageText`：公开既有 Markdown 可见文本遮罩供 `#` 查询复用，
  不修改消息投递/提及绑定规则；代码、链接、URL 中不触发补全。
- `ChoiceRow` / ui-tokens：新增集中 `channel-autocomplete` 状态族，避免页面配色覆盖。
- 搜索目录只使用已鉴权实体和 Room 列表；以身份 ID 去重私聊/人员记录，保留同名不同人；
  显示名称不变，账号名仅作检索键。历史消息搜索仍走原接口，归档正文权限检查不变。

## 验证

新增 unit 先失败（缺失频道补全函数、缺失 sigil 目录筛选），后通过。
新增真实组件浏览器用例先失败（`#` 不出现列表），修复后通过：

- `test-channel-autocomplete-browser.mjs`：Chromium/Firefox × 1440/390，粉色当前、
  黄色 hover、归档灰色 hover、鼠标/方向键/Enter/Tab、Escape、焦点及 @ 回归。
- `test-search-prefix-browser.mjs`：隔离真实 Kernel 创建并归档频道，composer 引用；
  搜索页即时目录、归档卡片、延迟消息查询不阻塞、窄屏及打开归档。
- 既有 choice-row 与窄屏搜索回归通过；typecheck 通过。

正式部署和全仓检查结果见本页后续验证记录。

## 正式验证记录

已完成持久状态备份和安全重启，运行新构建
`5a7bf9a31e1d4006cb66ef8eb75577300996b7eb5b5ceb590a58463f7995c49a`。
正式浏览器 1440px／390px 验证 composer @/#、焦点恢复、搜索 @/# 结果区，
两种宽度均显示全部 5 个可见频道（其中 1 个归档），没有发送消息或调用真实 CLI。
未进行本次同条件在线 Raft 双边验收；Raft 依据上述发布源码。

相关单元、Chromium/Firefox 候选组件、隔离真实业务浏览器、既有 choice-row／窄屏搜索、
类型检查与正式构建通过。`git diff --check` 通过。全仓 `check` 仍停于既有
`/v1/worker/message-present` 未登记项；`format:check` 仍有此前 5 个其他文件问题，
本次改动文件的格式检查通过。
