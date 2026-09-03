# 本地 Runtime 留存、历史分页与事件唤醒合同

日期：2026-09-03

状态：已施工并通过正式发布复核

## 1. 目标与单一 owner

本批关闭三个会在长期运行中持续放大的本地问题，但不改变 Room / Inbox / Activation 的业务语义：

1. `.workbench-web` 的不可变前端发布物必须有界留存，同时绝不能删除仍被运行进程使用的目录；
2. Runtime probe 的不可变历史必须用有界、稳定的 keyset cursor 读取，兼容入口也不能一次物化全部历史；
3. AgentHost 的交互延迟由 durable `activation.requested` Outbox wake 负责，固定轮询只作丢 wake 后的恢复兜底，空闲时不得以 250ms 频率反复扫描 Room SQLite。

唯一 owner 固定如下：

- `scripts/workbench-web-assets.mjs`：发布目录、进程 lease、保留策略和清理互斥；
- `RuntimeProfileRegistry`：probe history cursor、scope fence、limit 和索引；
- `OutboxWakeDispatcher`：只消费 `activation.requested`，发布无正文 wake，成功后 ack，失败 durable retry；
- `AgentHost`：收到 wake 或 30 秒兜底到期后做 authoritative reconciliation；wake 本身从不等于 Activation。

## 2. 上游来源与采用裁决

### Raft

`raft-external-agents` commit `72c31894f933b9aa9243195d038d66ee79589593` 的
`docs/wake-endpoint-contract.md`（SHA-256
`40866e16160a5b89e5ef0e2624062b43bccacd5f2a19b393057642938d32b626`）明确：bridge 拥有
SSE/poll、seq 去重、stale prune、backoff/reconnect 和 reconciliation；wake 只携带 metadata，正文由 Agent
随后从 canonical API 读取；burst 应合并，但丢 wake 必须由 reconciliation 兜底。

冻结 `raft-computer-1.0.18` 的 `agentApiContract.ts`（SHA-256
`ce9db68aff56f34e56186cc8332d9b1dae74196422f113353de0a288915cf4db`）还证明 `/events` 返回
`last_seen_seq`、`wake_reason`、`has_more`，而不是把页面或 runtime 的暂态输出当作消息真相。

RAH 结构性沿用这套内容无关 wake 和 authoritative drain/reconcile 分工。Raft 中央 Server 的内部队列实现未取得，
不声称复制其事务代码。

### Multica

Multica commit `11861145abc59a0d39c8c8f24ad837d4584e664f` 提供了可直接监督本地 daemon 的成熟实现：

- `server/internal/daemon/config.go`：`DefaultPollInterval = 30s`；
- `server/internal/daemon/daemon.go` 的 `pollLoop/runBatchPoller`：整机单 poller，WebSocket task wake、runtime set
  变化和执行槽释放都折叠成容量为 1 的 nudge，轮询只是 fallback；
- `server/internal/daemon/reconcile.go`：close-and-replace channel、一次 replay 与 burst debounce，避免漏掉启动竞态且不制造请求风暴。

RAH 不复制 Multica 的 HTTP/PostgreSQL/Issue owner，只采用“即时信号 + 有界合并 + 粗粒度兜底”结构。当前本地 Outbox
已经是同等可靠性 owner，因此最小改造是把 AgentHost fallback 从 250ms 调整为 30s，并把 Outbox SQLite bridge 从
100ms 收敛为 250ms；不是再建一条 WebSocket 队列。

### RAH 本地 glue

发布目录 lease/GC 是 RAH 不可变静态快照与本地重启方式产生的部署问题，Raft/Multica 没有同前置可直接复制的模块。
它只允许清理由 64 位十六进制内容 hash 命名、且位于仓库 `.workbench-web` 的直接子目录。

## 3. 不变量

### 3.1 Web 发布物

- 启动前为选中的内容寻址目录写 owner-private 进程 lease；成功启动后才清理；停止后释放；
- GC 与 lease 变更共用互斥锁；崩溃遗留 lease 以 PID liveness 回收；
- 永远保留最新 4 代、所有 live lease 和最近 10 分钟的发布物；只删除其余 hash 目录；
- 外部显式 `RAH_WEB_STATIC_DIRECTORY` 不属于仓库发布仓库，不加 lease、不清理；
- 删除前再次 `lstat`，目录变成链接或其他类型时 fail closed。

### 3.2 Probe history

- cursor 为 canonical base64url、schema v1，并绑定可选 `runtimeProfileRevisionId` scope；
- 排序身份为 `(observed_at, probe_report_id)`，同一时间戳也不重复、不跳页；
- 默认 50、最大 200，读取 `limit + 1` 判断 `nextCursor`；旧 `listProbeReports` 只保留最多 200 条兼容结果；
- 全局 `(observed_at, probe_report_id)` 与 revision-scoped 索引分别服务两条查询；
- 错误格式、非 canonical 编码、超限、跨 scope 重放全部 fail closed。

### 3.3 Idle scheduling

- Outbox 事务仍是投递真相；wake 只提前结束 wait；
- 正常新 Activation 的延迟上界由 250ms Outbox scan 加本地处理决定；
- 100% wake 丢失时，30s fallback 仍会恢复；该值小于 60s Host stale/lease 边界；
- Runtime 执行中的 lease renewal 使用独立 maintenance cadence，不因 idle fallback 放慢；
- 不通过追加模型 prompt 或 Agent 自我判断降载，因此不增加模型上下文负担。

## 4. 回滚与验收

- cadence 回滚只需恢复配置数值，不改数据库；
- cursor 是只读接口；旧调用方仍可读取前 200 条，不会触发破坏性迁移；
- 新索引通过 `CREATE INDEX IF NOT EXISTS` 在 registry initialize 时补齐；表与不可变报告均不重写；
- 发布物清理只在新 gateway 成功监听后发生，最新 4 代和 live generation 构成回滚窗口。

自动化必须覆盖 live lease、保留窗口、同时间戳 cursor、scope mismatch、limit、安全索引，以及 60s fallback 下
Outbox wake 在 2s 内完成 fake Activation。真实性能验收必须同时记录 CPU、RSS 和 macOS physical footprint，不能把
可回收 allocator 页误写成 retained heap。
