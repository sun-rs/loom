# Computer 批量重启／重置收口

单 Human、单 Mac 范围。继[四家 CLI 与 Computer](2026-09-07-real-cli-and-computer-closure.zh-CN.md)
及[媒体预览](2026-09-07-media-preview-closure.zh-CN.md)之后，本批仅关闭 Computer 已选 Agent 的
重启、重置会话、完整重置入口，不扩张为 Computer 服务自身的升级／重启或孤儿目录清理。

## 来源与设计

稳定行为：`COMPUTER.AGENT.BULK.RESET`。

授权 Raft `MachineDetailPanel-CIacRrGS.js` 的 `Na`：按 Computer 已选 Agent 冻结范围，
reset modal 提供 `restart/session/full` 三种模式及明确说明。固定 SHA-256 沿用
`5c5aa52ffc2b3098a93c33bf619cfce0797d47ea1cf7e5fb2c72f1c097b417a8`。
这是结构采用与本地 glue，不是 byte-exact 复制。

Multica commit `11861145abc59a0d39c8c8f24ad837d4584e664f`（Apache-2.0）的
`server/internal/daemon/execenv/codex_home.go:699` `resetCodexSessionState`，SHA-256
`026799594f1d55b2c8a9b4ae8bb3620648aaacd68ab7fd0d6831ea39237d912b`，清理的是 per-task
Provider 派生缓存，不能代替 Agent 身份级管理 fence。RAH 已有更适合的三模式 daemon owner，
本批不移植另一套 Provider reset 算法，也不引入 Session-first 状态。

调用链：ComputerAgentReset → 现有 AgentExecutionResetDialog →
`applyAgentResetBatch` 临时 UI 进度 → App 原 `resetAgentExecution` →
`agent.execution.reset` → 原有 daemon receipt/Agent exclusive operation fence。

- 选择范围在打开确认窗口时冻结；模式与 operation key 在第一次提交后锁定。
- 每个 Agent 的键为组键加冻结序号；只有已确认成功的项进入当前窗口的 completed 集合。
- 中途失败停止后续项，重试跳过已确认项并复用未知项的键，回收 daemon 原回执。
- 更换选择范围／卸载取消后续操作，已接受的单 Agent 命令仍由 daemon 完成。
- 模态框使用共享三模式、完整重置警告、pending 防关闭和焦点协议，通过 Portal 避免被滚动区裁剪。
- 普通启用/停用仍是独立 canonical Agent 状态操作；不以 bulk reset 自建持久队列或完成 Task。
- 关闭失败窗口后再次打开是新的用户意图；本地未新增跨页面持久批量续跑器。

## 验证

证据：`/Users/sun/Code/reviews/rah_os/2026-09-07-computer-reset`。
`unit-red.log` 先失败，`unit-green.log` 验证成功项不重做、未知项相同键和取消后不执行下一项。

真实浏览器使用隔离 daemon/Fake Runtime，预置非空 Agent 工作区：
Chrome/Firefox × 1440×900 / 390×844 × 三模式。
每次都让第二个 reset 在服务端成功后丢失回执，确认三次请求只对应两个 Agent，
第二/第三次键和 operation ID 相同、deduplicated=true，第一个 Agent 只调用一次。
同时验证重试时模式锁定、dialog 关闭/焦点、刷新、Agent Principal 和配置 revision 不变。
restart/session 保持工作区摘要；full 之后工作区 absent 或零文件。移动端在此前已清空的
隔离目录上验证 repeated full，不把它冒称第二次非空删除。没有触碰正式用户记忆，没有付费运行。

本批不证明真实 CLI 活跃时的四家逐一强制中断；该生命周期仍由既有 fence/取消测试和
上一批普通真实执行证据分别描述。未把 group UI 成功当作模型已读消息或 Task 已完成。

## 正式交付结果

全量 `check.log`、`format-verified.log`、Web `build.log`、diff 检查通过。
`browser-final.log` 的 12 场景通过，收据 `rah-computer-reset-ViWeTV`，完整重置重试截图已查看；
`scan-regression.log` 的原批量启停/扫描/创建入口 4 场景通过。
B044/B046 登记同步到当前事实，恢复指南不再错误标为未实现；`registry-final.log` 通过。
这次文档登记变化发生在浏览器源输入收据之后，没有改变产品构建。

2026-09-07 idle 审查后备份
`/Users/sun/.rah/backups/pre-restart-c97bf77b-8e9e-4bb7-80e8-225cbf03723f`，优雅停止旧实例，
启动冻结 Web build `1a91655c5eac49ef6412fe53babdaa02d613b6e54996ad73ca71d635969c2dc2`。
正式 URL `http://127.0.0.1:4173`；当时新 PID 24688，后续操作须重新确认。
Chrome/Firefox 正式只读新页验收通过：`formal-browser.log`、`rah-discovery-formal-WD6HtW`，
截图已查看。批量 reset 破坏性场景只在隔离状态执行，不对正式 Agent 重置作验证。
重启前后 snapshot 内容 hash 完全一致，保留 6 Rooms、43 Messages、2 Tasks、380 events、
4 Agents、36 Agent revisions 和 37 memory files。未提交、推送或发布。
