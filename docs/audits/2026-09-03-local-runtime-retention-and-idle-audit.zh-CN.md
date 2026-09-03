# 本地 Runtime 留存、分页与空闲调度审计

日期：2026-09-03

当前裁决：**代码和定向性能审计通过；正式重启、全门禁与浏览器复核待本文末次更新。**

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

待全门禁、不可变 Web build、active-work 审计、离线备份、正式 4173 优雅重启及 desktop/390×844 实页完成后填写。
