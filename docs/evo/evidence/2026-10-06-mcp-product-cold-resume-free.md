# Codex 0.160.0 原 MCP 产品链冷恢复免费探针

本次只验证固定假模型下的产品机械路径，没有真实模型、付费、正式数据或产品代码变更。真实安装 CLI 经现有 guarded shim、AgentHost、Worker 和 Kernel 运行。

| 阶段        | Runtime                  | 假 HTTP / 完成生成 | 唯一发表 / 实际 ACK | 产品记录合成 input/output |
| ----------- | ------------------------ | ------------------ | ------------------- | ------------------------- |
| 初次        | 新建                     | 1 / 1              | 1 / 1               | 100 / 20                  |
| warm        | 复用                     | 1 / 1              | 1 / 1               | 100 / 20                  |
| cold resume | 新建 runtime，原 session | 2 / 2              | 1 / 1               | 200 / 40                  |

三轮同一 instance、同一原生 session。第二轮结束确认空闲后，临时 daemon 经 SIGTERM 正常退出并以相同状态目录重启，第三轮 runtime ID 改变。三次发表都有真实 final marker、唯一 Run 和完成 Activation；实际消费者 cursor 覆盖对应 toSeq。provider 自动记忆关闭、平台读写关闭。假 HTTP 总计 4，上限 12。

第二轮工具 cell 在 loom_reply 后继续输出 FAKE_OUTER_AFTER_REPLY；完整原生工具结果包含该标记，未被提前截断。初次、warm 的 finalInterrupt 均 requested/sent=true。冷恢复 finalInterrupt requested/sent=false，工具回执完整进入下一请求；假服务仅回复 FAKE_DONE，不再调用业务工具。额外请求及其合成用量同时出现在原生日志和产品记录，没有遗漏或重复发表。

这验证交付和计量，不是总体效率通过：本 fixture 冷恢复仍用了 2 次 HTTP。固定假模型不会证明真实模型遵循指令、答案质量或随机行为。每 HTTP 固定 100/20 是夹具计数，仅证明记录完整，不是实际 token/价格估计。

本产品探针未额外采集 app-server wire 通知流。原生 rollout 中完整 outer 输出不等于 driver 收到 raw outer 通知；不能将先前独立协议探针的 raw 缺失直接冒充本批观察。当前数据也未证明有另一种可供提前停止的正式 outer 完成事件。本次不修改屏障、不为进一步归因重跑。

原始 result 的 status=passed 仅为脚本交付断言通过；本报告以 summary.redacted.json 的分项 verdict 为准。原始材料保留，含所有请求、原生日志、临时状态数据库及脚本 SHA；私有状态含运行凭据，公开仅使用脱敏摘要。

时序说明：私有 measure 未传 replyAt，因此其 generationsBeforeReply/AfterReply 不能用于发表前后划分。冷恢复的额外 HTTP 晚于真实规范提交，由 HTTP 时间戳和持久消息时间独立核对。两个临时 daemon 都正常退出（code 0）；进程路径检查未见残留子进程，正式服务未触碰。独立审计 45 项核对通过，仅限此 fixture 的交付、连续性和计量。

被测源码 `35ade1778b0b6044408dd8d415b42ff9b5a087e0`；[脱敏证据](2026-10-06-mcp-product-cold-resume-free.json)与[独立审计](2026-10-06-mcp-product-cold-resume-free-audit.json)。私有归档 `2026-10-06-mcp-product-cold-resume-free` 保留四份请求及完整材料，SHA 见脱敏证据。

结论：本例中回复工具首次使用正确，但冷恢复仍有额外生成，不能归因于模型随机选择或靠强化指令解决。下一步需要捕获驱动实际收到的通知来定位停止边界；本批不据此修改生产屏障，也不以先前原生协议探针替代本批缺失的通知证据。长期质量与成本仍按[随机模型验收设计](../stochastic-cli-evaluation-design.zh-CN.md)独立裁决。
