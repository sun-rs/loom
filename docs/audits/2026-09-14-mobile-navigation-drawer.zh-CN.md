# 移动端主导航抽屉

## 决策与单一 owner

用户于 2026-09-14 明确选择：取消所有移动 Web/PWA 页面的常驻底栏，改为始终位于左上角的展开/折叠入口。实施前所有未提交内容已保存为基线提交 `49a6c71`。这是对 2026-09-12 常驻底栏决策的明确替代，不追溯修改历史审计结论。

`packages/ui-web` 的 `OverlayDialog` 暴露共享 Base UI 模态生命周期，避免 Web 依赖未声明的间接包。`WorkspaceNavigation` 只拥有抽屉开关和 767px 响应式呈现；桌面与移动端共用 `Rail` 的目的地、未读状态、工作区身份和通知入口。App 原有导航回调仍拥有页面切换，Room/DM/Thread、Task、Agent 的业务状态不迁移到抽屉。

- 宽度超过 767px：保留桌面常驻导航。
- 767px 及以下：移除底栏与 52px 预留；shell 使用完整 `100dvh`。
- 左上角 44×44 入口固定在现有顶栏内；详情页返回按钮独立保留。现有顶栏统一预留入口位置，较矮顶栏的最小高度为 62px，不另加一行导航。
- 抽屉宽 304px，最多占视口减 48px；覆盖并调暗正文，不挤占正文布局。菜单过长时内部滚动。
- 点击目的地关闭抽屉并调用原有导航；聊天入口打开会话列表。打开/取消抽屉不重建正文，保留输入草稿和阅读位置。
- 关闭按钮、Escape、遮罩点击、焦点约束及返回由 Base UI Dialog 负责。切换回桌面自动关闭抽屉；减少动态效果时不播放滑动。
- 顶部、底部和左侧安全区使用浏览器环境变量；评论和聊天正文的文字选择策略不改变。

## 来源与有意差异

Raft 分析证据：`https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA-256 `9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`；本地授权分析文件位于 `Code/reviews/rah_os/2026-09-13-dialog-audit/index-MqTUR4Ez.js.pretty.js`。`Oue/Emt`（169558–169670）为底部导航及详情隐藏条件；`Sy` 为已采用的 240ms 进入/180ms 退出抽屉参数。沿用既有 Raft 767px 边界、维护的颜色/图标、覆盖层与动态参数；新主导航布局是用户要求的 RAH 差异，不声称是 Raft 原样复制。

Multica 对照版本 `11861145abc59a0d39c8c8f24ad837d4584e664f`，仓库 `https://github.com/multica-ai/multica`：`packages/ui/components/ui/sidebar.tsx` 的 compact `Sheet` 分支与 `packages/ui/components/ui/sheet.tsx` 的 Base UI Dialog Portal/Backdrop/Popup。采用相同库的模态生命周期；未复制 Multica 组件代码、样式或图标，无新增源码许可证转移。运行和构建不依赖任一上游工作树。

## 验证范围

行为回归：`scripts/test-mobile-navigation-drawer-browser.mjs` 首先在旧实现上以“底栏必须移除”失败，再实现。覆盖主入口、共用目的地、点击空白/Escape关闭、焦点返回、完整视口、草稿/滚动保留、页面切换、桌面恢复、矮屏菜单内部滚动。

`test-mobile-layout-browser.mjs` 覆盖主要页面和任务自适应；`test-conversation-two-pages-browser.mjs` 覆盖 Room/DM、消息列、Agent/Human、任务详情、草稿和返回；`test-sidebar-touch-browser.mjs` 回归触摸长按、滚动与鼠标排序。浏览器中的内容为隔离 Fake CLI 测试数据，不能作为正式产品地址。

## 最终结果与限制

- `npm run check` 退出 0；核心测试 1592 通过、17 个可选测试跳过，Web 单元测试 426 通过，回归/规范/策略检查通过。
- `npm run format:check`、`git diff --check`、`npm run build:web:workbench` 通过；构建仍有既有大 chunk 提示。
- sidebar-row、sq-btn 真实浏览器规格检查通过，匹配规则清单与 UI catalog 已更新。
- Chromium / WebKit 抽屉专项通过；主要移动页面、任务列表/看板自适应通过。WebKit 的既有内联引用测量脚本改为读取标准或 `-webkit-` 的 computed user-select，仍要求同一个 `text` 值，并已复测通过。
- Chromium / Firefox 的 Room/DM 双页、消息列、Agent/Human、任务详情、草稿、阅读位置、返回与重载通过。视觉检查发现并修复 Task 独立标题栏与固定入口相互遮挡，新增对应指针位置断言。
- 正式触摸复验发现 Base UI 默认焦点恢复可能回到隐藏的消息头像，重新打开其浮窗。抽屉 Popup 现在明确以固定菜单 Trigger 为 `finalFocus`；从头像详情经导航回到聊天列表的触摸回归先失败、修复后 Chromium / WebKit 均通过。
- 工作区菜单改为抽屉内展开；Escape 先关闭其菜单/编辑窗口，下一次才关闭导航。浏览器复测通过。
- 直接进入设置等全局页面后，从抽屉打开通知不能依赖已卸载的铃铛触发器。共享 `InteractivePopover` 接受调用方提供的稳定定位元素，Web 在移动端使用固定导航按钮；桌面不提供此元素而保持原有触发器。真实可见度（包括祖先透明度）与中心点击命中检查先失败、修复后通过；已有桌面/移动通知回归在 Chromium、Firefox 通过。
- Chromium 原生触摸模拟的长按菜单、释放/取消、无文字选中、纵向滚动、禁止触摸排序回归通过。
- 额外持久化工作台门禁 `run-local-workbench-gate.mjs` 未通过：第一次在 Fake CLI 回复等待阶段超时，保留临时状态重试时在浏览器启动前报 RuntimeOffer `not_found`。未修改生产运行配置以绕过失败，不将该门禁标为通过。其旧底栏定位已随本次界面变更更新。
- 本轮正式工作台重启前确认没有活跃任务，备份已校验：`/Users/sun/.rah/backups/pre-restart-2f1b4a36-d101-44b7-b4ec-cd1b50731962`。新进程使用冻结 build `ab80ebeec39001adf31ee14dab1e0c7820cf406f031e36b059e006380efd508f`，新打开的正式 `http://127.0.0.1:4173/` 页面已核对同一 build。
- 正式页面 390×844 / 1440×900 的导航、有历史消息的 Solars Room、私聊、双方 Agent 头像入口及全局页面、重载、桌面恢复已通过并查看截图；头像详情经导航回聊天列表的焦点回归也在正式页面通过，设置页直接打开通知的正式截图已确认浮窗位于固定入口下方且可见；不是仅以 health 判定。证据目录：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-navigation-formal-gngMG6`。

桌面 WebKit 和 Chromium 触摸模拟不等于真实 iOS 已安装 PWA 验收；本轮没有真实 iPhone 设备或付费 CLI 执行。新设计是用户选择的非 Raft 导航方案，不声称同前置条件的 Raft 双边界面一致。基线 commit 已完成；本轮新设计未再提交、未推送。
