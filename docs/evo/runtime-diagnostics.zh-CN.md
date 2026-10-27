# 原生运行记录的离线消耗诊断

2026-10-27，基线 `cd07b6f4`。承接任务验收报告，先从已有记录识别可观察事实，不给运行时新增重试、熔断、压缩或会话替换策略。此工具不能证明某个 CLI 或模型比另一家更高效。

## 使用和输出

```sh
node scripts/cli-efficiency/runtime-diagnostics.mjs /absolute/path/to/archived.stdout
```

输入是原始逐行 JSON，不是报告摘要或终端屏幕文本。流式读取，最多128 MiB、单帧2 MiB、单类观察/turn最多10,000；超过限制或遇到损坏JSON会拒绝输出，不静默跳过。空行保留实际文件行号。结果写标准输出，附来源路径、SHA-256和字节数；不保存消息正文、工具参数、错误文本或认证信息。输出仍有原生 session/turn ID，应按诊断资料管理。

没有网络、正式数据库写入或 Provider 启动。不支持的帧计入总数但不参与判定；`recognizedFrames=0` 不代表正常。覆盖始终显式 partial-or-unknown，因为日志可能缺帧、没有记录某类原生操作，或格式已变。

## 支持范围

| 来源格式                                                                         | 读取事实                                                                                                                    | 不允许的推断                                                                             |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Codex app-server `thread/tokenUsage/updated`、`item/completed`、`turn/completed` | 复用产品 `CodexTokenUsageTracker` 验证累计一致性和去重，用同 thread/turn 的 `last.inputTokens` 对比同次 compaction 边界前后 | 不比较两次压缩的 post；不拿累计 token 当上下文；不把不下降判成已证浪费                   |
| Pi JSON 流 session/compaction_start/end                                          | 前值、原生估计后值、aborted、明确 willRetry 意图                                                                            | estimatedTokensAfter 不是精确后值；压缩请求 usage 不是压缩后的上下文；意图不等于实际重试 |
| OpenCode session.status/retry                                                    | session及明确 attempt 序号；同一重试段连续相同 session/attempt 去重，离开 retry 状态后允许序号重新开始                      | 重试信号不等于额外 HTTP 已计费，更不证明重试没有必要；缺 attempt 不补次数                |

Codex 精确重复通知沿用已有解析器；无前值、缺后值、用量修正/gap、压缩重叠、turn结束或中间新增 item 均保守降级。压缩后最多跳过5个零水位标记，只是限制寻找后值的范围，不是“五次失败就杀”的运行策略。跨 turn/session 不续配，文件末尾不从下一文件借后值。

`observed-reduction` / `no-observed-reduction` 只描述两次请求输入的观测关系，不证明摘要质量、因果收益或压缩风暴。输出不生成“浪费了多少 tokens”：`wastedTokens:null`。`retryWasteVerdict:unknown` 保持重试必要性未审计。正常业务反复读文件、修代码和工具报错不被当成自动重试。

## 来源与本地变化

参考 [Cindy 固定源码 compaction-storm.ts](https://github.com/makecindy/cindy/blob/d571005ec68e56efbce8b3328c56d9901044b6be/packages/maker-core/src/agents/codex/compaction-storm.ts)，仓库许可 Apache-2.0。采用“同次 pre/post、不比较 successive post、有界忽略零标记”的行为设计；本地重新实现只读诊断组合，不是逐字复制或上游库依赖。

没有采用它的0.9比率、连续3次熔断、跨turn计数或错误终态合成。Loom复用自己的用量校验器，并额外对身份、完整性和上下文中间变化保守降级。Pi/OpenCode格式来自现有 Loom provider 代码与历史原流；不是照搬 Cindy 的这些 CLI 实现。

## 本轮证据与结论

[历史批只读重放](evidence/2026-10-27-runtime-diagnostics/README.md)覆盖 Pi 旧批9份原始 stdout，哈希全部匹配原归档。Codex/OpenCode 本轮只有协议夹具测试，没有新增实模型或完整历史批扫描；不得把单家记录泛化为多家诊断结论。

目前没有从这批证据建立“反复无效压缩”或“不必要重试”的根因。因此不推进自动熔断、换会话，也不据此继续精简系统提示词。以后出现具体慢/贵任务，先用任务报告定位失败及费用范围，再对其原流做此类诊断；只有信号和业务证据同时成立，才提出运行时修复。
