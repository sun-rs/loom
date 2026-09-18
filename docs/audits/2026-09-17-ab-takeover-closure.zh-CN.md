# 批次 A/B 接手收口

基线：`98dc095` / `v1.0.0-rc.1`，包含 Fable 未提交的 A/B 工作。本轮保留并修复这些改动，没有整批回滚，没有启动 C/D、新 Composer 或记忆管理项目。原工作区 88 个变更文件已在本机临时目录另行保全。未提交或推送。

## 修复与 owner

### R5：恢复真正释放删除围栏

旧代码写入 RuntimeProcess termination proof，却保留 `orphaned` RunAttempt；删除协调因此永久阻塞。该问题在 rc.1 已存在。Kernel 新增 `recovered-run-attempt.ts`：只在匹配 `run.termination_proven`、RuntimeProcess 终止投影与退出事实时收口 orphan。退出码 0 且无 signal 为 exited，其余为 failed；保留失联 error，finishedAt 使用证明时间，写一次 run.finished。正常 starting/running 仍由 Host finishRunAttempt 处理；Task、Inbox、Activation 履约不由进程退出推断。

启动兼容修复已有“证明已写、RunAttempt 未收口”的记录。无证明不修复；已有 terminal RunAttempt 不改写；恢复身份、driver、attempt fencing 保持原 owner。删除随后走原协调器，不新增 force delete。

失败测试先观察到 `orphaned != failed/exited`；修复后恢复删除与启动幂等用例通过，原 Host/Placement 恢复围栏继续回归。

### R6：结构检查与安全重启

旧版比较遗漏部分索引条件、CHECK/外键/唯一约束、排序规则，且把所有差异当 legacy_drift 放行。新签名通过 SQLite PRAGMA 比较结构，仅对 PRAGMA 未提供的 CHECK/索引表达式做保留字面量的 token 比较。不是直接比较 CREATE 原文，也不宣称是任意 SQLite SQL 的等价性证明。

精确兼容范围来自现有迁移源码：reminders.target_room_id、room_files.created_at、agent_hosts.instance_id 的可空旧列；room_file_gc_receipts.next_attempt_at_ms 缺默认值；room_deletion_receipts 缺 GC 计数 CHECK；旧 runtime_offers 的三个可空投影列与 observation 唯一键。GC 计数与非空 observation 唯一性还检查当前数据。表的其他属性必须与参考一致，不能整表放行。

正式库只读实测是四项历史差异：之前报告的三项加删除收据 CHECK。全量 Kernel 测试还覆盖旧 Host/v4 Offer 迁移。v3/v4 测试夹具补齐了初始仓库 `6a5099f` 已有的 CHECK 定义，保留缺 Placement/旧 Offer 的迁移场景和原有断言，没有用删断言绕过结构检查。

同版本未知结构漂移在写入前拒绝；旧版本迁移后再次复核；只读打开失败不再改为可写打开。正式重启在停止旧进程前，对已校验备份的临时副本执行新 Kernel 初始化、schema 收敛、quick_check/foreign_key_check。副本失败时保留旧服务运行。

恢复入口不再仅靠事件数量推断“无新数据”：比对状态文件摘要、全部数据库 schema 与行内容，并要求 Host offline。先准备完整替换目录再置换，置换失败恢复原目录。已经迁移或产生其他数据变化的库会拒绝该入口，需要专门恢复方案；该库函数仍未暴露为产品命令。

失败测试先证明错误索引被放行、快照后凭据变化被覆盖；修复后均拒绝且保留现场。

### R9：真实错误边界与脱敏

补充真实 React 浏览器故障注入：同一 resetKey 下失败保持、手动重试、换页恢复、相邻草稿保留，覆盖桌面与 390×844。检查发现 React 默认 onCaughtError 会在边界的脱敏日志之外再次记录原始异常；现在由共享 root options 关闭重复通道，边界仍报告脱敏诊断。异常名称和消息一并脱敏。新增 `test:web:error-boundary` 并接入 CI，没有增加生产故障注入接口。

## 上游边界

沿用[09-16 上游证据](2026-09-16-rc1-audit-and-latest-raft.zh-CN.md)及其不可变 URL/hash。Raft Web 1.16.0 与 Computer 1.0.32 不是同一版本轴；没有中央 Server 源码。此次修复的是 RAH Kernel 的证明链和 SQLite/部署 owner，不冒称从 Raft 复制了中央恢复或数据库迁移算法。

## 验收记录

代码与本轮自动化收口完成：

- `npm run check`：2292 项，2275 通过、17 项 opt-in skip、0 失败；日志 `/tmp/rah-takeover-check-final.log`。未把 skip 计为通过。
- `npm run format:check`、`git diff --check`、`npm run build:web:workbench` 通过。完整检查之后只有测试定位与本报告修订，没有更改生产代码。
- 隔离真实浏览器通过：移动导航、任务触摸滚动、消息菜单、滚动所有权、Agent 停止窗口的成功/错误/重试/延迟响应，以及新增错误边界故障注入。包含 1440px 与 390×844；已查看截图。
- 持久工作台真实启动门禁通过：Fake Provider 执行、持久化后重启、Provider thread/resume、原浏览器文档重连与移动首页。测试启动器显式注入自身参数，不要求生产环境放行继承的 RAH_FAKE 变量；严格断言现有 Codex 记忆隔离启动参数。旧 UI 定位更新为当前 all 频道、成员资料与运行时配置入口，保留模型、权限、提醒来源与持久化断言。
- 历史正式库的在线备份副本完成新 Kernel 初始化、pending schema 收敛、完整性检查；四项已知 legacy 差异保持，未知差异为零。没有对活库做整表重建。

正式部署于 2026-09-17 00:39（Asia/Shanghai）完成：旧 PID 57436 正常停止，新 PID 80749；重启前确认无活动 Activation/RunAttempt/Placement。备份 `~/.rah/backups/pre-restart-66a613b5-268d-4b43-b198-e4142b665396` 经过复验，迁移预检在停止旧进程前完成。

冻结 Web 制品 `a9977b87167d20cf3679cca296c0e4cd595ab53291efc11373bb04e876b20661`；统一 buildId `d00b5f8de6c8d53b`，builtAt `2026-09-16T16:20:29.406Z`。本机、原 Tailnet、原 LAN 三入口仍在原端口监听，各自 health 与首页 meta、冻结 bundle、关于页身份一致；伪造 Host 返回 421。重启前后消息 100、Agent 4、Agent 配置版本 55、Task 6，未丢失；私有状态备份及原记忆目录保留。

从实际 LAN 入口新建 Chromium 上下文，在 1440×844 与 390×844 打开首页、设置/关于并刷新：无 pageerror、无横向溢出，身份一致。本轮没有在正式工作台发送 Agent 消息、停止 Agent 或触发付费执行。该验收允许原产品的阅读状态同步，不将其误称为数据库完全不写。

本机证据目录（临时产物，不作为可分发制品）：

- 原始改动保全：`$TMPDIR/rah-ab-takeover-dwa1TD`。
- 持久门禁：`$TMPDIR/rah-local-workbench-gate-5uWyMl`；日志 `/tmp/rah-takeover-workbench-final.log`。
- 错误边界：`$TMPDIR/rah-error-boundary-FnPiyi`；Agent 窗口：`$TMPDIR/rah-agent-dialog-1xHTzj`。
- 正式浏览器结果与截图：`$TMPDIR/rah-takeover-formal-browser-gVu0IV`。
- 正式重启流程：`/tmp/rah-takeover-restart.log`；新进程日志最后一条 schema 提示只列四项已知 legacy 差异，旧事故日志仍保留。

本次修复收口时，实机 iPhone 键盘仍待实机，不以桌面 WebKit 代替；远端 CI 未推送验证，未运行付费 Provider。用户随后授权的真实 CLI 与实机验收见[单独记录](2026-09-17-paid-cli-and-iphone-acceptance.zh-CN.md)。LAN/Tailnet 入口保留已有收据授权，未扩监听范围；版本保持 development，不擅自签发下一发行版本。typed health 完整 buildIdentity 扩展、C/D 与分发签名不包含在本轮。
