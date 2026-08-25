# ADR-0003：身份安全的 POSIX 进程监督器

- 状态：Accepted
- 日期：2026-08-25

## 背景

AgentHost 可能在 CLI 仍运行时崩溃。Kernel 会把对应 RunAttempt orphan、隔离 Activation，并让兼容 RuntimeAdapter 竞争 recovery lease；但旧 `generic-process-direct-v1` 只保存 PID/PGID。PID 会复用，重启后的 Host 若直接向持久 PID 发信号，可能误杀已经占用该编号的无关进程。

恢复协议需要同时满足：原 Host 退出后仍可用；新 Host 能验证它连接的是原 run 的 owner；错误或过期 descriptor 必须 fail closed；只有受 supervisor 管理的目标 process group 真正退出后才能产生 terminal proof。Provider stdout、JSONL 和 session 均不能参与该判断。

## 决策

- POSIX GenericProcessAdapter 为每个 Run 启动一个独立的最小 supervisor。supervisor 先进入 `prepared` 状态并监听控制通道，此时尚未启动目标 CLI。
- `RuntimeAdapter.start` 必须先通过 lifecycle callback 将 opaque recovery descriptor 持久化为 `RuntimeProcess(prepared)`；只有该事务成功后，adapter 才向 supervisor 发送 authenticated `launch`。返回 handle 必须与已持久化 handle 完全一致，随后 Kernel 才原子推进 `RuntimeProcess(active)` 和 `RunAttempt(running)`。
- supervisor 在 owner-only、非 symlink 的目录中创建 mode `0600` 的 Unix domain control socket。descriptor 只持久化随机 UUID recovery key 与 256-bit control token，不持久化可用于恢复决策的 PID/PGID；新 Host recovery 时会重新检查 supervisor root、control root 与 per-run directory 的 owner/mode。
- control request 同时验证 protocol、supervisor UUID、RunAttempt ID、runtime Run ID 与 token；token 比较使用 constant-time primitive。错误 identity/token 只返回认证失败，不向目标进程发信号。
- supervisor 在生成目标进程环境前删除自己的 config/token，CLI 不继承控制凭据。
- authenticated `terminate` 先向目标 process group 发送 `SIGTERM`，宽限期后仍存在则发送 `SIGKILL`。leader 的 `close` 不能证明 descendant 已退出；supervisor 持续探测整个 process group，只有系统返回“不存在”才生成 terminal result。
- supervisor 原子写入带 HMAC-SHA256 的 terminal result；签名 payload 绑定 supervisor UUID、RunAttempt ID、runtime Run ID 和 exit。新 adapter 可在 supervisor 已退出后验证并重放同一 terminal proof。
- orphan recovery lease 在 recovery 执行期间周期续租；续租、成功证明和 retry 都必须匹配 `recoveryAttemptCount`，旧 attempt 不能提交新 lease 下的结果。
- 未认证的半开 control connection 有超时，terminal shutdown 会主动销毁它，不能阻塞 supervisor 退出。stdout/stderr forwarding 允许背压下丢弃，只属于观察平面。
- GenericProcessAdapter 仅在 POSIX 声明 `rah-process-supervisor-v1` recovery driver。Windows 暂时保留 direct process 行为且不声明跨重启恢复，直到 Job Object/tree-kill 方案通过独立门禁。

## 已证明的不变量

确定性 E1 fixtures 分别证明：

- 跨进程 fixture 在 target 已启动但 `run.started` 尚未写入时 `SIGKILL` 真实 AgentHost；crash 前 descriptor 已是 `RuntimeProcess(prepared)`，lease expiry 会把它 orphan/quarantine，而不是启动第二个 runtime；
- crash 后 supervisor 与目标 CLI/同组 descendant 仍存在，replacement Host 使用正确 descriptor 后完成认证清理；
- 新 GenericProcessAdapter 使用错误 token 或不匹配的 runtime identity 时被拒绝，目标 process group 不受影响；
- 使用正确 descriptor 时执行 `SIGTERM`→`SIGKILL`，即使 leader 先退出，仍等待留在该 group 的顽固 descendant 消失；
- 独立 Fake Host/Kernel fixture 证明 recovery 跨越原 lease 到期点时可以续租，旧 attempt 被 fencing；
- supervisor 退出后，签名 terminal result 仍可再次校验；
- supervisor config/token 不出现在目标 CLI 环境中；
- 未认证半开 socket 不会阻塞 terminal cleanup，启动和 recovery 遇到非 owner-private supervisor directory 都会 fail closed。

这证明的是受控 POSIX fixture 的 identity-safe recovery，不是任何真实 Provider CLI 的 E2 certification。

## 后果与限制

优点：

- recovery identity 不依赖可复用 PID；
- AgentHost 与 supervisor 生命周期分离，Host hard exit 不丢失控制入口；
- target spawn 前已存在 durable recovery capability，消除了“spawn 已发生但 descriptor 尚未登记”的已知窗口；
- Kernel 仍只保存 opaque descriptor 与 terminal proof，进程协议不进入业务状态机；
- 未知 CLI 无需 transcript parser。

代价与剩余工作：

- supervisor 是每 Run 一个额外 Node process；后续可用实测数据决定是否演进为单一长期 supervisor service。
- supervisor 仍以存活期间掌握的 POSIX process-group ID 做组清空探测；descriptor 不持久化该 ID，但极端 PID namespace reuse、subreaper/container 边界仍需独立故障注入，必要时演进为稳定 sentinel、cgroup 或平台原生进程容器。
- 任意 descendant 可以主动调用 `setsid`/double-fork 逃离原 process group；当前 proof 不覆盖此类 daemonized escape。真实 CLI 在声明强 tree-containment 前必须通过逃逸 fixture，Linux 应优先使用 cgroup v2，macOS 需评估平台原生 process tracking/containment。未通过前只能声明“原 process group 已清空”。
- `SIGKILL`、内核故障或主机断电仍可能让 supervisor 来不及写 terminal result；此时系统继续 quarantine，不能猜测进程已经死亡。
- signed result/run directory 尚缺 durable acknowledgement 后的安全垃圾回收策略；不能用任意 TTL 删除仍可能是唯一 terminal proof 的文件。
- 打包器必须保证 `process-supervisor.mjs` 与 adapter 一起分发；daemon/package conformance 尚未建立。
- control token 当前位于 Kernel 的 opaque recovery descriptor 中；Host credential、DB at-rest protection 与本机同用户恶意进程隔离仍未实现。
- Windows Job Object、真实 Provider CLI、Host 整机重启和完整故障矩阵尚未验证。

## 禁止事项

- 不允许重新引入“从持久 PID/PGID 直接 kill”的 recovery fallback。
- 不允许把 socket 存在、control response、wrapper exit 或 CLI exit 0 单独当成 Task/Activation 完成。
- 不允许把 control token 放入目标 CLI 的 argv、stdout/stderr 或环境。
- 不允许因 result 缺失而推断目标进程已死亡；必须 fail closed 并保留 quarantine。
