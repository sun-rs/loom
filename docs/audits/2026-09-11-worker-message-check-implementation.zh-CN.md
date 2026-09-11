# Worker 自动交付确认、重放与工具合同实施

日期：2026-09-11。覆盖原清单第 3 项及第 5 项 Artifact 参数负担；第 4 项见 [Task 批次实施](./2026-09-11-task-batch-contract-closure.zh-CN.md)。实现及自动回归不等于真实模型或 Raft 双边验收。

## Raft 证据与采用边界

来源：授权提取的 `raft-computer 1.0.18`，`raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`；SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。

- `messageCheckCommand` 729502 行声明 drain 并在返回前确认已交付序列；`drainInbox` 677012–677039 行最多循环 50 次。其内部调用 events.get，不据此推断闭源服务端 ACK 事务。
- 729856 行 attachment upload 在工具侧生成 clientRequestId。RAH 的 Task Artifact 额外绑定 RunAttempt，因此采用内容与 Run 的稳定键；不是逐字复制上游 UUID。
- channel attention 的九个可选字段见 17204–17218，渲染顺序见 675385–675401。RAH 当前策略说明来自真实 Kernel 状态，不称为闭源服务端原文。

## 单一 owner 与可恢复边界

新增正常入口 `rah worker message-check [--replay]`。CLI 有界读取、等待 stdout 写回调成功后，仅确认本页实际交付 cursor；模型不携带 seq。旧 sync/ack 是兼容诊断入口。

Kernel 在原认证事务中记录 `activation_delivery_windows` 的不可变输入下界（schema 55），不是新的递增 ACK 游标。首次下界覆盖尚未确认前缀、Activation 来源及该 Activation 的原义务事件；新凭据／重试 Run 从同一下界重放到已认证的冻结 toSeq。服务内 grant 只保存本次工具呈现进度；当前凭据撤销、成员权限和 execution fence 仍生效。

stdout EPIPE、关闭或超时不确认该页。超时后仍接住迟来的 stream error。ACK 回执丢失可用 `--replay`；新 Run 即使不带 replay 也重新呈现原窗口。确认交付不完成 Inbox 工作或 Task；未完成 Task 阻止错误完成 Activation。不是“模型恰好读过一次”的证明。

最大 50 页、累计输出 8 MiB、每次命令页间检查 60 秒预算；每个 HTTP 请求另有原 30 秒超时。达到限额保留剩余交付，下一次继续。后续 Activation 不被当前 check 自动确认。

兼容边界：若旧客户端在首次 check 前已显式确认，系统无法恢复没有保存的旧未确认前缀；仍重放 Activation 来源和义务，不能伪称任意旧 ACK 可逆。

## Artifact 工具参数

普通 `artifact-publish` 不再要求模型生成幂等键。工具使用已有 Run 环境、Task、文件名/MIME/大小和流式内容摘要生成稳定键；同 Run 同内容重试键相同，不同 Run 或内容不同。保留显式键兼容。认证仍由 Worker 凭据及原服务端预留流程执行，环境字段不是授权来源。

摘要读取使用固定 64 KiB 缓冲，校验读取前后文件状态。不会把本地路径发送给服务端；没有声称冻结可被外部进程继续修改的文件。

## 已执行验证与反证

- `worker-message-check.test.ts`（application-service）：真实 HTTP/Kernel、分页 500 条、撤销凭据、晚到消息不越界、旧 ACK 兼容；ACK 后模型失败、关闭重开数据库和服务、换 Run，原 Message ID／旧前缀仍在，随后真实 claim/start/submit 并完成 Activation。
- 同文件真实 CLI→HTTP 测试模拟 ACK 已落账但响应丢失，再 replay、新 Run 恢复成功。
- `agent-host/test/worker-message-check.test.ts`：异步 stdout、EPIPE、迟到 EPIPE、分页中断、错误 ACK、字节和轮数限额。
- 恢复反证 `/tmp/rah-message-check-recovery-red.log`：把持久下界替换为 Activation.fromSeq−1，原前缀断言失败；不是缺路由 404。
- Artifact 同 Run 重试测试与 CLI 两次调用键一致；反证 `/tmp/rah-artifact-counterfactual-red.log` 给键混入随机性后稳定性断言失败，正式实现回归通过。
- 浏览器 `npm run test:web:worker-message-tools`：Chrome/Firefox、1440×900 和 390×844 的隔离假 Runtime 消息工具回归通过；不是真实模型调用。

总门禁与正式部署结果由本批最终交付补录。Task 五态入口、Human 批准事实及其他明确剩余未被此文声明完成。

## 最终门禁与正式部署

- `npm run check` 退出 0：后端 1511 通过、17 个 opt-in 跳过；Web 单测 395 通过；仓库、UI/协议登记、类型、其余脚本检查均通过。日志 `/tmp/rah-345-check-final.log`。
- 格式与 diff 检查通过；正式 Web 构建通过。额外 schema 54（删去两张新表）升级验证原身份、消息、事件不变，外键完整。
- 新表加入 Room 显式删除及事务回滚测试；CLI 满 2 MiB sync 页另外预留 128 字节外层包装，超限失败反证后修复通过。
- 2026-09-11 正式实例温和重启：旧 PID 67174 → 82443；备份 `/Users/sun/.rah/backups/pre-restart-1770d165-0434-44c7-91c7-41dd5f8f186b`。启动前守护检查闲置、在线备份并验证后才停止原进程，没有强制杀进程。
- 正式 URL `http://127.0.0.1:4173`，页面 meta 实际构建 `9c2b3f21447e14cfeee1541cc913a4d040f2e74e1c084ab6a078fc9e5dad2f75`，数据库 schema 55，32 个 Activation 保持 completed，外键检查为空。
- Chrome 新加载页面实际点击 Room Tasks、原 Task 的 Thread 与附件卡片、Settings 管理页；确认 Codex/Claude Guide 勾选、Kimi/OpenCode 禁用状态保留。未发送正式模型消息。
- 重启后与备份逐行比较：410 Room events、43 messages、2 Tasks、4 Agent definitions、6 Principals 全部一致；Agent workspace 文件与 runtime-guide.json 字节摘要一致。
- 产品源码冻结清单 `/tmp/rah-345-source-manifest.json`：1419 文件，摘要 `63056fd5bedd0476a8c511c57578971a3f086e8295fd77ec840cbd7732c2c574`；部署前复核未变化。此次没有 commit/push。

第 3 项可按“代码、自动恢复闭环及部署”签收，第 5 项的原字段/参数问题已补齐；这不表示整套命令签名逐字一致。第 4 项只有批量子项签收，五态统一入口、done/closed 管理与 Human 批准事实等仍见 Task 文档。真实付费模型和 Raft 双边组合复验本批未运行。
