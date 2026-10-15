# 设置分类导航对齐

Owner 要求设置页恢复与聊天页一致的左侧分类列表／右侧内容结构，未接入分类可保留空态。本批纠正上一批只接单面板、遗漏分类导航的范围选择，不新增后端设置能力。

来源：[Raft 官方源码](https://github.com/botiverse/raft-source/tree/a98ae003246a0360872a77d76dec2fccd0347ef7)，版本 `a98ae003246a0360872a77d76dec2fccd0347ef7`，FSL-1.1-ALv2；沿用 Owner 授权与原 notices，冻结的原始源码不变。

- `layout/Sidebar.tsx` 的 settings rail／`settings/SettingsSidebarList.tsx`：直接复用分类行组件、个人／工作空间／资源分组、图标尺寸、hover／选中配方；外壳复用已有 Sidebar.tsx 结构移植 `ChatSidebarFrame`。
- `layout/MainLayout.tsx`、`settings/SettingsPanel.tsx`：桌面列表＋内容，手机设置根页只显示列表、不选中项目；进入子页隐藏底部导航，原生 PanelHeader 返回列表。URL 保存分类，刷新和浏览器历史可恢复。
- 原生 `SIDEBAR_PANEL_BOUNDS`、`useResizablePanel`、`PanelResizeHandle` 负责分隔线拖动，默认 240、范围 180–320，不另造宽度／边框所有者。
- `server` 分类改名为“运行设置”，承接已完成的本机并发与生效配置；桌面根页与原版一致默认选择账户空态。账户／语言与区域／外观／通知／管理／关于／更新日志只提供空态，不展示假保存操作，也不连接 Raft 账户服务。
- 不恢复已明确排除的第三方 MCP 管理、中央计费与账户配置等功能。不是全量移植 Raft 设置业务。

运行表单抽取到 `RuntimeSettings.tsx`；分类切换保留组件和草稿，仅在可见时读取。`WriteIntentSlot`、修订冲突、未知结果放弃核实后重读、路由所有者保护保持原语义；子页返回和浏览器后退不能丢弃未决保存。

先用双尺寸浏览器测试复现缺少分类列表，再实现。临时真实 Core 验证分类／空态、鼠标拖动 240→280、键盘选择、手机列表与详情切换、刷新／后退、草稿保留；此前设置保存／冲突／响应丢失和频道急停回归继续执行。正式服务只读页面和 API 对账，不修改实际运行配置。完整检查和部署结果见[证据](../evo/evidence/2026-10-15-settings-navigation/summary.json)。
