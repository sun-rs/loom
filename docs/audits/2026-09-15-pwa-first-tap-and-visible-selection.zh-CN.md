# PWA 首次点击与列表可见选中态（2026-09-15）

## 所有者与来源

沿用 App 导航、SettingsSurface、AgentDirectoryPane、ComputerRuntimePane 的单一导航状态，
`useMobileLayout` 提供同步视口判断；不新增业务选择、任务或回复路径。
消息触摸呈现由共用 MessageItem / useMessageActions 负责，长按仍由 useMessageContextMenu 负责。

Raft 授权来源 `https://app.raft.build`，vendor build
`666bab60d8658d9e382e2c286ce1e423231e8f31` 的 `index-WTraJnrd.js`，
`mu` message slots 使用 group/message 的 hover/focus 操作条，正常子控件自行处理点击。
本批是 RAH 触屏适配修复，不声称复制其 iOS 实现：不在合成 click 之前改变祖先操作条的可见状态。
Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/modals/create-issue-dialog.tsx` 沿用独立 Dialog；未提供适合取代本地列表/详情所有者的移动选择机制。
仅比较来源，未分发上游 bundle；沿用现有授权与来源台账。

## 行为与意图差异

- PWA 频道任务入口为「＋新建任务」；桌面仍为「＋新建」。390px 下两项筛选激活后仍保持单行。
- 共用 task-filter-trigger 禁用浏览器默认 tap highlight；实际筛选选中背景、展开边框和桌面状态保持原协议。
- 消息子按钮、链接、头像和任务/消息列入口直接响应第一次点击，不先进入卡片选中。
  触摸结束仅记录轻点，在 click 冒泡后才考虑显示操作条；交互子元素不触发卡片显示。
  不拦截、不转发/重复派发子元素 click。滑动/长按不会被当作轻点。
- 每次新 touchstart 先清除旧长按标记，再判断是否为交互子元素；已消费 touchend 也清除标记。
- PWA「已保存」返回执行回首页导航，不只是展示侧栏；底栏恢复。
- PWA 列表索引没有当前详情，不染粉色：Room/DM（既有）、已保存入口、设置、Agent/Human/关系、计算机。
  设置及成员的桌面默认/记忆项保留；计算机桌面仍默认显示本机，PWA 初次进入先显示列表。
  底栏当前大页、真正选中的筛选条件不属于本规则，仍有当前状态。

## 回归与证据

`test:web:mobile-interactions` 在修改前复现设置/成员选中、计算机默认详情、已保存返回丢底栏、
原生 tap highlight、入口文字以及 pointerup 提前改变卡片呈现。
修改后 Chromium/WebKit 390×844 验证这些行为，以及 task 标识直达审批、阅读预览首次轻点直达 Thread、
长按后交互子元素不继承 preventDefault、设置桌面选择保留。
`test-mobile-tab-navigation-browser.mjs` 验证两项筛选同时激活的单行几何与根导航。
`test-task-presentation-browser.mjs` 覆盖桌面/PWA、Room/DM/Thread/审批页的消息操作条显隐。

自动化使用隔离数据库和 Fake provider；截图检查与 WebKit 引擎测试不等同于实体 iPhone PWA 验收。
未运行付费 CLI，也没有本轮 Raft 在线同条件双边验收。正式重启及完整检查结果在完成后记录。

### 完成记录

`npm run check`、`npm run format:check`、`git diff --check`、正式
`npm run build:web:workbench` 均通过。共享 tap-highlight 声明已登记进 sidebar-row
组件规范；旧消息选择源码断言更新为检查共用 click 入口，仍保留嵌套控件与显式选择约束。
Chromium/WebKit 的新增移动交互门禁、两种引擎的消息操作条门禁通过；
移动根导航/双筛选单行、Room/DM 返回逐帧无粉色、任务卡片原生滑动回归通过。

正式实例经空闲检查、持久状态备份及优雅停止后运行新冻结资源，保留原 Tailnet/LAN 入口。
两个原入口的新浏览器页面均验证构建标识；1728×1050 与 390×844 的
已保存/设置/成员返回、桌面设置默认项、频道新建入口、task 标识和阅读消息列首次点击通过。
正式复验只浏览及开关页面，没有发送消息或创建任务。实体 iPhone PWA 尚未人工验收。
