# 搜索候选菜单与最近访问

本批继续以官方 v1.21.16 发布文件为锚点，原始 TSX 来自冻结的 `a98ae003246a0360872a77d76dec2fccd0347ef7`。授权、URL、hash 沿用[发布代码证据](../evo/evidence/2026-10-16-native-topbar/upstream.json)，保留原许可证和非商用授权边界。发布 JS 的 `search.channelMenuAria`／`search.overlay.recentConversations` 对应组合与快照一致；官方原文件不修改。

## 官方行为与接线

- 搜索频道候选右键菜单只有“打开”。`MessageSearchPage` 的 handleChannelResultContextMenu → placeContextMenu(192×40) → DismissBackdrop／ContextMenuPopup／MenuItem 结构移植到 `SearchEntityRow`，直接复用这些组件、原生图标、class 和文案。没有把聊天侧栏的置顶、移动、归档菜单塞进搜索。归档频道和实例候选仍不显示该频道菜单，符合原生触发条件。Escape只关闭菜单；关闭后焦点回候选，打开走已有搜索直达路由。
- 空查询浮层的 `search-overlay-recent`／SectionEyebrow／Clock3／SearchResultsList 组合按官方 JSX 移植。继续使用原生 EntityResultRow，选中首条的 Return 提示和统一键盘序列保持。
- 直接复用 `recentConversationStore.ts`：每个 workspace＋Human scope 的访问 ID 最近优先、去重、最多20个，scope最多32个；storage拒绝或容量不足不阻断导航。只保存对话 ID 与访问时间，不保存消息、运行数据或权限真相。
- `useRecordSearchVisit` 只从已解析且可访问的显式 Room 路由记录访问；搜索预览、频道和私聊仍是同一个Room ID。Root持有记录入口，不给各页面另造历史队列。官方 `selectRecentConversationEntities` 用当前认证目录重新解析 ID，排除当前对话、归档、失效／不可访问条目；Loom sidebar 的 `peer:instanceId` 隐藏偏好映射为原生 eligibleEntityKeys。
- 选择候选仍由原 `useSearchDestination` 导航或原 WriteIntentSlot 打开私聊，没有新增后端能力、定时器或消息操作。

## 有意保留的限制

“最近访问”采用官方 `fillFromActivity:false` 路径，只展示真实访问。未补“按消息活跃度填尾部”；没有访问记录时保留既有简化空态／全结果入口。完整搜索页的搜索词历史、常用频率以及顶栏独立历史菜单不在本批。用户浏览器清除存储后访问记录消失；它不是跨设备的服务端业务数据。

## 验证

先确认浏览器缺少右键菜单失败，筛选辅助测试因缺少实现失败，再接入。另保留一次错误组件导入导致的类型／构建失败（已修正为原生SectionEyebrow的真实路径），以及浏览器测试误用button角色而非原生menuitem的失败；未改变组件角色来迎合测试。

1440×1000／390×844验证菜单只有原生“打开”并直达；桌面验证访问A后进入B、刷新、空查询显示A而排除B、Escape关菜单保留浮层、Enter返回A。筛选测试验证隐藏私聊、归档、失效ID和访问顺序，不捏造未访问候选。复验顶栏与实体搜索专项，类型、构建、来源适配检查、格式与diff；不跑全仓或付费CLI。部署和真实页面边界见[证据](../evo/evidence/2026-10-16-search-recents/summary.json)。
