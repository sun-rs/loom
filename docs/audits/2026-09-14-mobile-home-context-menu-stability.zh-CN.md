# 移动主页与长按菜单稳定性

## 决策与单一 owner

2026-09-14 用户要求：长按弹出的菜单固定在初始屏幕位置，拖动手指不移动菜单或背景；PWA 主页不把后台记住的聊天标成粉色；移除主页搜索/动态快捷行以及导航抽屉独立的 M 行，让工作区标题在主页与抽屉顶部保持相同位置。

- `packages/ui-web/src/neo-brutalist/context-actions.tsx` 继续持有菜单打开、关闭、键盘和焦点行为。触摸打开时使用共享透明 Backdrop 承接外部点击，避免关闭时穿透到工作区按钮。拒绝由 `touchmove` / `touchend` 造成的外部关闭，点击菜单项、外部点击与 Escape 仍有效。
- `touch-menu-lock.tsx` 仅在触摸菜单打开期间阻止背景 touchmove 默认滚动；允许超高菜单内部滚动，菜单使用 `overscroll-behavior: contain`。关闭后撤销监听。打开前保持既有 500ms 长按、10px 移动取消和触摸滚动优先策略，不恢复触摸拖动排序。
- `use-mobile-layout.ts` 统一 767px 断点。RoomSidebar 仅在桌面渲染聊天选中态，移动端包括隐藏的列表都不渲染 `.is-selected`，避免返回列表时出现粉色退出动画；桌面仍反映正在展示的聊天。
- 主导航抽屉复用 `WorkspaceIdentity` 的工作区入口，保持与主页同一坐标；不新增工作区业务路径。默认名称 `RAH Local Workstation` 仅在移动标题显示为 `RAH Workstation`，不修改数据库名称或自定义工作区名称。`主导航` 保留为无障碍名称，不再作为可见标题。
- 搜索和动态仍从抽屉进入。桌面 Rail 的工作区入口保持原样。

## 上游依据与本地差异

Raft 授权分析来源 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA-256 `9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。本地 pretty 证据 `Code/reviews/rah_os/2026-09-13-dialog-audit/index-MqTUR4Ez.js.pretty.js` 的 Ett（约 128496 行）提供 500ms、10px 和释放抑制行为。沿用[既有触摸审计](2026-09-14-sidebar-touch-and-mobile-navigation.zh-CN.md)的来源和许可边界；没有将发布 bundle 加入产品依赖。

本地 Base UI 1.3.0 的 `menu/root/MenuRoot.js` 明确对 `openMethod === 'touch'` 跳过 scroll lock；`floating-ui-react/hooks/useDismiss.js` 的外部手势超过 10px 会关闭菜单。这两点解释了已有长按不选字后仍发生的移动/关闭问题。Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的 `packages/ui/components/ui/context-menu.tsx` 同样包装 Base UI，未补足此约束。采用 Base UI 自带 Backdrop，加 RAH 触摸防滚动与关闭原因约束；属于本地安全修复，不声称上游原样复制。导航标题与快捷入口变化是用户要求的 RAH 产品差异。

## 回归证据

先增加失败测试：原生 Chromium 触摸在菜单打开后将背景 scrollTop 从 0 移到 65；进一步测试发现第二次外部滑动触发 `outside-press touchmove` 关闭菜单。修复后以下测试通过：

- `scripts/test-sidebar-touch-browser.mjs`：390×844，初次按住后拖动、松手后再次滑动，菜单坐标和背景滚动位置不变；移动主页无粉色选中项；无文本选中、无误导航、外部点击不穿透，关闭后恢复普通列表滚动，不产生触摸排序写入。
- `scripts/test-mobile-navigation-drawer-browser.mjs`：主页与抽屉标题 x/y 相同、无 M 行、无主页搜索/动态快捷行、工作区切换菜单保持抽屉边界，保留 Escape、焦点与导航行为；Chromium 和 WebKit 均通过。
- `apps/web/test/identity-interactions.test.ts`：默认标题去 Local，自定义名称不被修改。新增测试先以导出缺失失败，再实现。

Chromium 使用原生 CDP 触摸（包含合成器滚动）；WebKit 以 DOM 触摸生命周期及浏览器真实 tap 验证，不能替代实体 iPhone 安装态 PWA 的系统手势验收。本批没有进行同前提 Raft 在线双边验收或付费 CLI 测试。

## 正式交付验证

`npm run check`、`npm run format:check`、`git diff --check`、`npm run build:web:workbench` 均通过；sidebar-row / sq-btn 浏览器规格门禁通过，catalog 已刷新。构建仅保留既有 chunk 体积提示。

正式工作台重启前通过 idle 检查，备份经校验保存为 `/Users/sun/.rah/backups/pre-restart-a5ced412-1ecc-4553-829e-406257fcb24a`，随后优雅重启。新进程 `68634` 使用冻结 build `da77156b554c99189740a3fbe92632dd64e6edbd170eb82cbc7b0be79408d086`；新打开的 `http://127.0.0.1:4173/` 页面验证为同一 build。

正式页面 Chromium 原生触摸复验覆盖实际频道和私聊：长按后继续滑动以及第二次外部滑动均不移动菜单/背景；关闭不穿透；无隐藏聊天粉色选中；点击后能正常进入聊天。重载和切回 1440×900 桌面后，当前聊天恢复粉色选中。390×844 的主页与抽屉标题实测均为 x=78、y=20；截图已逐张检查，默认标题为 `RAH Workstation`，无额外 M 行和主页搜索/动态快捷行。

正式截图和报告：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-pwa-stability-formal-8zRnIC`。此轮没有提交或推送，也未发送测试消息或更改正式成员关系。物理 iOS PWA 仍保留上述设备验收限制。

## 返回列表闪色修复

用户复验发现稳定画面没有粉色，但返回列表的动画中仍闪现之前的选中项。此前实现仅在 `mobileOpen` 为 true 时移除选中态，隐藏列表仍持有 `.is-selected`；返回时退出选中态会重新启用共享 `.channel-row` 的 150ms 背景色过渡，造成短暂粉色。这不是新的选中业务事件。

新增 `npm run test:web:mobile-sidebar-return` 先在旧实现上失败：逐帧记录到 `rgb(254, 125, 168)`，随后 alpha 从 0.984 降至 0.004 的 12 个粉色帧。最小修复仅调整 RoomSidebar 的呈现条件为桌面可选中；移动端隐藏时也不添加选中类，不修改共享颜色、桌面过渡、Room 状态或导航生命周期。

Chromium 与 WebKit 回归覆盖 Room → 列表、私聊 → 列表、再次 Room → 列表的完整返回动画，要求可见帧中没有粉色，而非仅检查动画结束后的类名；切回桌面仍要求恰好一个选中项。该修复属于 RAH 移动主页差异，沿用前述 Raft/Multica 来源边界，无新增上游代码拷贝。

本次闪色修复的 `npm run check`、格式/diff 检查、正式 Web 构建和 sidebar-row / sq-btn 规格检查均通过。正式实例在 idle/备份校验后重启，备份为 `/Users/sun/.rah/backups/pre-restart-f57b0493-8031-4737-a1a0-c1536f7c8281`；新进程 `78471` 使用冻结 build `c8aafdfa99990cb076393a3eab7e50e8983b4896da984c01bdbce9d7d3b0302a`。正式新页面核对同一 build，Room、私聊、再次 Room 返回分别采样 18、20、21 个可见帧，均为 0 个粉色帧；桌面选中态检查通过。截图与结果已检查，保存于 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-mobile-return-formal-i4Od63`。未进行实体 iPhone 验收、提交、推送或付费 Provider 执行。
