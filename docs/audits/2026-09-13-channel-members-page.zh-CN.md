# 频道成员管理页对齐

## 来源与范围

Raft 官方 `https://app.raft.build/` 2026-09-08 冻结证据：
`docs/evidence/raft-web-20260908-current/index-BVfbaScj.js`，SHA-256
`65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`。
`Hot` 成员页使用顶部搜索、独立滚动列表和底部 `shrink-0 border-t-2 p-3` 添加栏；
`Eg` 成员行使用 8px/12px 内边距、8px 间距、28px members-row 头像；
`Vnt` 对普通 member 返回 null，管理角色显示 channelAdmin；`WT` 与 `SD` 在桌面
hover/focus-within 显示尾部动作，小屏始终可用；`Oot` 先显示移除确认再调用 mutation。

对应 `index-D8Neh8lc.css`（SHA-256
`11f78ea36cb9e35639a08232b61a4523355c5242717b4abe48ec5ff0fc230f25`）的
input-brutal 固定 2px 边框、静态 2px 阴影、focus 4px 阴影且 outline:none，
不是叠加全局 focus-visible 描边。搜索图标 14px。

本次为参数与结构移植、RAH glue，发布 bundle 仅作证据。没有官方后端源可证明逐字复用。
检查 Multica `11861145abc59a0d39c8c8f24ad837d4584e664f`
`packages/views/settings/components/members-tab.tsx`，它管理 Workspace 角色，
不作为此频道列表的布局或权限替代来源。

## 根因与实现

搜索自动聚焦叠加全局描边；成员行与分组垂直内边距过大；添加按钮随内容流；
原始 owner/member 标签直接呈现；移除文字常驻且无确认。
修复由 room-member-pages 展示 owner 负责：共享 Icon、真实 Human 头像、紧凑行，
独立列表/底栏、普通成员无徽标、owner/admin 用“频道管理员”展示。
内部角色值与权限不变，不将 Agent 提升为管理员，不恢复延期的多人权限项目。

移除确认由 RoomMembersDialog 的现有变更锁和 pending/error 状态负责；
成功关闭确认，失败保留并允许重试。继续调用既有 onRemove、最新 Room 序号和权限检查，
不创建另一条后端变更通道。`#all` 的前后端固定成员保护保持，添加与移除入口仍隐藏。
桌面行聚焦后动作可见，触屏小屏动作常显；取消确认恢复焦点。

## 验证

新增 `scripts/test-room-member-layout-browser.mjs`：旧实现先复现搜索 outline:solid；
确认缺少移除对话框；Human 头像在 flex 规则下变成 220px 的回归也先失败后修复。
浏览器验证搜索固定 2px 边框、底栏位置、仅管理员标签、28px 头像、悬停/焦点动作、
搜索过滤和 390×844 无横向溢出。真实隔离 Host 中验证确认取消，以及第一次失败、重试成功。
现有 `test-all-channel-members-browser.mjs` 验证所有 Agent 自动加入且无添加/移除，刷新后保持。
源码对照不是在线同条件 Raft 双边验收，未运行付费 CLI。

## 正式交付

完整 check、format:check、diff 检查、正式 Web 构建均通过。
构建 `03b4e76afd26af554a449ea43016a17bec112b70f7bfc71a5b39d036c0b4986b`
经空闲守卫、备份 `pre-restart-0d2d961b-beb1-4040-a51a-68b5d1d8aa92` 后优雅重启。
本机、物理局域网、Tailnet 三个新 Chromium 页面均在原 Council 频道检查
搜索聚焦、底栏位置、普通角色标签缺席、桌面移除悬停、确认取消和390×844布局。
正式截图已检查，未执行真实成员移除；Agent/对话/私有状态保留。未提交 Git。
