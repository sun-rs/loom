# 归档通知不参与恢复后的未读计数

## 证据与修正

`collaboration-service.ts` 的 archive/unarchive 处理分别在各自事务中 append
`room.archived` / `room.unarchived`，恢复不会补写两条通知。
此前统一通知筛选将这两类事件均作为侧栏未读，导致未确认的归档事件在恢复后也被统计。
这是上一批分类错误；撤回“未读归档 + 恢复应为 2”的结论。

遵循用户本次明确规则：归档通知属于历史生命周期记录，不是重新出现频道的新未读。
恢复仍是一条普通未读系统通知；不硬编码总数为 1，不清空原有普通消息未读。
Raft 前端取证来源和 Multica 比较沿用 [统一未读审计](2026-09-20-conversation-unread-rule.zh-CN.md)；
本次属于用户要求的 RAH 分类修正，不声称获得上游后台未读 SQL。

## 唯一所有者

Kernel `human-activity-notices.ts` 从侧栏未读资格中排除 `room.archived`，不改变事件写入、
历史展示或持久游标。已有恢复频道的计数会从 canonical ledger 重新计算，无需改写历史或迁移。
通知计数、自动 viewport 读取围栏与显式列表点击共用该筛选，不另加前端恢复特判。

## 验证

TDD：空频道归档恢复预期 1，旧实现得到 2；归档事件资格预期 false，旧实现 true；
自动读取预期停在恢复事件之前，旧实现停在归档事件之前。确认失败后修改资格筛选。
26 项 Kernel 测试通过，覆盖空频道恢复 1、保留原未读消息后为 2、重复命令不重计、
数据库重开和列表确认后清零、迟到 viewport 请求不能复活未读。
浏览器归档门禁保留两次恢复历史通知的断言，将每次确认后再次恢复的未读断言改为 1。

Chromium/WebKit 隔离归档恢复门禁通过，类型检查、正式构建和 diff 检查通过。
全量 check 仍被既有 `/v1/worker/message-present` 登记缺失阻塞；format 仍报告此前
五个无关 wake/delivery 文件，未改写这些内容。

正式工作台通过活动工作检查及备份验证后优雅重启，备份 receipt
`pre-restart-c7882186-91bc-4b2f-937c-5a38fadad177`，Web build
`21f637d12235bd1f3d44072d7772a2ac77b6d8d2982c7001f1b28f16a8ed630e`。
新进程监听正式端口；新 Chromium 页只读确认频道列表、未选中正文正常显示，
截图 `/tmp/rah-archive-count-formal.png` 已检查。
正式频道当前无可见恢复未读，未为验证而归档/恢复或清除用户未读；1 条恢复计数由
隔离真实 Kernel 浏览器场景验证。未运行付费 provider，未提交或推送。
