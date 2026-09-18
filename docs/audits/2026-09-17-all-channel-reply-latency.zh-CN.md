# all 频道回复与延迟调查

日期：2026-09-17。性质：真实现场只读调查、临时数据库复现；未修复或部署产品代码，未运行新的付费模型。

## 现场与结论边界

读取正式 Room SQLite 的 messages、room_events、held_message_drafts、placements、run_attempts、run_trajectory_entries；所有现场 SQL 使用只读连接。下文时间统一为北京时间 UTC+8。

频道为 `room_b0f67e8a-d4fd-4cb9-85d2-551d4de9924a`。正式消息不等于 Provider 动态、工具调用参数或 held draft。

OpenCode 的正式消息已在 **01:53:53.759** 提交，内容为“@Hakase @OpenCode 在。周四好，随时待命，请问有什么任务？”。Message ID 为 `message_1010e264-6cce-4f83-b531-78dba1fb837a`，Room seq 91。这证明服务器已保存，不证明用户原有浏览器当时已渲染。本轮浏览器连接报告 `Codex auth token is unavailable`，没有完成原页面的可见性核验，不能据数据库排除独立的客户端显示问题。

## 实际时间

| 起点与结果                                                       | 间隔       |
| ---------------------------------------------------------------- | ---------- |
| 01:49:06.922 Human 发“大家好” → 四个 RunAttempt 分配             | 104–113 ms |
| “大家好” → Codex 01:49:52.139 正式回复                           | 45.217 s   |
| “大家好” → Claude 01:50:12.578 正式回复                          | 65.656 s   |
| “大家好” → Kimi 01:50:38.846 正式回复                            | 91.924 s   |
| 01:50:57.612 Human 问“现在是周几” → Claude 01:51:59.118 正式回复 | 61.506 s   |
| 01:52:39.163 Human 再次 @OpenCode → OpenCode 正式回复            | 74.596 s   |
| 最初问候 → OpenCode 正式回复                                     | 286.837 s  |

RunAttempt 分配不等于模型开始生成。四个 runtime 的启动记录位于约 01:49:07.261–01:49:08.811，未发现启动队列把首轮拖延数十秒的证据。

## OpenCode 为什么动态有文字而正文没有

初始 Run：`run_b6298ffb-af19-4947-8a7d-5af458a4e191`。

1. 01:49:38.669 执行 message-check，约 0.438 秒完成。
2. 01:50:23.812 查询 server-info 和 room-members，约 0.458 秒完成。
3. 01:51:03.901 Provider 状态报告 `Bad Gateway`，随后重试。
4. 01:51:29.298 message-read，约 0.235 秒完成，读取到 seq 33。
5. 01:51:57.908 查询本机日期，约 0.009 秒完成。
6. 01:52:45.736 首次发帖被暂存：based seq 33，此前 Human 的再次提及已经成为 seq 63。草稿为“@Hakase 大家好，我是 @OpenCode。今天是周四（2026年9月17日）。”；它没有进入 Room 正文。
7. 01:53:25.955 再次读取消息，01:53:53.759 修订后的回复正式提交。从 hold 到提交额外经过 68.023 秒。
8. 01:54:08.833 driver 报 `fetch failed`，Run 最终 exit 1；01:54:39.677 开始恢复重试。
9. 第二次 Run 于 01:58:39.083 exit 0，但因 `activation delivery is not acknowledged through sequence 63` 仍不能完成 Activation，再次重试；第三次 Run 于 02:02:40.199 exit 0。

本地工具耗时小于模型轮次间的数十秒间隔。Provider 网络错误、连续查询、freshness hold 和后续恢复共同构成延迟，不能归因于单一的前端慢或 daemon 排队。

模型绑定来自当次 Placement：OpenCode 为 `iiiiitoken/gemini-3.8-flash-high`；Claude 为 `opus[1m]` high；Codex 为 `gpt-6-astra` low；Kimi 为 `kimi-code/k3` low。这不是此前 Sonnet/DeepSeek 的验收组合，不能用不同配置的门禁时间直接比较。

## 已复现的本地缺陷

`message-check` 输出消息并 ACK 交付游标，但该路径不更新普通发帖使用的 target read position；`WorkerTargetContext` 在没有 target read position 时从 0 开始比较。结果：已经由 message-check 输出的原始消息仍可能成为 freshness hold 的“新消息”。

现场 Codex 01:49:40.003 的首帖就是 based seq 0、seen seq 6，此时没有后来的人类或 Agent 消息；它在 01:49:52.139 再发保存草稿，增加约 12.136 秒。

独立复现脚本：`scratchpad/2026-09-17-message-check-freshness-repro.ts`。

```bash
node scratchpad/2026-09-17-message-check-freshness-repro.ts
```

修复前使用临时数据库、假运行实例和真实 Worker CLI/API，确认 message-check 输出原消息且成功返回；期间不插入消息；随后正常发帖仍返回 `state=held`、`newMessageCount=1`，所谓新消息就是刚刚输出的原消息。该缺陷现有正式回归测试；脚本已更新为断言正常发帖，修复与验证见[后续记录](./2026-09-17-reply-delivery-and-opencode-timeout-repair.zh-CN.md)。

相关 owner：

- `packages/agent-host/src/worker-message-check.ts`：输出完成后确认交付。
- `packages/application-service/src/worker-application-service.ts`：message-check pending cursor 与 ACK 校验。
- `packages/kernel/src/room-kernel.ts`：`acknowledgeWorkerCursor`。
- `packages/kernel/src/worker-target-context.ts`：普通发帖 target read position 与 freshness floor。

这些文件及 `opencode-server-driver.mjs` 相对 `v1.0.0-rc.1` 无差异；不属于此次 A/B 补强新增的行为。

## Raft 对照与未知项

源版本与校验信息沿用[09-16 不可变证据清单](../evidence/raft-release-20260916/manifest.json)，分析对象为 Computer 1.0.32 发布包，未执行包内代码。原始材料位于 `/private/tmp/raft-20260916-audit/computer-1.0.32/slices/packages/daemon/dist/`。

- `dist-CI7CMKZV.js:9579–9677`：send 读取 consumed seq；服务端返回 held 后保存草稿、提供恢复动作，并明确说明没有目标投递。因此不能把 Provider 输出或 held draft 强行显示为正式回复。
- 同文件 `9757`、`63652` 起：message-check drain inbox，官方描述为交付后确认。`63700` 附近 message-read 显式记录 consumed seq。官方中央 Server 如何结合 events/read 与发送 freshness 不在已取得代码中，不能仅凭 CLI 缺少同名调用断言官方也有本地复现的问题。
- `chunk-TEGPBMW7.js:9035` 起：官方 OpenCode 使用 `opencode run --format json` 子进程。RAH 使用本地 serve API 的同步 `/session/:id/message` 加事件流。这是已有的传输差异。
- RAH 同步请求只关闭自己的 AbortController 超时，仍使用 Node 全局 fetch。现场 `fetch failed` 距 OpenCode busy 约 300 秒，与底层默认响应头超时相符，但当前诊断未保留 error cause，**不能据此宣布已经证明具体 timeout 根因**。需假服务长响应复现，并保留取消、终止和恢复围栏。
- 官方本地 runner 日志没有对应消息正文，浏览器连接失败；未取得同类问候/日期问题的精确正式消息时间，未新发付费测试。因此本轮没有 Raft 与 RAH 同模型、同上下文的延迟结论。

## 建议修复顺序

1. 先修 message-check 与 target read position 的衔接。只记录实际输出并确认的目标消息；不得用 Room head 全局“视为已读”。测试覆盖 Root/Thread 分离、分页、后到消息、输出失败、ACK 丢失与重放。
2. 单独复现 OpenCode 长响应的 fetch 失败；补足脱敏错误原因，再决定异步请求或明确的传输超时策略。不可通过把失败 Run 当成功或绕过交付确认来消除重试。
3. 明确动态中的发帖尝试、暂存草稿与正式提交状态，减少“看上去已回复”的误解；正式消息仍以 Room ledger 为准。
4. 前述额外开销消除后，再以相同模型、effort、Room 成员和冷热启动条件做问候/日期的 Raft 对照。简短问题的首次答复可优先处理，非必要资料查询及记忆整理不应挡在前面；不擅自关闭群聊广播、记忆或 freshness 围栏。

本轮未改 Agent 配置、消息、Task、记忆、运行策略或正式服务。产品修复、正式浏览器显示复核和 Raft 性能双边验收仍待完成。
