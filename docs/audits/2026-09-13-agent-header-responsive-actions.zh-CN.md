# Agent 顶栏随面板宽度收起操作

## 证据与归属

Raft 官方 `https://app.raft.build/` 冻结证据（2026-09-08）：

- `docs/evidence/raft-web-20260908-current/AgentDetailPanel-DSYPOiPi.js`，SHA-256
  `f65d89ca2784a6383173747778edbb263adcd514cf6ae0bc53e47e32bd0ac430`。
  `_s` 生成同一组聊天、启停、重启操作，`responsive` 模式有 inline 与 overflow
  两种入口；tooltip 参数为 `side: bottom`、白色；菜单在下方、末端对齐、间距 4px。
- `index-D8Neh8lc.css`，SHA-256
  `11f78ea36cb9e35639a08232b61a4523355c5242717b4abe48ec5ff0fc230f25`。
  `.agent-profile-header-container` 为 inline-size 容器；
  `@container (max-width:480px)` 隐藏 inline、显示 overflow。阈值是 CSS 容器内容宽，
  不是浏览器窗口宽度。
- Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
  `packages/views/agents/components/agent-detail-inspector.tsx` 是资料编辑器，
  本次检查未发现该顶栏容器切换契约，不采用其布局替代 Raft。

发布 bundle 仅作分析证据。本次是参数与结构移植、RAH glue，不是源码逐字复制。

## 修复

原 AgentDetailHeader 固定渲染所有按钮，并复用 HintTooltip 的向右默认方向。
`agent-header-actions.tsx` 统一操作数据及既有回调，CSS 容器查询决定入口；
关闭侧栏按钮保持独立。`HintTooltip` 增加可选方向，顶栏传 bottom，其他入口保留原方向。
菜单沿用共享 ActionMenu / Base UI 的焦点、Escape、外部点击、定位和禁用行为。
菜单项消除浏览器原生按钮边框，使用现有浅黄色高亮。
本次只改变展示与入口，不新增业务状态或协议，不调用真实 Agent 来验证。

## 验证

`scripts/test-agent-header-responsive-browser.mjs` 在旧实现确认缺少更多操作入口而失败；
另外确认原生菜单按钮存在 2px 默认边框的失败，修复后通过。
在固定 1440px 浏览器内独立改变顶栏容器内容宽 480/481px，验证切换边界；
检查菜单三个动作、Escape、键盘打开、停止确认弹窗与取消、外部关闭，
下方 tooltip 与相邻图标真实鼠标命中。390×844 检查菜单不溢出。
冻结源码对照不等于在线 Raft 同条件双边验收。

## 交付验证

`npm run check`、`npm run format:check`、`git diff --check` 和正式 Web 构建通过。
正式构建 `c5f4b489a032d8e5935569f962eee274f88f6f9dfe3935f622720f06887e9cc1`
在重启守卫的空闲检查、备份后启动，备份收据
`pre-restart-c7a63f69-84cc-476c-a07c-2ea5b22d6588`。
本机、物理 LAN、Tailnet 的新 Chromium 页面均使用原 Council 聊天打开 Kimi 右侧栏，
真实鼠标拖动分隔线至约 400/660px，确认更多菜单与三个按钮切换、关闭按钮保留、
下方 tooltip 与相邻图标可用；390×844 菜单不越界。正式截图已检查。
保持原四个 Agent、对话和私有状态；不触发真实停止/重启 Agent、不运行付费 CLI、不提交 Git。
