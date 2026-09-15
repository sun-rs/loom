# 消息菜单与选择条细化（2026-09-15）

## 来源与边界

授权 Raft vendor https://app.raft.build，build
`666bab60d8658d9e382e2c286ce1e423231e8f31`。
`index-WTraJnrd.js` 的 xie（约 2893932）、yn/k4e/w4e（约 1826095）、wr
（约 2581488）与 `index-EQxYM8hQ.css` 的 `.btn-brutal-sm`：

- xie 用 ResizeObserver 比较可用宽度与按钮宽度加间距，从末端逐步隐藏文字；宽度增长
  超过 8px 时重测完整标签。这里做结构移植，不把 vendor 当运行依赖。
- 小按钮 28px、字号 12px、边框 2px；阴影 2px，hover Y=-1px/阴影 4px，
  active XY=1px/阴影 1px，100ms cubic-bezier(.4,0,.2,1)。白底不变黄。
  本地沿用共享交互合同的 pressed 优先级，避免源 CSS hover/active 同时匹配的顺序歧义。
- 全选文字态无图标，紧凑态为 `$a` check；菜单选择消息和完成任务用 qy
  circle-check-big。该新增符号保留 Lucide ISC 来源注释；其余仍用现有内部图标。
- 菜单本地外框原已为 2px，修正的是误用 6px 的硬阴影，改为 Raft 普通 4px。

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`apps/mobile/data/chat-select-store.ts` 是原生选择包装，没有可替换浏览器窗口可见性
与 Room/Thread 归属的实现；保留 RAH 唯一 store，不新增业务状态。

## 本地变化

`MessageContextMenu` 把完成/重开放在关注操作之后的独立末组。普通转换仍紧邻收藏。
`message-social.css` 去除空标签的布局占位，表情按钮与同组图标垂直居中。

`MessageSelectionToolbar` / `useSelectionToolbarFit` 负责显示适配，顺序为
图片、复制 Markdown、取消、全选。隐藏文字后保留 aria-label 和提示；移动不含图片，
按钮字号与桌面相同。PNG 预览按 800px 画布约束对话框并居中，左右留白相同。

`useMessageSelectionActions` 为实际页面实例生成 ownerId，仍写入原唯一内存 store。
审批层延迟载入 Thread 根消息不会误认 Room 选择；同一 Thread 在覆盖层重复渲染也
不会在关闭时清掉底层选择。原内容可见时保留，原内容卸载或因移动页面替换而隐藏时退出。
该 ownerId 只是渲染归属，不改变协议、Task、Room 或消息标识。

## 验证

先通过隔离浏览器复现 6px 阴影、审批后选择丢失；扩展用例再次复现同 Thread 覆盖层
关闭清空底层选择和移动按钮 11px 字号。新增
`npm run test:web:message-selection` 覆盖 1440×900、390×844，任务菜单分组、图标
中心、按钮 hover/press、逐项紧凑及恢复、图片留白、头像/审批/消息列/任务页选择生命周期。

完整 `npm run check`、`npm run format:check`、`git diff --check` 与正式
`npm run build:web:workbench` 通过。新增图标按精确源路径单独验证，旧 sprite 哈希
保持冻结；未放宽整个文件的校验。组件 fixture 与 UI catalog 按维护工具重建。

新增专项 gate、Chromium/WebKit 消息菜单 gate、任务展示与审批阅读位置 gate 通过。
批量任务创建的 lost-receipt 测试首次收到 409，单独重跑原测试通过，未修改断言或产品
实现来掩盖它；该次瞬态因果状态变化未进一步定因，不宣称压力稳定性已验证。
1440×900、390×844 截图经人工检查，另检查 480/360/290/240px 工具栏及恢复。

正式进程 72912 经 idle 校验、备份并优雅停止，新进程 95088 加载冻结构建
`6d292c42bca83a09f2d16a6078f5fe7a1640c0f368ee453da88d828d4ac326c6`。
备份 `/Users/sun/.rah/backups/pre-restart-5281c3ea-b902-443d-8614-3daa4484877f`；
保留既有 Room、Agent、私有记忆及 loopback/tailnet/LAN 监听配置。
正式新浏览器验证菜单、真实触摸长按、文本页、Thread/Room 选择、审批往返保留、PNG
预览等距、重载和无页面异常；没有向真实 Room 发消息或修改任务。
截图证据目录 `rah-message-formal-7jlqjq`，隔离细化截图 `rah-selection-refinement-a2qVGo`
（均为本机临时浏览器证据，不作为生产内容或稳定 fixture）。

本批未运行付费 CLI，未做物理 iPhone 或 Raft 同条件在线双边验收；来源参数为授权
网页 bundle，不把截图观察冒称 iOS 原生参数。没有提交或推送。
