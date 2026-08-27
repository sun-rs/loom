# 架构优势对照基准

本基准是“RAH OS 明显优于旧 RAH/同类项目”之前的强制证据。默认使用 fake runtime；真实付费 CLI 和外部产品黑盒只在显式请求时运行。

## 1. 指标

| 维度     | 指标                                                              |
| -------- | ----------------------------------------------------------------- |
| 正确性   | event loss、乱序、重复业务 mutation、越权泄漏                     |
| 恢复     | crash point 覆盖率、最长恢复延迟、stale owner 成功数              |
| 效率     | 人类等待期间 LLM token、wake 数、无效 Run 数                      |
| 可移植   | runtime/session 删除后的 Task/Memory/Context 保留率               |
| 适配成本 | Provider-specific business LOC、parser 数、升级修改量             |
| 可审计   | mutation 的 actor、basedOnSeq、artifact、memory provenance 完整率 |

## 2. 强制场景

### B1 Room reconnect

3 个 Agent 和 1 个人类写入 1,000 个事件；Agent 离线后恢复。

通过：canonical event 丢失 0、乱序 0；每个 consumer token 独立；响应丢失不会让客户端越过未收到事件。

### B2 Busy coalescing

Agent idle 时连续 100 个相关触发，leased/running 时再来 100 个。

通过：前 100 个形成一个 queued range，后 100 个形成一个 follow-up range；同一 Agent 无并发 active lane。

### B3 Wake loss and duplication

丢弃 100% wake，再重复投递相同 wake 1,000 次。

通过：Host 在声明的 reconciliation SLA 内领取工作；只有一个有效 lease；wake payload 无正文。

### B4 Crash matrix

分别在 outbox commit、lease、spawn、sync、progress、submit、Activation complete 前后 kill Host。

通过：无静默丢失、无双 active、旧 owner 不能提交、Task 不被进程状态伪造。

### B5 Human delayed reply

Agent 创建 InputRequest 并退出；人类 10 分钟和 24 小时后分别回复。

通过：等待期间 CLI/LLM token 为 0；回复产生一次 durable Activation；Provider session 删除后仍可恢复。

### B6 Causal freshness

Agent 基于 `roomSeq=N` 形成 reply/claim/review，在 commit 前写入 `N+1` 关键事件。

通过：上下文敏感 mutation 被 hold/reject，并返回缺失 delta；显式 override 被审计。

### B7 New CLI, zero parser

使用此前从未注册的真实或 fixture CLI，只增加 RuntimeProfile manifest，不修改 Kernel/TypeScript parser。

通过：能 sync、claim、start、progress、submit；rich telemetry 可以为空。

### B8 Parser chaos

注入非法 JSON、字段改名、超长/截断 JSONL、未知 ACP event、半截 UTF-8、exit 0 且文本声称“完成”。

通过：Room/Task/Inbox/Activation 完全由显式命令决定；Observation 降级为 raw/partial。

### B9 Cross-CLI handoff

Codex 实现、OpenCode 审查、Kimi 修复、Claude Sonnet 验收；中途删除所有 Provider session/transcript。

通过：同一 Room/Task/Artifact/Review 可继续；各 RunAttempt 固定实际 runtime/model/profile revision。

### B10 Task race and recovery

两个 Agent 同时 claim；owner 在工作中崩溃；policy 重新分派。

通过：单一 accountable owner；claim 使用 CAS/lease；Run completion 与 Task completion 分离。

### B11 Memory scope and correction

写入 100 条事实、20 次纠正、3 个 scope，并切换 runtime/Host。

通过：provenance 100%、跨 scope 泄漏 0、superseded 不进入 active context、ContextManifest 可复现。

### B12 Side-effect replay

随机 kill/replay 10,000 次 mutation、Outbox publish 和外部 side effect。

通过：idempotency conflict 可检测；没有重复业务提交、静默丢 Task 或重复不可逆外部动作。

## 3. 对照组

- 旧 RAH：必须运行 B3、B5、B8，量化 MCP listening token 与 Session/Council 双 owner。
- Patchwork：优先运行 B5、B7、B9，比较 ACP-first 和 Room/Task/worktree。
- Multica：可运行时比较 B2、B7、B9 与 CLI 升级维护量；闭源/托管能力只做黑盒，不猜内部语义。
- Commonly/OpenAgents：比较 event replay、Agent identity 和 memory scope。
- Raft：比较 B3、B5、B6、B9；不可访问的 managed runtime 标为 unknown。

不能运行的项目/场景记为 `not evaluated`，不能记为 RAH 胜利。

## 4. 适配维护预算

目标不是“永远零 Provider bug”，而是：

- Provider-specific business-state code：0 LOC；
- 一个通用 ACP L1 adapter；
- 非 ACP CLI 只允许 declarative manifest 或薄 lifecycle adapter；
- Provider parser 失败不能影响 Room/Task/Inbox 表；
- rich telemetry adapter 不通过 conformance 时自动降级；
- 连续升级 Codex/OpenCode/Kimi/Claude 各两个版本，统计 business regression 与 telemetry-only regression。

若新 CLI 必须增加 transcript parser 才能 claim/submit，B7 失败，必须修架构而不是扩大白名单。

## 5. 宣称门槛

- B1–B4：才可说 durable Activation 机制已完成。
- B5–B6：才可说优于 MCP listening 和简单 wake 注入。
- B7–B8：才可说摆脱 Provider JSONL 解析地狱。
- B9–B10：才可说是跨 Agent/CLI 的业务协作系统。
- B11：才可说有可移植长期记忆。
- B12：才可说具备生产级副作用恢复基础。
- 同一场景与至少一个可运行竞品对照：才可升级为 E3 相对优势。

## 6. 当前证据快照

截至 2026-08-26：B1–B3、B5–B6、B10 已有 local E2；B4、B7–B8、B12 为 partial；B9、B11 未实现；全部场景均尚无同条件竞品黑盒 E3。逐项依据、Raft/Multica/热门项目对照和避免夸大的结论见 [v0.1 收口与竞争性独立审计](../audits/2026-08-26-v01-closure-competitive-audit.zh-CN.md)。
