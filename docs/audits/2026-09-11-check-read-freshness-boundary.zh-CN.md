# Inbox check、目标 read 与 freshness 边界的证据校正

结论：不能仅凭 RAH `worker sync` 已输出消息、随后发送仍 hold，就断言违背 Raft。2026-09-11 官网 ParityAuditorA 的独立私有记忆负对照实际执行 `raft message check`，随后发送 PRIVATE:UNKNOWN 仍因同一 Human 消息 hold，`--send-draft` 才成功。工具记录见 `/Users/sun/Code/reviews/rah_os/2026-09-11-busy-latency/raft-private-control-b-tools.json`，真实 model/variant 为 DeepSeek V4 Flash/low；未包含 thinking。

上游取证源：`raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`，SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。

| 层               | 源码事实                                                                                                                                 | 不能混淆的结论                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| CLI check        | 729502–729516 调 drainInbox；677012–677035 通过 events.get(since=latest) 累积消息并返回，不调本地 recordConsumedRead/Seqs                | 输出消息不代表发送时携带了目标连续 seenUpToSeq                     |
| proxy events     | 737976、738121 调 consumeVisibleMessages，source 分别 agent_api_events_local/server                                                      | check 并非完全“不消费”                                             |
| daemon 可见账本  | 762810–762860 记录 message IDs、按来源决定边界推进；764345 后抑制 pending 中重复投递                                                     | 精确消息已展示与连续目标边界是两个不同证明                         |
| 连续边界准入     | 744712 仅 verified_contiguous_content_consumption 或 thread_join_context_rendered（Thread）可推进                                        | 普通 events、history source 不能一律推进此内存边界                 |
| CLI history read | 729582–729595 输出后，非 around 模式调用 recordConsumedRead(maxSeq)；675836 实现目标 seq/readOrder                                       | 目标 read 与 inbox check 不等价                                    |
| send/hold        | 676839 从 getConsumedSeq 取得 seenUpToSeq；676906 hold 展示后 recordConsumedSeqs                                                         | 首次 hold 后 send-draft 能前进，有单独的凭证路径                   |
| RAH sync         | worker-application-service.ts736–759、room-kernel.ts4866–4901 返回 Activation 冻结范围与已交付 cursor；不写 worker_target_read_positions | 更接近 Inbox check/执行交付，不能直接当成 Raft history read        |
| RAH read/hold    | worker-read-tools.ts304、collaboration-service.ts2012 写目标阅读位置                                                                     | 与上游 read/hold 的目标边界路径相对应，具体分页/around仍需单独比对 |

因此，当前实测能确认本地 hold 增加了一次交互和耗时，不能把该事实直接命名为“Raft 已放行、RAH 错误重复 hold”的产品缺陷。下一步如要裁决差距，须以相同目标、同种 read/check 命令、相同 source 消费状态、相同新消息条件做双边试验；尤其要区分 CLI 本地 consumed seq、daemon 精确 message IDs、连续 modelSeen 边界及服务端 freshness 校验，不能把服务端未知行为补成自研假设。
