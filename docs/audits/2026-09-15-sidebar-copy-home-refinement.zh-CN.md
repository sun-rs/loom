# 首页、文本复制与选择条细化

## 当前来源

本批读取 https://app.raft.build 当前发布身份
`cfde4ced360a16b8214a2a8b489f704ce7f2e1cb`（release/v1.14.0）。
JS `index-CRDaMXft.js` SHA256
`9247f38f78bfb5df423d4424882da63d18268324a9c9c151b52a49d772764271`；
CSS `index-DEkCg5nL.css` SHA256
`4afff5676159e07344522466189091097e8ca24f068d1c79c852f58db288251a`。
原始发布资源仅分析，不加入生产依赖。共享菜单和选择状态保留 RAH 既有 owner；
Multica 的原生选择 store 并无可替换的 Web 实现，参见前批菜单审计。

- JS 字符偏移 2130159：sGe/iGe 为 Lucide list-checks，五个 path 原样提取；
  3141356 的 select-mode-select-all 无论文字/紧凑模式均输出该图标。
  这更新了旧 index-WTraJnrd / index-MqTUR4Ez 的无图标文字态结论。
- CSS 19286、19589：active 声明 1px 阴影，但后面的 hover 规则覆盖为 4px。
  RAH 之前主动反转优先级造成按下阴影缩水。本次按用户明确要求，按下整体 XY=1px，
  阴影保留 4px；不是声称逐字照搬上游 translate 的 hover/active 顺序副作用。
- JS 1842234：消息大小 sm/md/lg 为 12/14/16px，默认 md；3122871 的共用
  data-message-selectable 正文从相同设置取值，Room/DM/Thread/Task 使用该消息组件。
  RAH 所有场景共用 msg-body 默认 14px、小 12px、大 16px；本次不修改正确字号。
- JS 2873557：Raft Web 条目仍是 py-2，md 或视口高度不超过 600px 才 py-1。

## 手机截图分析

用户两张截图均来自 iPhone 15 Pro Max。按设备逻辑宽 430px 对截图宽度归一化，
相邻条目中心距：Raft iOS App 约 34px，RAH PWA 约 42px；末条频道到私信标题约
38px / 43px。它们是截图估计，不是从原生 iOS 源码提取的 CSS 参数。

此前只将组净空 16→12px、条目外间距 4→2px，未改变窄屏行上下各 8px 内边距，
所以 RAH 仍为约 40px 行高 +2px 间距。此批只在聊天侧栏低于 768px 时将上下
内边距改为 4px，得到 32px 行高 +2px 间距；分组净空继续 12px。字号、头像与
标题操作按钮不变，桌面保持既有 Raft Web 参数。这是明确的移动密度取舍，点击区域
随行高度收紧，并非声称触摸区域完全不变。若无障碍大字号导致内容变高，仍让行自适应。

## 行为所有者

- MessageSelectionToolbar 使用内部 list-checks 符号，紧凑顺序继续由已有测量 hook
  管理；white 背景、2px 边框、hover 4px 阴影、按下保留阴影。
- App URL 同步：移动 Home 正在显示时，不写入隐藏的 activeRoomId、Thread、Task
  等目标参数。直接访问根地址、返回 Home 后刷新均回到列表；明确 Room/Task 深链接
  仍有效，不拦截通知目标或修改桌面默认会话。
- MessageTextDialog：浅黄 30% 底、2px 黑框、12px 内边距。普通非编辑 div 在 iOS
  不能保证可放置光标；改为只读用途的 contenteditable 区域，保持原 Markdown 展示，
  允许浏览器选择光标但拦截写入。aria-readonly、inputmode=none；不会主动聚焦正文，
  也不调用 selectAll。对话框关闭、焦点恢复继续使用现有协议。

## 验证

新增浏览器断言先复现全选无图标、按下阴影变 1px、Home 地址含隐藏 room、
移动行 padding 8px，以及复制页没有可放置光标的文本区。新增图标单测先失败，
再按精确源路径验证，不重置旧 sprite 摘要。

- `npm run check`、`npm run format:check`、`git diff --check`、
  `npm run build:web:workbench` 全部通过。
- 选择条、首页导航、侧栏几何、复制文本和菜单矩阵、任务审批专项通过。
  首页与菜单矩阵同时使用 Chromium / WebKit；触摸滚动及长按门禁通过。
  任务审批使用带 Fake 回复的隔离样本验证正文 14px，未向正式会话发送测试消息。
- 正式实例确认空闲、备份后优雅重启，冻结 Web build 为
  `a270d3a399d8011f0f2d8c4a8b5c1463b21e8cb437ca1a9d694e597c33626490`。
  备份目录：`~/.rah/backups/pre-restart-9cb95dcd-b042-4ac7-a904-648adb581699`。
  新浏览器在 1440×900 / 390×844 验证首页重载、分组默认值及几何、菜单、
  全选图标、局部文本选择、任务审批保持选择和图片预览；本机、LAN、Tailnet
  均返回同一新构建。没有进行真实 Provider 调用。
- 正式截图已检查：临时证据目录 `rah-sidebar-formal-2JEx3x` 的
  `390-expanded.png`、`rah-message-formal-sHluH4` 的 `390-text.png`；
  选择条紧凑截图来自 `rah-selection-refinement-AgV2zA`。

桌面 WebKit 不等于物理 iPhone，不能将键盘局部选取与合成触摸测试宣称为
iOS 系统光标拖动实机验收。本次为当前 Raft 源码对照、用户同设备截图分析及
RAH 浏览器验收，不声称完成同前提 Raft 实时双边浏览器验收。
