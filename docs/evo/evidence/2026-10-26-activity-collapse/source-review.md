# 动态独立折叠（2026-10-26）

锚点：已锁定的 Web 1.21.34 app-shell-BWgtfY02.js。原生产资源 URL/摘要与六个声明摘要见 `frontends/raft/upstream/published-2026-10-26/activity-collapse-manifest.json`；授权及 notices 沿用 adoption.json。本批是生产资源兼容移植，不是宣称取得最新完整 TypeScript 应用源码。

直接复用 SKe/h$/g$/CKe/_$/kKe 原函数正文；generator 校验摘要后绑定 React、raft-ui、Tooltip、翻译和本地偏好。新资源原文不可修改，生成输出不可手写。既有普通侧栏的原文仍保留为历史来源。

对照 D6/n2/MainLayout：动态列表拥有 activityListHidden，普通侧栏拥有 sidebarHidden；搜索 master/detail 没有相同折叠入口。Loom 用既有设备偏好 store 保存两种值，使用独立 storage key，不引入业务状态。拖动/Enter、快捷键、rail trigger 共享同一偏好；官方 _$ 在隐藏前将侧栏内部焦点还给展开按钮。

页面绑定改为官方 SidebarSlot + MainSlot 滑移容器。仅隐藏侧栏会保留空白占位，因此同时接入原生 main transition；预览测量正文 1003px -> 1383px（1440px viewport、57px rail、380px list）。手机禁用折叠，inline list 使用 flex/min-w-0/flex-1；390px实测列表宽度390px。加载、查询及内容状态不随折叠销毁。

保留限制：移动滑动手势尚未完成来源与行为审计；本批只验手机响应式显示，不等于真机滑动验收。动态行 swipeDone/Unfollow/Mute 文案不能证明页面导航滑动已对齐。
