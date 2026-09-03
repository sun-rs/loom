# 本地 Runtime 留存、分页与空闲调度审计

日期：2026-09-03

当前裁决：**通过。代码、全门禁、隔离浏览器、正式数据重启与正式浏览器复核均已完成；1h/24h soak 仍作为运行证据继续积累，不阻塞本批发布。**

## 1. 审计范围

本审计复核：Web generation 无界堆积、Runtime probe history 无界物化、daemon 空闲高频扫库和 barrel import
驻留成本。业务上的 Room/Task/Memory/通知行为不在本批重写。

来源、采用点和拒绝点见
[产品合同](../product/2026-09-03-local-runtime-retention-and-wake-contract.zh-CN.md)。结论不是凭 RSS 单点得出：同时使用
进程 CPU、RSS、`vmmap -summary` physical footprint、heap snapshot 和代码 owner 追踪。

## 2. 已发现原因

正式旧进程在无 active work 时，AgentHost fallback 为 250ms；本机 4 lane 各自执行 orphan recovery、heartbeat、
schedule 和 claim。Outbox 又以 100ms 扫描。现场 22 秒旧正式实例 CPU 样本大多为 2.4%–4.1%，并出现 8.2% 短峰；
RSS 约 620,032 KiB，physical footprint 417.3 MiB。

隔离 heap snapshot 约 55 MiB；高 RSS 的主要差额是模块代码、native 映射和大量可回收 allocator page，而不是同量级
retained JS heap。`@rah-os/daemon` barrel 的 eager module graph 是一部分固定成本，但窄
`@rah-os/daemon/local-workbench` 入口只把隔离 physical footprint 由约 242 MiB 降至约 223 MiB，不能把它夸大为
根治。

## 3. 修复与证据

### 3.1 空闲 cadence

参考 Raft wake 合同和 Multica 30s fallback，把正式 local workbench 改为：

- AgentHost fallback `30_000ms`；
- durable Outbox dispatcher `250ms`；
- 仍由既有 `LocalWakeSignal` 立即中断长 wait。

定向集成测试故意使用 60 秒 fallback，实际 Outbox 消息在约 1.04 秒内完成 fake Activation，证明交互延迟没有依赖
fallback。新隔离 4-runtime 实例连续跨三个 30 秒周期采样：CPU 平时 0.0%–0.2%，只有 reconciliation 边界出现短峰；
约 80 秒后 RSS 394,416 KiB，physical footprint 240.2 MiB，低于 303.4 MiB 的观察峰值。RSS 仍随临时分配升高，
但 physical footprint 回落，符合 allocator 可回收页而非单调 retained leak。

这证明短期 CPU 放大已关闭；它不能替代 1h/24h soak，也不能证明所有 macOS allocator page 会立即归还 RSS 指标。

### 3.2 Probe history

新增 opaque keyset cursor、1..200 limit、revision scope fence 和全局顺序索引。5 份同时间戳 report 按 2+2+1 分页，
无重复/遗漏；cursor 跨 revision 重放与 limit 201 均拒绝。兼容入口由无界 `.all()` 收紧为最多 200 条。

### 3.3 Web generation retention

新增进程 lease、崩溃 lease 清理、互斥锁、4 代保留和 10 分钟新鲜窗口。自动化构造 5 个真实 hash generation：
被 lease 的最老代与最新两代保留，其余旧代删除；释放 lease 后最老代可回收。清理仅在 workbench gateway 成功启动后运行。

现场人工清理前 `.workbench-web` 约 1.9 GiB、用户备份约 6.0 GiB。保留当前/上一发布代及一份已验证备份后，分别降到
约 33 MiB 与 52 MiB；APFS 可用空间从约 274 GiB 增至 279 GiB。另删除本批隔离 heap/idle probe 临时目录 114.4 MiB。

## 4. 未扩大声明

- 尚未完成 1h/24h daemon soak；当前只证明空闲 CPU 路径和短时 physical footprint；
- 没有为减少内存而删除 Runtime/Provider 能力，窄入口是固定启动成本优化；
- 发布 GC 不碰用户 `~/.rah`、Room Files、Agent Memory、Provider sessions 或显式外部静态目录；
- 本批没有 UI 产品变更；正式浏览器复核只验证现有页面在重启后仍能恢复、导航和读取 canonical state。

## 5. 正式发布复核

### 5.1 门禁与发布

- `npm run check`：通过；Web/合同 244/244、parity regression 34/34，其余 package suite 同批全绿；
- `npm run format:check`、`git diff --check`：通过；`npm audit --omit=dev` 为 0 漏洞；
- `npm run test:web:build-recovery`：真实 Chromium 的 1280×800 与 390×844 均通过，旧 build 提示、继续、刷新及 typed deep link 保留均符合合同；
- `npm run test:web:workbench`：真实 Chrome 390×844 下 production build、fake Agent reply、持久重启、provider session resume 和浏览器无缝重连通过；
- `npm run test:web:browser`：真实 Chrome 完成 1440 桌面与 390×844 全行为门禁，无未捕获浏览器异常；
- 实现提交 `d2cada2` 已推送 `origin/main`。

### 5.2 正式数据与重启

停机前直接读取正式 Room DB：30 个 Activation 全部 `completed`，30 个 run attempt 全部 `exited`，无 pending
InputRequest、无 active exclusive-operation lease；唯一 Task 为 `submitted`，没有在执行中的工作。随后向 PID 22701
发送 `SIGTERM`，4173 listener 在 1 秒内退出。

离线备份写入
`~/.rah/backups/pre-local-runtime-retention-20260903-Bj6cGi`，包含 canonical Room/Task/Memory、附件、凭据配置和
provider session，刻意排除约 543 MiB 可再生 process output 及派生索引；`room.db`、`runtime-registry.db`、
`web-push.db` 均通过 `PRAGMA quick_check`。

正式实例随后以 PID 25368、四个本地 runtime 和原 workspace/Room identity 恢复在 `127.0.0.1:4173`。HTTP 200，
`x-rah-web-build-id=a9c6c707e026e31b98c15320d42dbb6a1e3addd18bf6492b04700faf55a552d8`。正式可见 Chrome 复核：

- 原 Room 历史、链接、消息回复/回应/收藏动作和已提交 Task #1 可读；历史报数 1→10 保持完整；
- 点击 Agent 姓名得到 `@Kimi `，清空草稿后未产生消息；点击头像打开默认“动态”资料页，动态成功读取跨 Room
  structured runtime events；切换另一私信后旧资料页关闭且草稿为空；
- 全局 Tasks 显示 1 个 draggable shell 与 1 个 Pencil 状态入口。

重启后、可见 Chrome 连接且跨过多个 30 秒 reconciliation 周期时，CPU 样本为 0.5%–1.8%，RSS 约
425 MiB，macOS physical footprint 255.8 MiB、观察峰值 317.8 MiB。相较修复前正式空闲 2.4%–4.1%（短峰
8.2%）与 417.3 MiB physical footprint，空闲扫描放大已经显著收敛。当前不可变 Web release 恰为 4 代，符合
默认留存上限。

### 5.3 有限结论

本批可发布，但不把约三分钟正式样本包装成长期 soak。剩余运行证据是 1 小时与 24 小时采样；若出现 physical
footprint 单调上升或 30 秒边界外持续 CPU 峰值，应以 heap/`vmmap` 和 canonical work counters 联合诊断，不能只看
RSS。
