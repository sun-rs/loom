# 消息收藏接线

官方来源：<https://github.com/botiverse/raft-source>，`a98ae003246a0360872a77d76dec2fccd0347ef7`，FSL-1.1-ALv2，仓库保留原许可；owner 已另行授权非商用复用。使用 raft-ui 0.5.64。

- `packages/web/src/components/saved/SavedPanel.tsx`：结构移植到 `loom/SavedPanel.tsx`，保留卡片、间距、字体、背景、骨架、空态、键盘打开、取消按钮阻止冒泡，以及240px滚动预取。替换官方业务 store 为 Loom SDK 有界分页读取；不是字节一致复制。
- `components/layout/Sidebar.tsx`：直接复用 `sidebarItemClass`、`SavedNavCount`；沿用顶部收藏行，数量来自后台 `globalTotal`，不是已加载条数。
- `components/message/MessageItem.tsx`、`MessageHoverToolbar.tsx`：构建时受检替换，将原生收藏按钮、状态指示和右键／长按菜单绑定现有 `message.social`、`message.save`。官方原文件摘要不变。
- `message.saved` 管理列表，`message.context` 解析跳转。频道／消息列仍由既有正文及高亮处理，不创建新消息视图。`saved=1` 仅是本地路由组合；手机返回恢复聊天列表。
- 收藏是 Human 私有元数据，不启动模型。写入使用共享 WriteIntentSlot，明确 saved=true/false，丢响应只允许同键同载荷核实；不乐观修改计数。已保存页取消有独立路由生命周期 slot，但不复制后台收藏状态。

有意省略未对接的复制链接／Markdown菜单；不引入对外分享。系统通知暂不提供收藏入口。头像未提供时沿用原生默认头像。物理手机、跨标签同步以及独立私聊收藏不作为本批专项验收声明。

验证范围：收藏相关源码测试、前端类型／构建、桌面1440×1000和触屏390×844（DPR1）隔离Core业务链路，以及重启后正式页面只读检查。无付费CLI，无全后端或完整浏览器套件。结果见 [证据](../evo/evidence/2026-10-16-saved/summary.json)。
