# 动态 Done 原生接线（2026-10-15）

来源：Raft `a98ae003246a0360872a77d76dec2fccd0347ef7`，`packages/web/src/components/thread/ThreadsInbox.tsx` 的 InboxRow、handleNestedRowActionKeyDown、Done 按钮（76–81、398–433、552–573）。授权源码与 FSL-1.1-ALv2 声明保留，官方文件未改。来源仓库地址见 `frontends/raft/adoption.json`。

结构移植：悬停／焦点／触屏显示规则、时间隐藏、动作背景、Check 图标尺寸、Tooltip、按钮和键盘事件隔离。直接复用官方 Tooltip 与 raft-ui Button。Loom 本地接线在 ActivityMessageRow、DiscoveryPage、discovery-client；不是整页逐字复制。

后台原本已有 `activity.mark action: done`。接线使用列表快照的 `latestSeq` 与 `threadId`，不使用房间最新序号，也不把 Done 替换成 read 或 Task 完成。成功后重新读取权威列表，较新的消息自然重现。等待时按钮禁用，同一次请求不重复发送；未知结果显示提示并重新读取，绝不自动重发。与官方乐观隐藏的差异：本地等服务端返回后刷新，不维护第二套完成状态。

先新增桌面／手机浏览器复现并确认因缺少 Done 按钮失败，再实现。专项验证：1440×1000 与 390×844、DPR 1；桌面 Enter、手机点击、精确前沿、操作不跳转、完成后隐藏、新消息后重现；桌面断网未知结果只发送一次并提示。既有导航／线程／草稿检查仍在同一短门禁通过。源代码检查68项、前端类型与正式构建通过。只跑相关门禁，未跑全仓检查或付费 CLI。

未覆盖：完成集合／恢复按钮、收藏、右键菜单；线程独立 Done 的端到端专项尚未新增（现有 threadId 按协议原样传递）；搜索发件人／频道选择器、分组等仍待迁入。无后端／调度／模型变更。
