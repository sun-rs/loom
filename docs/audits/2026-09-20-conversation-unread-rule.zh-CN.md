# 频道与私聊统一未读

2026-09-20 后续修正：[归档通知不参与恢复未读](2026-09-20-archive-notice-unread-correction.zh-CN.md)。下文将归档和恢复合计 2 的结论已撤回，保留为历史实现证据。

## 合同与唯一 owner

用户 2026-09-20 明确要求：未打开的频道/私聊收到普通消息或正文系统消息，都应
显示未读条数并加粗；点击进入后清除，离开/取消选择后不保留未读导致的加粗。
恢复频道不是单独的 badge 类型，而是新系统通知参与同一计数。

依据延续[侧栏规格与选中记忆](2026-09-20-surface-selection-parity.zh-CN.md)及
[系统通知规则](2026-09-19-system-notices-and-restore-read.zh-CN.md)的 Raft 源码/浏览器
取证；本批按用户显式合同完善本地 Kernel 事件投影，不声称取得 Raft 中央服务 SQL。
来源、许可和 upstream 版本沿用上述证据及复用台账。Multica 不是本地 Room cursor
的 owner，不移植其 Issue 状态或另建浏览器计数。

HumanActivity 与持久 human_activity_frontiers 继续作为唯一计数/已读 owner。
普通消息保持现有过滤：自己的发送不制造自己的未读；Thread 保留独立已读域。
Room 正文系统通知包括归档、取消归档、有效成员加入及有效提醒回执；同 Room
的 Thread 提醒不重复计入主会话。未知事件、执行诊断、Task 状态事件不会伪装成
正文消息。归档/隐藏/非成员的导航投影继续遵守原范围与权限。

`roomTimelineNoticeSql` 统一提供系统通知计数和已读边界的筛选；不只统计恢复。
自动跳转的 viewport 读取不越过待确认系统通知；点击频道/私聊列表通过同一
`activity.mark(source=channel-list)` 确认当前会话的普通消息及系统通知。
SQL 单调推进 frontier，不把晚到的旧 viewport 请求变成新的未读。
已归档时未读的归档通知若也没确认，恢复后与恢复通知合计 2；若只有恢复通知
未读则为 1，数字不是按恢复动作固定写死。

列表字体与徽标复用同一个 canonical unreadCount；此前已有 data-unread / 700
字重规则，本批不再加一份恢复专属 CSS。浏览器检验名称 span 的实际计算字重，
不只检查外层 button。选中强调与未读强调独立，读过后只有当前选中项保留加粗。

## 测试

先复现普通消息的列表点击仅确认恢复事件、没有确认普通消息，再补齐频道和 DM
两条消息点击清零、成员通知 + 普通消息合计、自动跳转不清、单调 frontier 与
reload 保持。既有归档测试升级为未读归档 + 恢复两条通知，重复事件不重计。
系统事件分类覆盖有效/无效提醒、跨 Room 引用、Thread 排除和诊断排除。

`scripts/test-unread-sidebar-browser.mjs` 通过真实隔离 Kernel seed 生成频道
2 条普通消息 + 1 条系统通知、DM 2 条普通消息，在 Chromium/WebKit 验证未选中
名称 700、数量 3/2、点击清零、取消选择/切走 500、刷新不复现。
`scripts/test-settings-archive-browser.mjs` 同时检查恢复频道未选中时实际名称
700 和数字 2，及后续明确点击清零。使用临时状态和 Fake CLI，不修改正式频道
或使用付费提供方制造验收消息。

## 本批交付结果

专项 Kernel 24 项、系统通知分类 1 项、相关 Web 13 项单测通过；Chromium 与
WebKit 的统一未读和归档恢复浏览器门禁均通过。TypeScript、正式 Web 构建、
diff 检查通过。`npm run check` 仍被 `/v1/worker/message-present` 未登记阻断；
格式检查仍有先前 5 个 wake/delivery 文件。额外运行完整包测试后，发现 RoomKernel
源文件行数超限、既有交互图标冻结哈希不匹配两项失败，未放宽这些断言或门槛。

正式工作台已检查活动工作、备份并优雅重启到 Web build
`884616ab2922a12b615fa8f5552f2398760cb9609544db59681f5273ad19a29f`。
新 Chromium 页面只读验证正式列表：未读项的名称 span 实测 font-weight 700，
同时存在数字标识；未点击真实频道或制造测试消息来清除/改变用户未读。
新增纳入统计但尚未确认的历史系统通知也会自然进入同一未读投影。
未运行付费 CLI、未提交、未推送。
