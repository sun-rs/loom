# 新版顶栏与搜索浮层

## 授权与源码边界

负责人 2026-10-16 明确允许非商用代码复用并要求开始。公开镜像仍为 `a98ae003246a0360872a77d76dec2fccd0347ef7`／1.21.12；未取得新版原始 TSX。此次新增壳来自官方 1.21.16 生产文件 `app-shell-L7litFx-.js` 的结构移植，**不是原始源码逐字复制**。版本、URL、SHA256 与实际采用的代码片段见 [发布代码证据](../evo/evidence/2026-10-16-native-topbar/upstream.json)。原仓库许可证／声明保持不变，下载生产资源不代表获得新的开源许可。

## 组件映射

- 生产 `C_t`／`S_t`／`y_t`／`b_t` → `TopBar.tsx`：原 48px 高度、主题 class、搜索宽度 clamp、左右留白、工作区名称截断及搜索锚点。Raft 账户／工作区来源替换为 Loom workspace；单工作区切换禁用，不制造可操作但无功能的菜单。未移植多工作区快捷项、账户及帮助入口。
- 生产 MainLayout 的根 flex-col＋内容行与 LeftRail topBar 分支 → ChannelApp／Navigation：桌面顶部入口取代 rail 工作区图标及搜索按钮；手机维持原入口。频道标题继续使用 raft-ui 原生主题 recipe（Brutal 62、Elegant 56），不自行缩短或重绘。
- 快照 `SearchOverlay.tsx` **直接复用且原文件不变**：Modal 透明遮罩、PopoverPopup、锚点定位、Escape／IME、防冒泡与底栏；Vite 仅将其 `MessageSearchPage` 数据内容替换为 Loom DiscoveryPage。此处不声称取得／完整移植了新版浮层的所有新增能力。
- 快照 MessageSearchPage 的 overlayChrome 输入栏／全结果操作 JSX → SearchHeader／OverlayAllResults。原 UI 组件、class 和文案键；现有搜索、筛选、消息卡片数据仍来自 Loom API。输入变化与筛选保留 background location；完整结果页显式清除它。
- 背景路由沿用官方 React Router `<Routes location>` 方式；当前聊天与草稿保持挂载，真实 URL 是搜索。Escape／外部点击回原查询并归还焦点；直接搜索 URL 与窄屏采用完整页。查询变化不让背景页面偷偷切换。
- 键盘顺序由本地 useSearchRail 适配官方搜索结果身份及上下键／Enter 规则；默认 Enter 打开全结果，向下选消息后 Enter 直接跳到消息正文。已有认证 message.context 和频道目录校验保持，异步打开会丢弃过期响应，不新增后端 handler。

## 验证与未覆盖

先新增浏览器不变量，确认旧构建缺少顶栏的预期失败。针对1440×1000、390×844、DPR1检查顶栏／导航、浮层、草稿、全结果与刷新、快捷键、关闭、键盘定位、筛选 Escape、IME 和缩窄切换；检查来源、前端类型与构建。部署证据另见当前状态。未执行全仓或付费 CLI。

保留的失败：第一版缺少官方根 flex-col 使聊天宽度被挤压，已修正；测试最初误用 contenteditable 定位 textarea，已修正；点击全结果后等待 React 解除浮层，而非同步统计旧 DOM。筛选 Escape 曾同时关闭外层浮层，按原生 defaultPrevented 契约在本地筛选组合层消费事件并关闭内层后复验通过。不是对失败放宽产品要求。

仍不包含：搜索实体候选／最近访问／新版可拖动浮层、多工作区切换、顶栏账户菜单。完整结果的加载更多改动仍在先前 review 中，本批没有恢复；本批仅接入浮层需要的键盘选择。无需 npm 升级：当前版本已包含本批使用的主题和容器组件。
