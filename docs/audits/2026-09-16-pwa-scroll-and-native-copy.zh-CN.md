# PWA 滚动边界、历史补偿与原生文本选择

## 来源与所有者

继续使用[上一批当前 Raft 发布证据](2026-09-15-sidebar-copy-home-refinement.zh-CN.md)：
release/v1.14.0，`cfde4ced360a16b8214a2a8b489f704ce7f2e1cb`，
JS SHA256 `9247f38f78bfb5df423d4424882da63d18268324a9c9c151b52a49d772764271`。
发布 JS 中的 `h-dvh overflow-hidden`（字符偏移 2110856）和嵌套
`min-h-0 flex-1 overflow-y-auto overscroll-contain`（2829015）是布局参考，
不是声称 Raft 原生 iOS 和网页实现完全相同。Multica 原生 renderer 不作为 Web
滚动替代 owner，保留已有 RAH/TanStack 实现。

- MessageTimeline 保留 `@tanstack/react-virtual` 3.14.10 /
  `@tanstack/virtual-core` 3.17.8（MIT）的虚拟窗口、测量和 iOS 惯性滚动补偿。
  不引入新历史缓存，不修改依赖。
- `mobile-navigation.css` 是移动 viewport / safe-area 的单一呈现 owner。
  Room/DM/Thread 与业务加载、可见已读、composer 草稿 owner 不变。
- MessageTextDialog 拥有复制专页的原生选择边界；普通消息的长按菜单不变。

平台依据：[WebKit iPhone 安全区](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)、
[Apple standalone/status bar 配置](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)、
[Safari 16 overscroll](https://webkit.org/blog/13152/webkit-features-in-safari-16-0/)。
现有 viewport-fit=cover / black-translucent meta 已具备；本批修复根画布颜色和滚动边界，
不禁用页面缩放，不依赖全局 touchmove preventDefault。

## 根因与修复

1. prepend 的 layout effect 随渲染重建 1200ms deadline，用户滚动不取消补偿。
   此外，补偿内部的 scrollToIndex 会创建仍在跟踪行位置的导航目标，手指松开后
   仍可能再次校正。deadline 现在属于一次 pending anchor；滚轮、触摸移动与
   滚动键释放补偿；恢复使用有界 offset 命令，避免遗留 index 导航目标。
2. React portal 的事件沿 React 树而非 DOM 父链传播。复制页从原消息渲染，长按
   和 contextmenu 仍到达原消息 handlers。复制页现 stopPropagation 隔离这些事件，
   不 preventDefault 原生选择和原生上下文菜单。浅黄黑框正文、只读编辑区和原字体保留。
3. 只有内部 `.app` 隐藏 overflow，document 本身仍可被 iOS 拖动。移动产品页面
   现在固定根 viewport，document 禁止 overscroll；内部消息、列表、设置内容保留
   overflow 滚动并阻止滚动链传给文档。标题栏、导航、composer 不参与整页位移。
4. 标题栏黄而 html/body 根画布仍白。用同一个 mobile canvas 变量绘制 root/body/app：
   Home/Task/Members/Settings 根页为黄色，聊天及子页为白色。安全区仍由 env 值留位，
   不硬编码 iPhone 高度。没有新增浏览器整页下拉刷新，列表继续由既有同步 owner 更新。

## 验证记录

先复现桌面历史加载后滚轮被拉回、旧正式版本复制页拦截原生 contextmenu，及移动
html 仍为 static。原生触摸补测进一步捕获 index 导航目标残留，不能仅依据第一次
桌面滚轮通过宣布修复。测试比较消息的实际可见位置，避免将虚拟行测量造成的
scrollTop 补偿误判成用户滚动距离。

长历史门禁中的旧 Markdown 夹具仍断言账户 handle `@Alice`，与已采纳的显示名称
策略不符，已校正为夹具明确声明的 `@Alice Assistant`；未修改产品引用解析行为。

最终验收：

- `npm run check`、`npm run format:check`、`git diff --check` 和
  `npm run build:web:workbench` 全部通过。
- 长历史门禁通过桌面 10,000 条消息的有界渲染、加载更早消息后的锚点恢复与双向
  滚轮操作，以及 390x844 下 Room、DM、Thread 的原生触摸滚动。
- 移动消息菜单门禁在 Chromium 和 WebKit 通过：复制页不再传播长按到消息菜单，
  原生 contextmenu 未被取消，部分文本选择可用，正文内部滚动且关闭按钮固定。
- `test-mobile-viewport-browser.mjs` 通过 390x844、顶部 59px / 底部 34px
  模拟安全区下四个根页与聊天页的触摸验证；标题、导航和 composer 坐标保持不变。
  任务列表/看板的卡片触摸滚动门禁也通过。
- 正式实例在空闲检查、持久状态备份后优雅重启，使用冻结构建
  `735107e4e3afc6c2927856220b0ddf80461beb0f1a2df38982e6a522361b1ca5`。
  备份位于 `~/.rah/backups/pre-restart-a63bdce1-81b5-4dbd-94c3-06b4f74cba36`。
  localhost、LAN 和 tailnet 地址均返回该构建；未运行付费 provider。
- 新开的正式浏览器页面通过 1440x900 / 390x844 验证及重新加载检查。
  旧正式版本复制页阻止原生菜单的复现，在新构建上通过。
  截图目录：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-scroll-formal-di0Vlk`；
  已检查首页、任务、成员、设置与复制页截图，首页黄色覆盖模拟顶部安全区。

模拟安全区及桌面 WebKit 不等同于物理 iPhone 状态栏、惯性回弹和原生选区手柄
实机验收，不声称 Raft 实时双边验收。本批未提交或推送。
