# 首轮放置等待：发布工作区后再唤醒

2026-09-29。P51 的 Human 消息在 05:20:18.437Z 入账，placement.reserved 在 05:20:48.676Z；续轮放置仅约 87 ms。约 30 秒延迟位于模型运行之前。

## 原因与最小修法

Daemon 的 Outbox 激活提示直接调用 LocalWakeSignal；工作区刷新/Offer 发布是独立的周期任务或预热提示准备动作。新实例首次唤醒时挂载可能尚未发布，Host 领取为空而消耗提示；后续发布挂载本身没有再次唤醒 Host，直到 30 秒 reconciliation 兜底。预热关闭也不能让业务依赖其提示执行顺序。

沿用现有 Raft/Multica 事件驱动唤醒、本地 durable Outbox 和 Host 工作区所有者，不新增队列/游标、不缩短轮询：activation.requested 的发布先刷新并发布当前 Host 的工作区 Offer，再通知 Host。准备失败走已有 Outbox retry，不能把提示当成功发布。周期扫描仍处理提示丢失；所有放置、认证、单 lane、ACK 和 session 规则不变。这是本地接线修复，不宣称上游源码移植。

## 验证

新增免费时序回归：无预热的冷启动提示必须先发布挂载；首次刷新失败必须 retry，成功发布之后才 wake/ack。两条在修复前均失败（unplaceable-wake 后直接 ack），修复后通过。连同实例提示/预热接线测试共 5 条通过。完整检查、正式重启及首次调用复测另行记录；未完成前不宣称延迟已验收。

## 完成与正式复验

完整 `npm run check` 通过（核心 2,689 通过、22 跳过，其他 Web/控制台/门禁检查通过），`format:check` 和 `git diff --check` 通过。2026-09-29 13:51 CST 正式 evo 优雅重启，schema 79 不变；备份 `~/.loom/evo-backups/pre-restart-first-wake-2026-09-29T05-50-45.159Z` 经完整性校验，7 张业务表重启前后内容哈希一致，冻结前端未改，未恢复旧暂停/隔离工作。

P52：负责人授权的 Claude CLI → kimi-k3（sonnet 别名、low）新实例两轮正式调用：首轮 message.posted→placement.reserved 为 **267 ms**（P51 为 30,239 ms），续轮 **138 ms**。首轮消息至回复 14.920 s，续轮 12.807 s；运行阶段约 15.38/13.42 s，不能将模型本次耗时波动归因于唤醒改动。两次 Activation completed、各一次回复/运行；同一原生 session、generation 0、无 502；结束后无活动 RunAttempt。见[逐轮证据](evidence/2026-09-29-first-wake-latency.json)。这是针对固定首轮等待的业务回归，不是原生 CLI 全面效率门禁。

Chrome 正式页面访问因浏览器管理策略校验不可用被拒，未绕过、未报告页面验收通过。未提交或推送。
