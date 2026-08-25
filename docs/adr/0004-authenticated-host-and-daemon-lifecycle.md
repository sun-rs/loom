# ADR-0004：认证 Host 与本机 Daemon 生命周期

状态：Accepted（E1，2026-08-25）

后续：composition root、Host instance generation、deadline、Host-derived Worker grant 与 Outbox wake 已由 [ADR-0005](./0005-daemon-composition-worker-delegation-and-wake.md) 收口；下文“尚无 entrypoint/版本信息”等内容保留为本 ADR 当时的声明边界。

## 背景

早期 `AgentHost` 直接接收 `hostId` 和 `participantIds`。调用者可以自报 Host 身份和 Agent 范围；如果直接在此基础上包装后台进程，就会把可伪造参数固化成 daemon 权限边界。同时，`AgentHost.run()` 虽可持续 reconciliation，但还没有本机单实例、signal drain 和清晰的进程状态转换。

Room/Activation/RuntimeProcess 必须继续由 Kernel 持久状态保护。daemon lock 只解决同一台机器上的重复启动，不能成为第二套业务 lease。

## 决策

1. Kernel 签发 `rah_hat_` Host token，只持久化 SHA-256 hash、Host ID、Agent participant 白名单、签发时间和撤销时间。
2. Host token authentication 产生不可由普通构造调用伪造的 `AuthenticatedHostContext`。所有 Host mutation 从 context 派生 Host ID 和范围，不再接受调用者重复提交这些 authority 字段。
3. 每次 Host mutation 都重新读取 credential；撤销立即 fence 已签发 context 和后续 token authentication。Host heartbeat 同时记录当前 credential generation，撤销旧 generation 不会把已经用新 credential heartbeat 的实例误标 offline。当前 provision/revoke 是本机 bootstrap API，不对网络客户端暴露。
4. `AgentHostDaemon` 在 owner-private 目录使用确定性 Unix socket 做本机单实例协调。socket 只回答“当前有 live owner”，不传递 Room 内容或业务命令。
5. `SIGINT`/`SIGTERM` 经显式 bridge 转为 abort/drain：停止领取新 Activation，已运行工作继续 lease maintenance，直到写入 terminal proof 后退出；正常 signal shutdown 的状态依次发布为 `online -> draining -> offline`。
6. daemon runner 返回或失败时必须释放 instance lock。残留 socket 在不能建立连接时可清理并重新取得。
7. credential revoke 是管理面强制 fencing：revoke 事务直接把对应 Host heartbeat 记录标记为 `offline`，旧 context 的 abort/offline cleanup 不得抛出未捕获异常。它可以跳过正常 drain，也不承诺当前 runtime 能用已撤销权限写 terminal proof；后续仍依靠 lease expiry、orphan/quarantine 和 recovery 对账。

## 结果

- 浏览器、配置文件或 runtime adapter 不能通过伪造 `hostId/participantIds` 扩权。
- 同一 Host 的常规本机重复启动 fail closed；窗口退出与 daemon 生命周期保持分离。
- graceful shutdown 不把 process signal、CLI exit 或 lock release误认成业务完成。
- Host credential 可以通过先签发新 token、让新 context heartbeat、再撤销旧 token 完成手工轮换；旧 schema heartbeat 会在 migration 时先 fail-safe 置为 offline。

代价是 Host 配置必须安全携带 token，Unix socket 路径需满足平台长度限制，测试与 fixture 必须显式 provision/authenticate Host。

## 声明边界

- Unix socket 不是跨机器锁，也不是敌对同用户进程的强隔离；Activation 和 RuntimeProcess lease 才是业务 fencing。
- 当前 stale socket 清理证明的是确定性失败路径，不是对两个进程同时争抢同一 stale artifact 的形式化线性化证明。未来 packaging gate 应加入双进程 cold-start/crash 压力测试；若需要更强保证，应增加带 generation 的 Kernel Host-instance lease。
- 当前 credential scope 只有 Host ID 与 participant 白名单，尚未包含 RuntimeProfile、worktree、Provider capability 或设备证明。
- token 尚无 Keychain loader、自动 expiry/rotation、受认证管理 API 或 revoke audit event。
- 当前只有 lifecycle wrapper 和 signal bridge，没有 launchd plist、签名/公证安装包、版本握手、升级超时 cancel policy 或 control endpoint。
- drain 保证当前受监督运行完成后退出；它不保证逃离原 POSIX process group 的 daemonized descendant containment。该边界仍由 ADR-0003 约束。

## E1 门禁

- 伪造 Host context 被拒绝，越 scope participant 不能领取 lane。
- credential revoke 同时 fence 旧 context 和新 token authentication。
- credential revoke 与 daemon shutdown 并发不会产生未捕获异常或永久 `online` 记录。
- live instance 拒绝竞争者，释放后可重新取得，stale artifact 可恢复。
- lock identity 必须匹配 authenticated Host，lock directory symlink 被拒绝，cleanup 失败后 daemon 对象仍可重试。
- process signal listener 在退出后移除。
- active Activation drain 期间保持 `draining`、继续续租、不 cancel 当前 runtime，也不领取 follow-up Activation；terminal proof 后 Host 进入 `offline`。
