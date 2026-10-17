# 移动端大页导航与中文范围收口

## 官方来源与边界

来源 https://github.com/botiverse/raft-source ，修订 `a98ae003246a0360872a77d76dec2fccd0347ef7`，FSL-1.1-ALv2；保留原始 notices，owner 已授权复用。核对已取得的完整源码，不声称对线上最新发布进行了重新抓取。

- `MainLayout.tsx`：`useMobileTabBarVisible`、`MobileTabBar` 与根布局组合。底栏只在一级大页显示；频道、私聊、搜索、动态、已保存及设置详情隐藏，左上角返回首页后切页。顶部搜索栏用于桌面。
- `MobileBottomBarStack.tsx`：直接导入原件。brutal 使用流内底栏；elegant 使用底部浮动容器。`raft-ui@0.5.64` 保持原生尺寸、safe-area、选中与短屏规则。
- `Sidebar.tsx`：移动首页搜索／动态入口结构移植，保留官方搜索行类名；本地回调接现有路由。动态不伪造未读数，双击定位首条未读未在此批移植。
- `index.css` 的 `#root` 与 `utils/visualViewport.ts`：直接使用原版视口追踪，删除 Loom 自加的 `h-dvh min-h-screen` 外壳限制，改为官方可收缩 flex 组合。
- `LocaleProvider.tsx`：构建期守卫替换初始 locale 为 `zh-cn`，保留原 provider 与官方中文文案；不改官方文件。owner 只需要中文，移除无须提供的语言切换分类。

## 复现与实现

在 390x844 中模拟官方 `--vv-height:560px`，原外壳保持 844px，底栏越过根可视区，回归测试先失败。英文浏览器与 `lang=en` 原先会启动英文，独立先失败。修复后均通过。手机真实浏览器具体复现仍需真机复核，不能把模拟键盘当作 iOS 实机结果。

单一所有者：官方 viewport 管根尺寸，官方底栏组件管表现，ChannelApp 现有 URL 路由管切页；没有新增业务状态或后端逻辑。搜索／动态由移动首页进入；官方四个大页入口之外保留已批准的 Loom 记忆入口。切换大页清除旧详情参数，保留频道选择与现有草稿状态。未扩展后台通知能力。

## 验证

- 定向浏览器：390x844 brutal/elegant-light、1440x1000 brutal，DPR1。检查真实触屏点击、44px 宽命中区域、频道与设置详情返回、搜索／动态返回、五个大页切换、键盘视口事件、英文浏览器下固定中文。
- `npm run typecheck:loom --prefix frontends/raft`、`npm run build:web:workbench`；修改文件格式、`git diff --check`。
- 2264 个官方源码摘要保持不变。没有全后端测试、完整前端套件、模型或付费测试。
- 用临时真实 Kernel/ApplicationService/Gateway，不向用户频道写入测试消息。正式部署与只读页面结果见[证据](../evo/evidence/2026-10-17-mobile-navigation/summary.json)。

通知设置、Loom 更新日志、动态刷新滚动恢复继续保留为后续项目；本批优先修复用户发现的移动入口问题。未验收真实 iOS Safari、PWA 与全部角色详情路径。
