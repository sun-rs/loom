# 列表交互补齐（2026-10-26）

锚点为已取得的 Raft Web 1.21.34 app-shell-BWgtfY02.js，URL、完整摘要和 LF/n2 相关资源来源见 `frontends/raft/upstream/published-2026-10-26/manifest.json`。采用授权及 notices 沿用 adoption.json。本批没有重新声称官网实时最新版本。

此前列表只接了官方宽度计算，DiscoveryPage/MemoryPage 的分隔线仍然使用旧 PanelResizeHandle/useResizablePanel。现在动态、搜索、记忆直接调用已锁定的官方 LF 原生处理器与 NF 宽度存储：键盘调宽、双击重置、pointer cancel、blur 清理均由同一原生实现负责。

Loom 外层只提供列身份、已有偏好的迁移以及页面限制：动态和搜索沿用共享列表宽度；记忆使用 memoryList 注册别名保留独立宽度。原始官方资源没有修改。useCurrentListPanel 保留已有页面测量和官方宽度公式；动态选中详情时将 50% 限制同时传给处理器，避免显示宽度与拖动上限不一致。

本次进一步核对 D6、n2、SKe/h$/g$/CKe/_$：只有桌面动态使用 activityListHidden 独立折叠；搜索 master/detail 不提供同样的可折叠侧栏入口。不能把“搜索也缺折叠”当作官方对齐要求。动态独立折叠仍需将当前 main slot 转接官方 sidebar slot 并接入独立偏好、焦点恢复和 rail trigger，尚未完成。没有通过 display:none 临时补丁掩盖结构差异。

移动 swipe 仍待进一步区分列表项操作与页面返回；当前检索到的 thread.row.swipeDone/Unfollow/Mute 是消息列行操作文案，不能据此宣称页面已有/应有统一滑动导航。

验证范围：本批列表接线及既有原生处理器回归，类型、产品构建，正式桌面键盘调宽/重置与手机视口。不是全站官方一致性证明，不涉及模型调用或后端业务能力。
