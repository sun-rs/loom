# Raft Computer 1.0.32 对照：交付与 OpenCode 长请求修复

日期：2026-09-17。范围来自 [all 频道回复延迟调查](./2026-09-17-all-channel-reply-latency.zh-CN.md)。仅修复两个已复现问题，不调整模型、推理强度、私有记忆、任务状态或频道参与策略。

## 上游依据与边界

来源是 [Raft Computer 1.0.32 官方制品](https://cdn.raft.build/computer/1.0.32/raft-computer-darwin-arm64)，SHA-256 `0db97964b6f21d500629e14a88fe4d24b94476428d01de997863ad2d7545aec5`。不可变来源、提取 hash 与许可边界保存在 [证据清单](../evidence/raft-release-20260916/manifest.json)。原始制品仅作分析，没有把未知许可的发布 bundle 放入生产依赖或复制其代码。

| 位置（发布 bundle 提取行）         | 对照结论                                                    | 本地归属                                                       |
| ---------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| `dist-CI7CMKZV.js:8710`、`:9579`   | consumed sequence 按目标记录；新消息使旧发送成为 held draft | Kernel target read / held draft，保留既有规则                  |
| 同文件 `:9757`、`:63652`、`:63700` | message-check 交付后确认；message-read 记录 consumed seq    | Application Service 保留页证据，Kernel 原子 ACK 并记录该页目标 |
| `chunk-TEGPBMW7.js:9035`           | OpenCode 采用 `opencode run --format json` 子进程，等待退出 | AgentHost 原有 serve adapter 的本机 HTTP transport 修复        |

官方中央 Server 的实现不可见，因此不能宣称目标已读修复逐字移植自 Raft Server。
另检查 Multica `server/pkg/agent/opencode.go` 的子进程 context/cancel 路径；它也不是
本地 HTTP 长请求的直接替代。两项实现均为既有 owner 内的 RAH glue，无新增协议、
第二队列或独立业务状态。

## 1. 已交付消息重复触发 hold

修复前，CLI 的 `message-check` 输出与 ACK 成功，target read position 仍为 0；
没有任何中间新消息，首次回复也会把原始问候当成新消息而 held，平白多走一轮模型。

现在 Application Service 仅保留每个已返回页的 message event 序号；输出成功后
ACK 时，Kernel 在同一认证事务内验证并分别推进 Root/Thread 的 target read。
不使用最新 Room head，不标记下一页，不扩大 Activation，不确认 Inbox 或完成 Task。
保留后来新消息的 freshness hold、Thread 父目标确认及 ACK 重放规则。

TDD：新增首次回复、ACK 前后及分页/Thread 测试，在旧实现下按预期失败；修复后
通过。另覆盖输出失败无推进、丢失 ACK 响应后重试、后到消息继续 held。正式测试位于
`packages/application-service/test/worker-message-check.test.ts`，并回归已有最小发帖、
Thread 确认、Direct Room 与 target-read 测试。

## 2. OpenCode 长请求隐含超时

修复前同步 `/session/:id/message` 关闭了应用 AbortController 定时器，但 Node
fetch 内部仍有约五分钟响应头超时。隔离 HTTP 服务延迟响应、加速真实 Undici
timer wheel 后，对照 fetch 确实抛出 `HeadersTimeoutError`；新 transport 同场完成。
这证明代码中存在该故障路径；历史现场日志未保存 cause，不能倒推那一次必定是此错误。

仅长 prompt 改用 Node HTTP，仅允许现有 loopback server。保留 HTTP 状态与错误
正文、断线错误码及 AbortSignal；AgentHost 原有 deadline/取消/终止证明拥有运行
时限。普通控制请求仍有短超时。未把 Provider 错误或 exit 当作成功消息。

TDD：同一加速测试在 fetch 实现下失败，修复后通过；额外验证 503、主动取消、
连接中断与非本机 URL 拒绝。既有 fake native-provider gate 覆盖 resume/fresh、
权限请求、session missing 与取消时 abort-before-kill。

## 验证与部署

统一检查另发现两处工作区集成测试滞后：SDK 操作清单缺少已实现的
`computer.files.list` / `room.execution.read`；键盘接线测试还假定发送按钮内联，
未识别已提取的 `ComposerSubmitControl`。补齐精确路由断言、共享组件接线以及
Stop-only 状态下 Enter 不提交的检查，没有放宽发送条件。

验收结果：

- `npm run check` 最终整轮退出 0：共 2307 项，2290 通过，17 项付费门控跳过。
  两处集成测试补齐后重跑整轮；生产目录指纹在最终检查前后保持一致。
- `npm run format:check`、`git diff --check` 与正式 `build:web:workbench` 通过。
- `test:web:worker-message-tools`：Chrome/Firefox，1440 与 390px，Worker 工具结果
  回到聊天页面；截图已检查。
- `run-local-workbench-gate.mjs`：假 Provider 的真实进程链、正式构建、Agent 回复、
  持久重启、Provider session 恢复及 390x844 页面恢复通过。
- `test:web:composer-controls`：1440/390px 的文件引用、停止终止证明、失败恢复、
  重载和修正输入通过，用于覆盖本轮发现的共享组件接线测试变动。

正式工作台在 10:31（Asia/Shanghai）由同一工作区的并行发布正常重启，本轮未再
重复重启。复核新进程 78408 的启动时间晚于修复、当前生产目录指纹等于本轮整套
检查的指纹 `44acbdcf67d6fc0d4dd20a20f66d4f67019a8374c433fcb1079150cdfb845f52`。
复核重启收据，独立执行 `verifyStateBackup` 确认备份
`~/.rah/backups/pre-restart-97587b69-38f8-4ea1-8d1e-745d84bc1015` 完整；原 loopback、
LAN、Tailnet 三地址和端口保持一致。

当前正式 Web build 为 `9811f908371d5daf4abf9ccbbc12f6c3d967f40f6074ee15061a9bbbf339321c`，
Web 与 daemon 的共同 buildIdentity 为 `57fb6ebbd2e726f9`（development）。
从实际 LAN 入口新建 Chrome 页面，1440x900 与 390x844 均直接打开 all 频道，
确认原 OpenCode 消息可见且刷新后仍在，截图已检查，无页面异常；验收前后
Room event 序列完全一致。脚本为 `scratchpad/2026-09-17-reply-repair-formal-browser.mjs`，
本地截图与结果位于 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-reply-repair-formal-jRk2l7`。
首次浏览器检查的只读请求白名单遗漏自定义头像 GET，补入测试脚本后重跑通过，
不是产品头像加载故障。

未启动付费模型，没有 Raft 同模型同输入性能对照结论；390px 浏览器验收不等于
真实 iPhone 验收。本轮没有提交或推送 git。

这两个修复消除不必要的再读和隐含超时重试，不保证 Provider 推理或网关延迟变短。
活动页的诊断文字仍不会自动复制为 Room 正式消息。
