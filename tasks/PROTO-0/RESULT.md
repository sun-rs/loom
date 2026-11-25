# PROTO-0 完成摘要

已完成 loom_new 顶层 Agent 协议 v0 的三项交付。

- `docs/PROTOCOL.md` 定义了 Cell、Role Session、Task、Delivery、命令、状态机、append-only event、cursor、证据摘要、能力声明、human lease、重连补齐和版本兼容。
- `docs/SOURCES.md` 为命令、状态转换和事件字段提供了 Claude hooks/transcript、Codex app-server、agy/Antigravity、OpenCode、ACP、OAR、T3、Orca、Herdr 和旧 loom-next 的来源映射，并列出未知能力和验证方法。
- `schema/protocol.ts` 和 `schema/index.ts` 提供了纯 TypeScript 类型，覆盖协议正文中的命令、receipt、实体、能力、证据、状态和事件。

## 关键决策

1. 投递语义选 at-least-once。`commandId` 和 `deliveryId` 做持久去重，accepted 只表示 Cell 接管 command，不证明模型已读到输入。exactly-once 需要 provider 副作用前的接收侧事务，参考项目没有共同实现。
2. 状态只使用 `idle`、`working`、`needs_human`、`error`、`exited`。`needs_human` 只承载认证失效和真实错误。审批不进入协议命令。
3. 事实来源按结构化事件、hooks/transcript、ACP、OSC 7501、屏幕文本排序。断线不合成退出，空闲不合成 turn end。
4. 证据只报告事实。命令、退出码、文件变化、输出尾部、错误、沙箱拒绝、工具调用计数、观察耗时和压缩次数都可以缺失，缺失保持 unknown。
5. `steer`、队列、fileChanges、exitCode、compaction 和 transcript cursor 都是能力声明的一部分。能力缺失表现为可选类型和 typed refusal。
6. human lease 复用 Herdr 的单一 writable controller 语义。lease 暂停自动投递，不改变 provider process 或任务状态。
7. 默认只搬运 Cell 提取的最终回复和一行证据摘要。agent 不需要调用通讯工具。完整切片按 `evidence` 拉取。

## 未决问题

- Codex app-server 是否能稳定同时服务 hub 订阅和 `--remote` TUI，双客户端 steer 和断线重连的竞态仍需付费探针。
- OpenCode v2 和 Antigravity 的 native turn boundary 在所有版本上仍不完整，必须以实际 handshake 和 wire event 更新能力声明。
- Claude TUI 的原生命令 exit code、fileChanges 和审批阻塞的可抽取程度未形成共同结构。
- ACP generic runtime 没有共同 sandbox refusal 或 fileChanges schema。
- Cell event retention、outbox 大小和 transcript redaction 的运营上限尚未定为实现参数。

## 需要付费探针的问题

REPORT-R2 列出的 U1、U3、U4 需要少量真实账号回合。U2 和 U5 需要容器运行时与专用账号。U6 可以先用无模型的 hook/transcript fixture，只有覆盖真实 provider 行为时才需要付费回合。当前没有调用付费模型，也没有读取真实用户 transcript 或凭据。

## 校验

已检查协议正文中的命令、状态转换、事件 envelope、证据字段、能力声明、投递语义、human lease 和版本规则均在 `docs/SOURCES.md` 有来源或被列入未知附录。TypeScript 文件只包含类型声明和导出，没有实现逻辑。

STATUS: done
