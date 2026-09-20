# 动态入口重复读取与触屏等待

此前约 190ms 的测量早于单击/双击仲裁修复，不可当作当前每次点击的延迟。
Raft 发布动态 chunk 的 mn（本地展开证据 1012–1036）在桌面预览分支等待
220ms，而窄屏直接打开。来源/hash/许可见[动态布局审计](2026-09-20-activity-responsive-navigation-investigation.zh-CN.md)。

本批保留桌面 220ms 仲裁，防止双击先预览再跳转的双重效果；触摸和键盘直接打开，
仍留在动态大页（用户明确要求的本地差异）。不增加预览缓存或假身份占位。

原先 Activity mark 先读取 message.context，再由 App 请求 navigation.resolve，
之后正文读取自己的 message.context。现直接传动态已有的稳定 Room/Message ID，
由 Kernel human-navigation 校验访问权、消息归属并补齐 Thread/根消息。减少一次
串行请求；不取消权限校验、不在未成功打开时标记已读。

TDD：加载用例先确认旧实现多读一次 context（2 != 1）；触屏真实 tap 用例确认
旧实现仍启动 220ms timer（1 != 0）。实现后 Chromium 多栏、双击返回、触屏打开，
以及 Chromium/Firefox 配套数据加载回归通过。多栏首次运行有一次后退收起失败，
随后复跑及最终完整运行通过；未将该单次失败隐去。

正式页面同条件前后对照：每种宽度各 5 张相同卡片、每次重新进入动态页，测量
Playwright 真实 click/tap 到目标可见（含测试工具观察开销）。1440 桌面中位数
393→392ms，没有实质改善；390 触屏中位数 401→155ms。前后各 10 次均成功，
未检测到 principal 占位身份闪现。桌面 220ms 仲裁仍是固定延迟，不能称为瞬开。
正式状态已备份并安全重启，新进程与新页面均已核对。

类型检查、正式构建、本批格式及 diff 检查通过。全仓库 check 仍被此前
`/v1/worker/message-present` 未登记阻断；format:check 仍有原先 5 个文件告警。
