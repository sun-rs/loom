# 本机运行器账户用量：来源裁决与接线方案

状态：**梳理完成，采集与产品接线尚未实施**。本文件完成用户所列第四项“单独梳理运行器用量接线”，不是上线回执。中央套餐、账单、资源额度仍不在本期范围。

## 证据与适用性

官网实操见[四项行为核实](../audits/2026-09-08-raft-remaining-live-confirmation.zh-CN.md)：Computer 的 Codex 用量浮层有账户级百分比、时间窗口、重置时间和缓存标识；Claude 浮层明确显示解析失败。此次没有刷新、制造限额或启动付费模型。

授权来源为 raft-computer 1.0.18，`packages/daemon/dist/chunk-ZHWD6VKE.js`，SHA-256 `dcd61f0f7ce1c8804866a50f29c88ba34f6230b6dded4c0504994ea2eb7da2e0`，来自本机 `raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/source-slices/`。本批只分析，没有复制发布物到生产。后续移植须保留上游版权声明和已有授权／来源登记。

| Provider | 已查明的采集路径                                                                                                                                               | 可信输出与限制                                                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex    | `readCodexRateLimitsFromAppServer`（18911 行附近）：initialize → initialized → `account/rateLimits/read`；`projectCodexRateLimitsReadSnapshot`（18857 行附近） | 优先 `rateLimitsByLimitId`，兼容 `rateLimits`；primary/secondary 分开；百分比必须 0–100、重置时间有效。缺少字段为 parse_unavailable，不填零。读取超时 8 秒，退出时清理子进程。此路径不创建 Thread 或发起模型 Turn。        |
| Claude   | `readClaudeUsageText`（12781 行）：`auth status --json`，然后 `-p /usage --output-format json`；`projectClaudeUsageTextSnapshot`（12707 行附近）               | 实验性文本解析、local_sessions_only，5 分钟时效；官网此次也解析失败。不能把这个命令未经验证地当成无模型调用的只读接口，因此本批不执行。先移植纯解析器和已有结构化 rate-limit 事件观察；主动采集在确认 CLI 行为后独立验收。 |
| Kimi     | `readKimiUsage`（19107 行）：已有 KimiAuthFacade 的 `getManagedUsage()`；`projectKimiUsageSnapshot`（19050 行附近）                                            | computer_account、结构化接口、5 分钟时效；401/403 为重新认证，404/405 为不支持。不能猜第三方 HTTP 地址，必须连同授权源码中的认证 facade 边界一并核实。                                                                     |
| OpenCode | 上述 `createRuntimeAccountUsageCollector`（19131 行）只分派 Codex／Claude／Kimi                                                                                | 没有证据支持通用 OpenCode 账户额度采集。标记不支持；不能把 DeepSeek 单次 token 计数或预估金额当成账户剩余额度。                                                                                                            |

另有事件路径 `observeRuntimeAccountUsageTelemetry`（12884 行），接收 Codex/Claude 的结构化限额事实。主动采集与事件观察必须汇入同一个快照 owner，禁止两个相互覆盖、时序不明的用量缓存。

Multica 已检查 `packages/views/runtimes/components/usage-section.tsx`：主要是按日期、Agent 和模型汇总 token／金额以及自定义价格，不是 Raft 的账户限额浮层；不采用该费用统计体系替代当前需求。

## 单一 owner 与最小接线

当前代码事实：`packages/daemon/src/local-runtime-inventory.ts` 提供 CLI 身份、探测与 Computer 状态；`apps/web/src/components/computer-runtime-inspector.tsx` 只展示运行器资料。它们目前没有账户用量采集。`worker-visible-profile` 是 Worker 可见资料投影，不应在同步资料读取中启动 CLI 或请求账户服务。

拟实施顺序：

1. `packages/protocol` 定义严格的 RuntimeAccountUsageSnapshot：provider、collectedAt、staleAfter、acquisition、scope、collectorVersion、脱敏账户键、health、windows。不可解析窗口不得携带 usedRatio／resetsAt；过期快照不改写成实时“正常”。
2. `packages/agent-host` 拥有 Provider 采集器与纯归一化函数，复用现有 executable/profile 解析与进程退出机制。只接受真实已配置 CLI，严格限制输出大小、超时和进程清理；不安装 CLI、不改账户、不增加模型执行。
3. `packages/daemon` 组合唯一、按 Computer＋运行器配置修订＋本地账户槽分区的有界观察缓存。刷新合并为一次在途请求；切换修订／账户或停止 daemon 时清理；晚到旧响应不得覆盖新配置。快照不是 Room 业务账本，不产生 Inbox、Activation、Task 转移。
4. 通过现有 HumanApplicationPort／应用服务／typed SDK 暴露认证后的读取与显式刷新。actor 来自认证上下文，Computer 范围来自服务端；不向浏览器输出本地认证文件、原始 stderr 或账户密钥。读取缓存不触发模型运行。
5. Computer 现有运行器浮层消费该接口，复用关闭、焦点和定位 owner，加入窗口、时效、来源、刷新中、重试及不支持状态；不再增加一个冲突的悬浮层。先 Codex 纵向闭环，再 Claude 事件与 Kimi，最后整体回归。

这是 RAH 本地组合方案，不声称 Raft 采用相同模块。保留前端可观察行为，省略 Raft 的 `machine:runtime_account_usage:refresh/snapshot` 中央转发，认证与错误边界不省略。

## 验收与不能推断的事项

- 纯测试覆盖多 bucket、主次窗口、0／100、时间单位、缺字段、无效时间、登录过期、不支持、输出超限；不能将 unknown 变成 0%。
- 假进程覆盖握手、读取、超时、stderr 隔离、重复刷新、崩溃与清理；假时钟覆盖缓存过期、配置修订变化和晚到响应。
- 浏览器覆盖正常、解析失败、过期、刷新中、失败重试，以及 Escape／外点／焦点返回；正常和错误都需要官方同条件证据。
- Codex 的真实只读采集与 Claude 可能执行模型的命令分别验收，后者不进入默认测试。没有证据时不得以调用付费模型来刷新面板。
- 当前不把用量观察绑定为调度硬门禁。账户采样可能陈旧；真实 Run 的限额错误继续由既有执行错误 owner 处理。不能凭快照自动完成／取消 Task，也不能推断 Agent 已阅读工作。
- Raft Agent 自检文案只说明阻塞时 error string 带原因和重置时间；未实证独立 `profile.reason/resetAt` 字段。此处不凭空增加这些字段。

最终需要独立实施批次，完成上述 Codex 纵向链路及相关 Provider 边界后，才能把“用量接线”状态改为已实现。
