# 移动端 iOS 风格根导航

## 用户决策与来源

2026-09-14 用户经过实际使用，撤回此前左上角固定入口加左侧抽屉方案，明确要求首页／任务／成员／设置四项底栏，参考提供的 Raft iOS App 截图。该决策替代[移动端主导航抽屉](2026-09-14-mobile-navigation-drawer.zh-CN.md)，不是恢复此前 Raft 网页常驻方形底栏。

截图为当前授权视觉证据：`codex-clipboard-282032ae-b99c-431d-97b4-1e4d9ac534fc.jpg`（首页和铃铛）、`codex-clipboard-0aa9dc74-4e66-4488-84fb-cd0bf1d8e2ed.jpg`（任务）、`codex-clipboard-c22b37e3-4c79-4e47-a6c0-03245323811b.jpg`（成员）、`codex-clipboard-db42fa85-5747-4cfc-8655-0a77af62fda0.jpg`（设置）、`codex-clipboard-4c1053ee-9397-465c-ad8a-ba298556e790.jpg`（聊天详情）。未获得 Raft iOS App 的可复用原生源码；圆角、透明度、模糊和尺寸为按截图实现的 RAH CSS 规格，不标为原生参数提取或像素级双边验收。

沿用前述审计已核对的 Raft Web 767px 分界、图标、共享通知 Popover 和既有页面行为。Raft bundle `index-MqTUR4Ez.js` 的 SHA-256 为 `9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`，授权只读证据位于 `Code/reviews/rah_os/2026-09-13-dialog-audit/`。Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的 Sheet 模态方案适用于已撤回的抽屉，不能提供用户此轮要求的根标签栏效果，因此不再保留其抽屉组合。没有新增上游源码拷贝或运行依赖。

## Owner 与行为

- `WorkspaceNavigation`（`workspace-navigation-shell.tsx`）复用 App 原有目的地动作。桌面渲染 Rail；移动端只有根页面展示四项底栏。没有新的业务导航状态、Room 副本或客户端任务计数。
- 删除 `workspace-navigation-drawer.tsx`、对应 CSS、未再使用的 `OverlayDialog` wrapper、移动版 Rail 分支和抽屉专用通知定位参数。历史审计保留，不保留可运行的旧抽屉路径。
- 移动端初次直接打开无 Room 参数的首页显示聊天列表；显式聊天链接仍进入对应聊天。首页顶端恢复搜索与动态，右上铃铛使用已有通知触发器和小型 Popover；外部点击/Escape/焦点与真实通知数据继续使用原 owner。
- 底栏为半透明白色圆角浮层、灰色当前项，图标来自维护的 UI 库；保留底部安全区，根页面可滚动内容预留末尾空间。详情不占用底栏空间。进入聊天、消息列、人员详情、设置子页和计算机详情后隐藏根导航，原有返回按钮逐层返回。计算机入口保留在设置中。
- 移动任务页的看板/列表切换移到标题行，桌面仍在原工具栏；频道/创建者/负责人和清除筛选共用第二行，清除按钮靠右。频道任务计数取既有 `task.global.list.total`，修复小屏全局隐藏 `.channel-sub` 导致的不可见。
- 搜索主输入和筛选菜单搜索框移动字号至少 16px，聚焦使用 `preventScroll`；viewport 保持可缩放，并增加 `viewport-fit=cover` 处理安全区。此修复针对 iOS 小字号聚焦缩放诱因，不使用 `user-scalable=no` 或 `maximum-scale=1` 禁止用户放大。
- 保留[长按菜单防滚动及移动返回无粉色帧](2026-09-14-mobile-home-context-menu-stability.zh-CN.md)修复。

## 验证方法

新增 `npm run test:web:mobile-navigation`，先在旧抽屉实现上因不存在移动底栏而失败，再实现。覆盖四目的地、首页入口与通知定位、16px 输入字号和 viewport scale、任务标题/筛选行边界、Room/私聊返回、成员与设置/计算机详情返回、桌面 Rail 恢复。删除旧抽屉测试，更新既有移动布局、Room/DM 双页及业务浏览器门禁中的旧导航期望。

浏览器使用临时 Kernel/daemon 状态和明确 Fake Provider 测试内容；截图不能当作正式工作台。Chromium 触摸输入与桌面 WebKit 不等于实体 iPhone 安装态 PWA；原生 iOS 焦点缩放与安全区仍需设备复验。没有运行付费 Provider。

系统通知链接的补充路径：移动端在无铃铛点击的情况下打开 Human Inbox 时，App 保留原目标上下文并展示首页，让浮窗使用实际铃铛触发器定位；不恢复抽屉专用 fallback anchor。带 `inputRequest` 的设置深链接已纳入双浏览器测试。

## 自动化与隔离浏览器结果

- `npm run check`、类型检查、Web 单元测试、格式与 diff 检查通过；正式 Web 构建通过（保留既有 chunk 体积提示）。
- sidebar-row、sq-btn 组件规格浏览器门禁通过，catalog 已刷新。
- Chromium / WebKit 四项底栏、通知入口/深链接、任务筛选与计数、移动输入字号、成员/设置/计算机返回测试通过。
- Chromium / WebKit 移动主要页面及任务容器自适应通过；Room/DM 双页、消息列、Agent/Human、Task 覆盖层、草稿和重载回归通过。
- Chromium 原生触摸的长按后移动/第二次滑动、关闭、普通列表滚动回归通过；Room/DM 返回列表逐帧无粉色、桌面选中态恢复通过。
- 已检查隔离截图：`rah-mobile-tabs-uAXmrQ`、`rah-mobile-tabs-YBx27A` 及对应 WebKit 目录；实际临时路径由各门禁输出记录。截图中的 Fake Provider 内容不是用户数据或正式部署。

## 正式工作台验收

完成空闲检查和持久状态备份后，通过正式重启脚本正常停止旧实例，再以冻结构建 `1417fd63e087c4d02b0b280eb990d6e86045e4132256695b1f05130153c224fb` 启动。备份为 `/Users/sun/.rah/backups/pre-restart-30df66cd-e60b-4bee-9f92-369644df4d5a`，交付时核对进程为 `86227`。保留 Room 历史、Agent 配置与私有记忆。

在 `http://127.0.0.1:4173/` 新页面核验冻结构建并通过真实数据浏览器检查：390×844 首页、通知定位、任务计数和筛选、成员、设置、计算机逐层返回、Solars 聊天和已有私聊，以及桌面 Rail。没有发送消息或调用付费模型。检查了首页、任务、通知、成员、设置、聊天截图：四项浮动底栏与灰色当前项可见，聊天底栏隐藏，任务标题显示“6 个频道任务”。证据目录为 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-mobile-tabs-formal-qv4IC2`。本项为正式本机浏览器验收，仍不代表实体 iPhone 安装态或 Raft 原生 App 同条件双边验收。
