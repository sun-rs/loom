# PROTO-HARDEN-0 交付结果

`npm test` 最终 **231 项通过，0 失败、0 跳过、0 取消**。实际 loomd 的 60 个 SIGKILL 注入点通过，另有 SQLite 热回滚与提交后损坏、真实 OAR 子进程退出、隔离 hc 重启和 1,000 条混合并发实测。协议新增「保证与非保证」及代码、状态和持久化逐项对账。 [协议](../../docs/PROTOCOL-v2.md) · [全量日志](/Users/sun/Code/exp-relay/proto-harden-0/npm-test-combined.log) · [注入点与运行目录](/Users/sun/Code/exp-relay/proto-harden-0/fault-matrix.json)

## 保证 → 测试 → 结果

| 保证 | 测试 | 结果 |
| --- | --- | --- |
| G1 单写者，relay 集成 | 强杀 loomd 后三进程争抢遗留锁；测试活动进程状态 | 仅一进程成功接管。relay 跟随 loomd 恢复，状态可查询。 |
| G2 接管、回复和幂等 | 请求意图、尝试、原生 ACK、接管、回复提交前后强杀；复用 ID；篡改同 ID 正文 | 有原生证据的输入和自动回送各一次。同 ID 同请求回到原记录，不同请求返回 `id-conflict`。写入可能性不明时保留原正文与意图，原生尝试为零或一次，升级通知可查。 |
| G3 共享账本、FIFO 和忙时等待 | 两个发送方并行提交，headless 目标持有活动轮，另一方送往 TUI | 1,000 次接管、1,000 次原生投递、1,000 次可归属回复。两端各 500 条，各自顺序正确，少发和重复均为 0。 |
| G4 根轮归属、早完和 ACP | worker 先于封存结束；同根轮回送去重；真实 OAR ACP 仅发文本块和 prompt 结束 | 早到结果完整合并一次。ACP 产生一次 `UNCONFIRMED` 波次通知，文本保留，无确认正文或 `answered`。 |
| G5 封存、窗口、超时与补投 | Leader 缺轮末；长挂 worker；重派跨波；同波跨轮补派；部分窗口；正常迟到 | 缺轮末可以封存，Leader 可写后有一次超时唤醒。未完成成员含 `STUCK` 与最近活动时间。正常迟到补投一次，旧波重派结果标 `superseded`，同波跨轮补派拒绝。 |
| G6 BLOCKED、抄送及证据 | 两个 BLOCKED、一个已完成、一个挂起；全员短窗内完成；FAILED/MISMATCH 对照；证据与交接文件发布前后强杀 | 短窗内全员完成只唤醒一次。挂起场景一次提前汇总、一次仅含剩余结果的最终汇总，跨 loomd 重启不重复。Auditor 只收 FAILED 或 MISMATCH，混合批次也不会带入 BLOCKED 正文。证据及交接记录各一份。 |
| G7 指定轮中断及目标退出 | 中断意图、ACK、确认阶段前后强杀；目标轮更替；真实 OAR 子进程 SIGKILL | 匹配的取消轮末可从原生 Codex 记录恢复并续投一次。更替后的轮保持运行，已退出目标的待投请求带原因保留。 |
| G8 存储和重挂 | SQLite 未提交事务页已写入后强杀；SQLite 坏头；OAR/watch JSONL 截半行；relay 归档、批次入箱和出箱前后强杀 | SQLite 回滚至原已提交行，稳定损坏拒绝启动且原文件保留。可恢复 JSONL 完整前缀和跨账本批次。真实 hc 重启后同一 PTY 链路继续工作，原生投递各一次。 |
| G9 headless 状态与告警 | 检查 `busy`、`idle`、`stuck`；静默、429；通知、交接落盘边界；外部领取 | 卡死和限流分别形成一个边沿。可查看 Leader 退出、显式项目完成、投递 UNCERTAIN 和波次超时。第二次领取为空。 |
| G10 同会话续作 | 反序完成；显式和自动分组各测两个 BLOCKED 加完成成员与挂起成员 | 提交顺序保留。短窗前零次唤醒，短窗结束一次，余下成员结束再一次；各成员正文只出现一遍。 |
| G11 TUI 草稿守卫 | 原 `replay-inbox.mjs` 的四个真实草稿帧；缺少 hook、过期 Stop 与不完整屏幕；空闲恢复 | **0/4** 误发。未知或冲突时保留等待和证据，再次确认双空闲后只投一次。 |

## 逐条回应补充审查

| 项 | 结论 |
| --- | --- |
| Auditor 1 · 跨通道账本 | 波次 outbox 以批次和目的地址派生 inbox ID。进同一 inbox 后才选 hc 或 OAR。同根轮首轮波次与单发回复也做去重。 |
| Auditor 2 · 封存兜底 | 缺 Leader 根轮结束或中断记录时，从最早登记算起触发兜底封存，继续按整波和部分窗口结算；通知耐久保存。 |
| Auditor 3 · relay 生命周期 | 受管 relay 由 loomd 调度，`daemon status` 报 `integrated/degraded`。没有单独的 relay 进程需重启。 |
| Auditor 4 · headless 永不结束 | 对静默忙轮和限流做巡检，波次截止时把成员及最近活动作为 STUCK 报给 Leader。 |
| Auditor 5 · ACP 最终边界 | 缺边界时只存未确认正文，`--wait` 不返回已答复的成功回执，波次保留清楚标记。 |
| Auditor 6 · 登记来源 | 使用受管会话索引和崩溃恢复的 spawn 意图，`workers.md` 每次作为生成视图校正；测试手改虚构成员不会入波。 |
| Auditor 7 · 活跃 headless state | 实测 OAR 会话的空闲、忙碌和异常状态，投递账本可同时查看。 |
| Auditor 8 · Claude 确认 | 对账只用可归属的唯一原生标记和完成边界；相同裸正文以及 hc ACK 均不会建立送达。 |
| Auditor 9 · 实测 | SIGKILL、1,000 条并发、缺失封存、永久挂起、无最终边界均有实跑或确定性测试。永久缺证据时保留与告警，不能虚构原生接管。 |
| Leader A · 运行和索引 | 修订 Claude 顶层 TUI 与 headless 的入口标签描述，明确保留 `transcriptPath`、`account`、`baseCommit`。 |
| Leader B 与 Super 决议 · BLOCKED | `LOOM_BLOCKED_COALESCE_MS` 默认 60,000。聚合首个 BLOCKED 后同窗可用结果，最多一次提前唤醒，随后仅结算剩余成员。Auditor 只收 FAILED/MISMATCH 成员。 |
| Leader C · 跨轮重派 | 同波跨根轮补派返回 `wave-sealed`，新波有独立身份。 |
| Leader D · 同会话续作 | 保留 `--batch UUID --batch-size N`，同项目 Leader 的在途 queue 续作也可自动分组，两者均走同一 BLOCKED 窗口。 |
| Leader E · 最近活动和 superseded | 超时通知附成员最近活动。新波已登记后，旧结果继续归档，已排队尚未发出的旧补投以 `superseded` 结束。 |
| Leader F · UNCERTAIN | 默认 60 秒后以原投递 ID 一次性登记外部通知，父会话或原来源可达时另入其收件箱。 |
| Leader G · 429 和静默 | headless 429/配额和静默忙轮均纳入巡检，重启保持单边沿。 |
| Leader H · 外部 Super | `loom state` 可预览，`loom notifications --project DIR` 一次领取。项目完成由 `node daemon/notifications.mjs --project DIR --complete` 显式登记。 |
| TUI-REL-0 紧急补充 · 双空闲 | 发键要求完整可见空屏和同会话结构化空闲证据。TUI steer 降级到 queue，TUI interrupt 拒绝，撤掉 OpenCode 滞留草稿的补 Enter。原回放程序已纳入 `npm test`。 |

## 实测与清理

- Node 25.9.0 与锁定的 OAR 0.130.1。并发压力验证使用真实 loomd、OAR 及会话脚本，TUI 端采用记录实际调用的 hc 替身。两种输入通道都启用最终可写判定。 [逐条比对汇总](/Users/sun/Code/exp-relay/proto-harden-0/lh-a2WfNg/verified-concurrency.json) · [压力日志](/Users/sun/Code/exp-relay/proto-harden-0/stress-strict-tui.log)
- 在隔离 hc 0.1.22 服务里，脚本扮演 TUI Leader，headless worker 经真实 OAR 和脚本 app-server。第一次 SIGKILL 在 hc 原生 ACK 写入后，原请求重交后窗格实收一次。第二次在波次入箱后，随后重启 hc 和 loomd，原窗格实收一份波次和一份重复提交后的单发请求。窗格已 `hc kill` 并核对为 `finished`，隔离服务已停止。 [实测](/Users/sun/Code/exp-relay/proto-harden-0/hc-smoke-C8y2zp/verification.json) · [窗格清理](/Users/sun/Code/exp-relay/proto-harden-0/hc-smoke-C8y2zp/cleanup.json) · [服务清理](/Users/sun/Code/exp-relay/proto-harden-0/hc-core-cleanup.json)
- 公共 CLI 验证了活跃 headless 的 `loom state`、`send --id --wait` 原样重交，以及 `loom notifications` 预览和一次提取。 [CLI 实测](/Users/sun/Code/exp-relay/proto-harden-0/cli-verification.json)
- 真实草稿回放在本卡实测目录执行。Codex 启动 hook 用当次启动参数和脚本输入核对，Claude/OAR 及 GUI 厂商型号均未使用账户实跑。 [草稿回放](/Users/sun/Code/exp-relay/proto-harden-0/tui-draft-replay.jsonl) · [Codex 生命周期事件](https://developers.openai.com/de-DE/docs/hooks)
- 并行期间，CLEAN-0 删除独立 relay 启动器并迁移 TUI 的导入。保留这些改动，受管路径在 `relay/project.mjs` 执行。LOOM-UX-1 同时增加 `waveKey`、`waveKind` 和历史字段，重新读取后按共有字段接入。早期全量运行碰到 Claude runtime 的并行测试失败，独立重跑及最终全量已通过。无 Git 提交。

## 仍存在的非保证

- 跨进程原生写入与持久证明之间没有原子提交。原生信号永久缺失时，账本保留原意图并发告警。永久不可写、已经退出或持续未知的会话无法被保证实际唤醒。
- TUI 再次核对同轮信号及完整屏幕后才写入。hc 没有原子按帧写入接口，核对与发键之间的人为抢输入仍存在竞态。缺结构化启动证据的空窗（例如只有首轮 PreInvocation/Stop 的 agy）会等待可验证的原生轮末。TUI 厂商全部版本的实际登录和交互未覆盖。
- 超时只完成报告，不结束 worker。已发出的旧补投无法撤回，已接受者须按批次和成员身份处理。外部通知的领取在返回前落盘，RPC 断开时可能错过该次返回，账本保留通知档案。
- 覆盖会话或进程强杀、可恢复 SQLite 事务及 JSONL 尾损。任意已提交记录被破坏、介质丢失或跨机器灾备须从可信备份恢复。

STATUS: done
