# POSIX 进程监督器独立复审

- 审计日期：2026-08-25
- 审计方式：由未参与实现的独立 Agent 阅读源码、运行全套门禁并执行额外故障复现；审计者未修改仓库
- 结论：**ACCEPT WITH CONDITIONS**

## 1. 结论

上一轮审计的两个 P0 已关闭：

1. leader 退出不再直接生成 terminal proof；supervisor 继续探测原 process group，必要时升级至 `SIGKILL`，直到系统返回该 group 不存在。
2. target side effect 前已有 durable recovery capability；启动顺序改为 `supervisor prepared/no target -> RuntimeProcess(prepared) -> authenticated launch -> exact handle verification -> RuntimeProcess(active) + RunAttempt(running)`。

recovery lease 续租/attempt fencing、run identity 绑定、半开 socket、owner-private directory 与 diagnostics 背压问题也有对应实现和确定性测试。审计未发现新的 P0，因此不阻止进入下一开发阶段。

但当前能力必须准确称为：

> owner-authenticated、run-bound、原 POSIX process-group recovery E1。

它不是任意 process-tree containment，也不是实际 Provider CLI 的 E2 certification。

## 2. 已关闭问题与证据

| 上轮 finding                                     | 复审判断 | 当前证据                                                                                                                     |
| ------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| leader `close` 后可能过早签 proof                | 已关闭   | leader-first + 同组顽固 descendant fixture；只有 group `ESRCH` 后写签名 result                                               |
| spawn 与 descriptor 持久化之间有 P0 crash window | 已关闭   | 两阶段 start；真实 AgentHost 在 launch 后、`run.started` 前被 `SIGKILL`，replacement Host 从 `starting + prepared` 对账      |
| recovery lease 不续租、旧 owner 可晚提交         | 已关闭   | recovery maintenance；renew/record/retry 都校验 `recoveryAttemptCount`；Fake clock 跨原 expiry，Kernel 拒绝旧 attempt        |
| proof/control 未绑定具体 run                     | 已关闭   | request 与 HMAC payload 同时绑定 protocol、supervisor UUID、RunAttempt ID、runtime Run ID 和 token                           |
| 半开 socket 阻塞退出                             | 已关闭   | connection timeout + terminal destroy fixture                                                                                |
| 临时目录权限不安全                               | 已关闭   | start 与 recovery 都检查 supervisor root、control root、per-run directory 的 owner/type/symlink/mode；非私有目录 fail closed |
| diagnostics 背压可影响 lifecycle                 | 已关闭   | forwarding 允许丢弃且 output error 不进入权威状态机                                                                          |

组合测试证据需保持分开：跨进程 Generic fixture证明 crash handoff 与 process-group recovery；Fake Host/Kernel fixture 分别证明 lease renewal 和 attempt fencing，不能写成同一个 fixture 已覆盖全部故障维度。

## 3. 剩余 P1：escaped descendant

审计者新增 `setsid`/detached descendant 故障实验后观察到：

```json
{
  "exit": { "code": null, "signal": "SIGTERM" },
  "escapedDescendantAliveAfterProof": true
}
```

该 descendant 已进入另一个 process group，因此原 PGID 返回 `ESRCH` 时，supervisor 对“原 group 已清空”的 proof 是真实的，但不能推出任意后代都已退出。这是纯 POSIX process-group 的 containment 边界。

约束：

- 文档与 UI 只能声明原 process group 清空；
- 真实 CLI E2 gate 必须检查其是否 daemonize、double-fork 或主动 `setsid/setpgid`；
- 强 containment 应评估 Linux cgroup v2、macOS 平台进程跟踪/容器或其他经故障注入证明的原生 primitive；
- 在强 containment 完成前，不得把 Generic proof 表述为任意“process tree 已清空”。

## 4. PGID reuse 与其他限制

descriptor 与 replacement Host 不持久化或信任 PID/PGID，恢复身份来自 UUID、token 和 HMAC；supervisor 只在自身存活期间操作它创建的 PGID。因此 PGID reuse 不撤销当前受控 E1。

不过，在极端 PID churn 或小 PID namespace 中，group 清空与下一次 poll 之间仍存在编号复用的理论窗口。当前实现不能宣称形式化的“绝不误杀”。此外，supervisor 自身被 `SIGKILL`、整机断电、artifact 安全 GC、Windows Job Object、Host credential 和同用户恶意进程隔离仍未完成。

通用 `RuntimeAdapter.recover` 后续还应明确为单调、幂等的 terminalization，或引入可中止信号；当前 lease maintenance 失败后不能强制停止任意第三方 adapter 已开始的 Promise，但 attempt fencing 会阻止其过期写入 Kernel。

## 5. 验收决定

审计决定为 **ACCEPT WITH CONDITIONS**：当前实现足以作为窄定义 POSIX process-group recovery 的 E1 基线，并可继续下一阶段；条件是保持上述声明边界，将 escaped descendant 与 PGID reuse 纳入后续平台 containment 门禁，不得提升为真实 CLI 或任意进程树的生产保证。
