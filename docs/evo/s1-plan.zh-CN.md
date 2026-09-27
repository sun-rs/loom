# S1 每轮效率：施工计划

日期：2026-09-24。依据：[目标合同](target-contract.zh-CN.md) §6、[状态历史日志](log/status-history-2026-09.zh-CN.md) 效率基线、S1 代码测绘（本页"现状"一节）。

## 现状（evo 代码测绘）

- 常驻提示词约 47.7k 字符（不含 Role 指令与 MEMORY.md），其中 `platform` 层 35.7k（`standing-prompt-compiler.ts:124`）。约 18–22k 是在复述代码已强制的规则（凭据范围、ACK 围栏、freshness hold、target-send 不推进 ACK、所有权检查、CLI 已打印的 held-draft 指引）。
- 唤醒输入是 983 字符固定文本（`provider-activation-input.js:2`），强制 `message-check --startup`；提示词在 compiler :126/:130/:334 重复要求。服务端并不要求 startup。
- `wake-message-input.ts` 与 `/v1/worker/message-present` 已存在但无调用方；Codex 的送达确认帧 `rah-delivery-accepted/v1` 已接到 `markPresentedDeliverySent`，因无渲染窗口而空转。
- ACK-on-post（`acknowledgePresentedDeliveryInTransaction`）要求 post 带模型提交的 `basedOnRoomSeq`，而提示词教的 `message-post --target` 不带该参数，所以从未生效。
- 提示词 :159 "and then acknowledge"、:167 "separate obligation"、:130 "inspect every delivered event" 制造了发帖后的额外轮次；kernel 本身不会因作者自己的发帖再调度。
- 四家驱动全部丢弃 usage；诊断走 fd3 → `run_trajectory_entries`。
- 404 被误标为 UNKNOWN：`worker-cli.ts:480` 在发送前置 `failureDraftSaved=true`，`worker-cli-error.ts:91` 对无 `next_action` 的错误一律套 CANNOT_CONFIRM。

## 施工项（按顺序，一次一项，每项测试先行、提交并推送）

| 项                           | 内容                                                                                                                                                                                                                                                                                                                                                            | 验收                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| S1-a 用量观测                | 新 fd3 帧 `rah-provider-usage/v1`；四家驱动逐次生成上报 input/cached/output/reasoning；Host 经 finishRunAttempt 交给 Kernel，持久化到 `run_attempt_usage`（每 RunAttempt 多行，按 response 去重）；worker/client 查询接口                                                                                                                                       | 假运行器单测 + 每家驱动解析单测；不进 trajectory                              |
| S1-b 发送错误分类            | 服务端 4xx（带 code）= 明确的提交前拒绝：`effect: not_sent`、不标 draftSaved、可按指引修正重发；UNKNOWN 只留给传输错误、超时、5xx                                                                                                                                                                                                                               | 复现 404 → 当前 UNKNOWN 的失败测试                                            |
| S1-c 提示词减重              | `platform` 35.7k → 约 8–10k：已由代码强制的规则、legacy reviewers、amend/delete/convert、profile/avatar、附件细节、live-constraints、inbox CLI 段移到 `worker help <topic>`；删除 "then acknowledge"、"separate obligation"、"inspect every delivered event"                                                                                                    | 提示词字符预算测试；现有 worker 协议测试保持通过                              |
| S1-d 带正文唤醒 + 发帖即确认 | Host 在唤醒前调用 message-present，用 `formatWakeMessagesInput` 渲染并注入，正文里给出 `seq`；提示词让回复带 `--based-on-room-seq`；保留现有信任规则（模型提交的 seq），不放宽 kernel。先接 Codex（已有 acceptance 帧），再逐家确认 Claude/Kimi/OpenCode 的可靠接收信号；拿不到可靠信号的驱动保留 message-check。去掉 `--startup` 强制，notice 尾部才需要 check | 真实 Kernel+SQLite+HTTP 链路测试：唤醒 → post → completeActivation 无需 check |
| S1-e 门禁                    | 付费门禁（Codex `gpt-5.6-luna / low`，需 owner 当批授权）；按合同 §6 判定                                                                                                                                                                                                                                                                                       | 达标进 S2；差距大则停下重评                                                   |

## 约束

- 不改 `completeActivation` 的 ACK 语义；"stdin 写入成功不等于送达"。
- 不放宽 `acknowledgePresentedDeliveryInTransaction` 的信任前提；若必须放宽，先交 owner 决定。
- 旧 Agent 路径的移除不在 S1 顺手做；S1 只保证实例路径达标，旧路径不被破坏即可。
- 每项完成后：`npm run check`、`format:check`、`git diff --check`；提交推送 evo；阶段性交 Codex 独立审查。
