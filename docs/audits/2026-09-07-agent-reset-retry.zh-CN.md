# Agent 重启回执重试：第一项续修

本批先制定[五项实施方案](../product/mainline-implementation-plan.zh-CN.md)，
然后继续第一项配置/执行入口，不打开多人项目或新的调度架构。

## 复现、修复和 owner

旧 `App.resetAgentExecution` 每次调用生成不同 idempotencyKey。隔离浏览器让正式 HTTP
handler 完成一次 restart，再丢弃响应；用户重试会取得另一个操作 ID，重复执行副作用。
`red.log` 确认失败原因正是两次操作键不同，而非环境或导入错误。

现在 `AgentExecutionResetDialog` 为本次提交意图保留一个键，经 AgentProfilePane 原样传给
App 和 SDK。提交后固定 mode；出错可以用原意图重试，关闭并重新打开才是新的用户操作。
每次回调仍通过原 Room barrier 和认证 API；daemon 使用原有 operation receipt 复验并重放，
没有新增服务端存储、重置算法、权限绕过或持久客户端队列。
配置/记忆/Room 归属不变；本批不宣称重启回执意味着模型已执行或 Task 已完成。

## 来源与有意差异

沿用[Raft 三档重置合同](../product/2026-09-02-agent-full-reset-contract.zh-CN.md)：
官方 `index-BoAC7nSE.js` SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。
本次也读取 Raft Computer 1.0.18 的 reset.ts 与 Agent workspace reset 提取物；后者 SHA-256
`c7ee2454f2ffcf91b070e176f2da39cbba5e6cb468433fc0e6f08902fe5f7bd4`。
这些证明产品重置范围，不证明未知 Server 的幂等实现。Multica Agent 组件搜索未发现更完整的
同语义重置 owner，继续复用已有 RAH coordinator。

提交后固定选项与补充重试说明是本地安全差异，防止同一回执键被换成另一种 destructive mode；
不是声称逐字复制 Raft。未新增官方现场双边验收。

## 已有证据

`npm run test:web:agent-reset` 的 Chrome/Firefox × 1440×900/390×844 均通过：
服务端已接受→客户端网络失败→相同操作重试，第二次 deduplicated，同 operationId；
不确定期间模式不可改，刷新后 Agent revision/身份未变。已检查 Firefox 移动端错误/重试截图。
测试使用临时 fake-provider daemon，只执行 restart；session/full 的磁盘隔离仍沿用原 coordinator
测试，不把本批 restart 浏览器证据扩大为全部 destructive 模式验收。

日志：`/Users/sun/Code/reviews/rah_os/2026-09-07-agent-reset`。
浏览器证据：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-agent-reset-OSA6OM`。

## 下一施工出口

第一项尚未整体关闭：现有 `durable-placement.test.ts` 已验证旧 Run 引用冻结配置；
`agent-memory-runtime-continuity.test.ts` 已验证子进程跨配置的私有文件连续性。
下一步需要把 Human 配置入口→下一 Run 实收配置的证据接通，同时核对启停与失败反馈；
这些已有分层测试不等于完整 UI 到真实 Provider 旅程。
后续四项按实施方案依赖推进。本批没有付费 Provider、commit 或 push。

## 检查与正式重启

`npm run check`、`npm run format:check`、`git diff --check`、
`npm run build:web:workbench`、`npm run test:web:browser` 均通过。
正式 idle 检查与备份校验通过后，优雅停止精确旧实例，并启动冻结构建
`ce7dd8607815c6e30fe444f918b9b3b979b1b5eb4962a387d8e670b7f06d72fb`。
备份：`/Users/sun/.rah/backups/pre-restart-b98632a9-a380-4e9d-80d5-803442025d02`。

正式新页面验证已通过：Chrome/Firefox 桌面与移动端打开三档重启对话框、Escape 关闭和焦点返回，
确认新构建，拦截并断言没有发出 reset 请求；已检查正式桌面截图。首次独立读取脚本因未先进入
正式页面初始化认证收到 401；改为读取真实页面自身的目录响应后通过，未修改产品认证逻辑。
`test:web:formal-discovery` 也通过。重启前后持久快照完全一致：6 Rooms、43 messages、2 Tasks、
378 events、4 Agents、35 configuration revisions、37 memory files。
正式地址 <http://127.0.0.1:4173>；交付时监听进程 38153。正式截图/日志保存在上述 reviews 目录。
