# PWA 导航与任务稳定性续修

## 来源与边界

用户授权的 Raft iOS 截图继续作为移动端布局意图参考。按 iPhone 15 Pro Max 430pt 与截图比例估算，底部胶囊到屏幕底边约 20–24pt；本地采用 `max(8px, safe-area-bottom - 12px)`，常见 34px 安全区下为 22px，较原布局下移 12px。半透明面改为 55% 白色与 12px 模糊，内部选中胶囊保留 7% 黑色。这些数值是 RAH 参数，不是获得了原生 iOS 源码。

Raft 发布包 `666bab60d8658d9e382e2c286ce1e423231e8f31`（来源 `https://app.raft.build`，本地授权证据 `raft-ui/vendor/raft/manifest.json`）：`index-WTraJnrd.js` 的 `kje.headerIcon` 明确 `size-9`，Avatar `md` 为 `size-9`，Button `icon-md` 为 `size-8`。加载该包 `index-EQxYM8hQ.css` 到 390×844 Chromium 校准页，根字号 16px，对应实测 36px / 32px。此为发布 CSS 参数校准，不冒充官方登录页面的双边验收。资源出处/许可仍沿用 ui-tokens/adoption.json 和原始 snapshot 的 provenance；本批只修正已维护的共享尺寸规则，未复制新 bundle 进入生产。

Multica 移动导航使用原生导航 safe-area（`apps/mobile/components/nav/more-tab-dropdown.tsx`），不能直接作为 Web 胶囊 CSS；未增加第二套导航状态或依赖。

## 实施 owner

- mobile-navigation.css：底栏下移、半透明、底部滚动留白同步收紧；动态副标题在移动端显示。
- product.css：删除铃铛独立 hover 白底规则，保留键盘 focus-visible；展开样式仍由 aria-expanded 控制。已复现原问题：弹窗关闭、aria-expanded=false，但触屏 sticky hover 仍令背景为白色。
- ui-tokens PanelHeader：频道图标/私聊头像为 36px；返回/设置等操作继续共享 32px。60px 标题轨保持上一批规格。
- ui-tokens interaction-state：任务分段选择取消原生触摸高亮，不改变持久选择语义或桌面颜色。
- GlobalDiscovery：动态副标题使用现有 activity.list.total 和 summary.unreadActivityCount，显示「x 条动态 · x 条未读」，不新增计数 owner。
- TaskToolbar：频道「全部清除」紧靠创建者/负责人，仍在首行；新建与看板/列表仍在第二行。
- App：频道任务只把首次加载、切换 Room 未取得对应数据当作 loading；后台同步不再把已加载空结果切换成五个空分类。任务数据、筛选状态和分页继续归原 owner。

## 验证

先扩展移动浏览器门禁，复现铃铛关闭仍白底、底栏位置不符；另以独立临时 fixture 延迟 Room sync，复现已加载空任务状态消失、分类闪现。实现后核对点按展开/关闭、颜色、图标尺寸、动态计数、两行筛选布局，以及空筛选结果在后台等待期间保留同一 DOM。测试数据使用隔离状态与 Fake provider，不发送真实 Agent 消息。

## 已完成验收

- `npm run check`、`npm run format:check`、`git diff --check` 通过；正式 `npm run build:web:workbench` 通过。共享样式变化后重新执行 sidebar-row / sq-btn 实际浏览器测量并生成 catalog，未放宽任何规格断言。
- Chromium 与 WebKit 的 390×844 移动导航门禁通过，证据目录为系统临时目录下 `rah-mobile-tabs-9yzMrq`、`rah-mobile-tabs-lSccgf`。筛选无结果的后台 sync 等待测试通过，原空结果 DOM 保持连接；测试已加入 `test:web:mobile-navigation`。
- 以合成彩色背景对生产底栏 CSS 做半透明校准并查看截图 `/tmp/pwa-nav-transparency-calibration.png`，确认背景透视与模糊；这是校准页，不是正式产品内容。
- 正式构建 `b3e87fbd5da242e107d62d46b73500dc22fc841944525a1693e5a10e29d9375b` 经守卫确认空闲、备份、精确 PID 正常停止后上线。备份 `~/.rah/backups/pre-restart-a4a1b221-e196-4903-9d8d-0672878ea15b`；网络收据保留 Tailnet、本机与 LAN 三个入口。交付时进程为 24904。
- 从真实 Tailnet、LAN 入口分别新建 430×932 浏览器页面，验证冻结构建、铃铛反复开关、导航、频道/私聊图标、任务筛选、设置和桌面导航，均通过。截图目录 `rah-pwa-refinement-formal-CfeEcR`、`rah-pwa-refinement-formal-TCFtIR`，已查看首页、频道任务、私聊和动态画面。额外等待真实 activity.list 响应后核对标题为「9 条动态 · 0 条未读」，截图 `/tmp/pwa-formal-activity-loaded.png`。
- 完整检查日志 `/tmp/pwa-refine-check3.log`；真实入口日志 `/tmp/pwa-refinement-tailnet.log`、`/tmp/pwa-refinement-lan.log`。本批未运行付费 CLI、未提交/推送代码，未声称物理 iPhone PWA 或官方 Raft 双边验收。
