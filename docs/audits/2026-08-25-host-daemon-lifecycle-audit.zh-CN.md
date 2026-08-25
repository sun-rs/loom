# Host 认证与 Daemon 生命周期独立审计

日期：2026-08-25
范围：Host credential/context/revoke、`AgentHostDaemon`、Unix instance lock、signal/drain、相关测试和 ADR-0004
最终结论：**ACCEPT WITH CONDITIONS**（无 P0/阻断项）

## 1. 独立审计发现

首次审计确认 Host mutation 已从 authenticated context 派生 `hostId/participantIds`，未发现越权业务 mutation 或重复执行路径；同时发现：

- credential revoke 与 drain 并发可从 AgentHost abort listener 抛出未捕获认证异常，并让 Host 状态永久停在 `online`；
- instance-lock `release()` 抛错时，daemon 的 `running` 标志不能复位；
- daemon 接受与 authenticated Host 不一致的 lock key；
- lock directory 使用 `stat`，未拒绝 symlink；
- runner 与 cleanup 同时失败时，cleanup error 覆盖主错误；
- Host 状态只按 `host_id` 保存，撤销旧 credential 会把已切换到新 credential 的 live Host 误标 offline。

这些问题未绕过 Activation/RuntimeProcess lease，因此不是业务双开 P0；前两项会破坏生命周期声明，按 P1 优先处理。

## 2. 修复与复核

本轮已增加失败测试并修复：

- revoke 事务会 fence token/context；只有被撤销 credential 正是该 Host 当前 heartbeat generation 时，才把 Host 置为 `offline`；
- `agent_hosts.credential_id` 记录当前 generation；legacy 表初始化时新增该列并将无法归属 generation 的旧 heartbeat fail-safe 置为 offline；
- AgentHost 的 revoke+abort/finally 不再产生未捕获认证异常；
- daemon 在 cleanup 失败时也无条件复位 `running`，可再次调用；
- runner 与 cleanup 双失败用 `AggregateError` 同时保留；
- lock 暴露规范化 immutable Host identity，daemon 构造时与 authenticated Host 精确比对；
- lock directory 改用 `lstat` 并拒绝 symlink、非目录、错误 owner/mode；
- 新增 credential rotation、legacy migration、revoke+shutdown、release failure retry、dual failure、identity mismatch 与 symlink 回归测试。

独立微复核确认上述闭环正确，定向测试 28/28 通过。

## 3. 已确认的不变量

- Host token 是 256-bit 随机值，数据库只保存 SHA-256 hash。
- `AuthenticatedHostContext` 普通构造和 object-literal 不能伪造，context 冻结并由内部 issuance proof 标记。
- 每次 Host mutation 重新查询 active credential；旧 context 在 revoke 后立即失效。
- Host ID 与 Agent participant scope 不再由调用者在 mutation 中自报。
- 正常 signal drain 不取消 active runtime、不再领取 follow-up，并持续维护 lease；terminal proof 后才退出。
- credential revoke 不是正常完成：无法再持久化 terminal proof 的运行仍由 lease expiry、orphan/quarantine 与 recovery 对账。
- Unix socket 只做本机启动协调，业务 lane 仍由 Kernel lease fencing。

## 4. 剩余非阻断条件

1. daemon 为确保 shutdown 继续执行，会吞掉 draining/offline heartbeat 的非认证类故障；production logging/health endpoint 应保留并报告这些次级错误。
2. fake lock 已覆盖 release failure 与 retry，但真实 Unix socket 在 `close/remove` 中途失败后的 filesystem fault injection 尚未完成。
3. stale socket 的 `probe -> unlink -> bind` 仍有双进程 TOCTOU；ADR-0004 已禁止把它宣称为形式化线性化锁。packaging gate 必须增加双进程 cold-start/crash 压力；更强保证应使用 Kernel Host-instance generation lease。
4. 仍没有 launchd、Keychain loader、签名/公证安装包、版本握手、升级超时 cancel policy 或 daemon control API。

这些条件不改变 E1 结论，但在对外称为“可安装生产 daemon”前必须处理或有明确平台约束。
