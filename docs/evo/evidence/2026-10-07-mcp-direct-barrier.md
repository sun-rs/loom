# 直接 MCP 完整返回与最终停止屏障

日期：2026-10-07。承接[能力探针](2026-10-07-mcp-direct-surface-free.md)。本批不启动付费模型。

## 原始原因证据

[时间线](2026-10-07-mcp-direct-barrier-timeline.json)、[完整输出证明](2026-10-07-mcp-direct-barrier-output-proof.json)、[原屏障回放](2026-10-07-mcp-direct-barrier-replay.json)。两轮原生直接function_call的call_id、MCP item.id及function_call_output.call_id一致，thread/turn也一致。Kernel已有可信final标记，原生MCP完成后发出完整raw输出；该输出与随后HTTP请求中的工具结果逐字段一致。

旧屏障只接受code-mode的custom_tool_call/custom_tool_call_output，忽略直接function_call/function_call_output，因此在两轮实际帧的离线回放中始终不ready。不是MCP结果未返回，也不是Room业务未提交。旧code-mode前两轮仍只在完整外层输出后ready；此前冷恢复缺raw帧时保持不ready，这条保护必须保留。

原始输出到第二HTTP接收约3ms，不能当可靠调度预算。没有捕获Host arm精确到达时间，不能从数据库提交时刻推定driver已收到。屏障格式不匹配是可证的阻断，修正并不自动证明能抢在后续请求前停止。

## 权限边界

Kernel的持久final标记仍是唯一结束授权。原生工具事件和raw输出仅证明传输完成，不证明消费、不创建ACK、不完成Task或Activation。只有同一thread/turn/call的已知原生MCP生命周期及完整结果能够提供直接路径的完成证据；缺帧、未知格式、错身份、重放借证及混合并发歧义保持自然结束。所有其他工具也必须结束，已验证的code-mode屏障不移除。

## 实施与定向验证

AgentHost 的 direct 输出完成屏障与既有代码模式屏障组合，Kernel和业务调用不变；同call冲突重放、未知输出、错误结果、跨scope和后续工具反例均保守不提前停止。通过先红后绿验证。正式内部MCP配置排除code_mode及deferred，使安装版CLI直接呈现单个namespace工具；精确配置guard同步读取产品配置，无新增宽泛许可。门禁新增直接namespace及原生输出格式识别，发表回执必须与持久messageId/roomSeq匹配，unknown write和伪造namespace仍拒绝。

62项定向配置／屏障／model guard测试通过，门禁59项定向测试通过。完整 `npm run check` 通过：后端2933通过／22 opt-in跳过、Web487、console59、效率脚本451，及其他前置检查；format、链接与diff检查通过。正式部署待下述独立凭据。

## 免费实验批

[独立审计](2026-10-07-mcp-direct-barrier-free.json)：保留上一探针的精确私有argv覆盖，隔离home、关闭原生自动记忆、只使用loopback假模型。initial／warm／优雅重启后的cold同session三轮实际请求分别1／1／2，总4，预算6；三轮各一次真实发表及消费者ACK，全部完整工具输出保存在原生rollout。首两轮实际raw完成后才写中断；cold原生MCP完成却仍缺raw通知，所以没有中断，其完整输出保存在第二请求历史中。

这是单次时序样本，不承诺每次都抢在下一请求前，也没有真实模型质量、token、缓存或费用结论。Cold的2次请求明确保留，不通过补读诊断文件、替换session或绕过输出证据来压低计数。

## 正式配置免费复验

[无覆盖审计](2026-10-07-mcp-direct-production-free.json)：使用最终产品默认配置、同一正式model guard，没有argv替换；透明wire记录器不修改请求。独立新home／新状态重复initial、warm、优雅重启后的cold同session，实际仍为1／1／2，共4HTTP，3发表／marker／真实ACK／已完成Activation。完整结果保留；cold多一次请求未隐藏。两批总共8次免费假HTTP，无付费模型调用。

当前能够接受的是直接工具接线及停止屏障修复；不能接受为长期效率达标。下一项成本验证应按原生与产品长期累计输入、未缓存输入、输出及实际价格分别计量，同时保留每轮质量、所有错误和冷恢复成本，不再用一次工具成功或一轮请求数替代总账。

## 连续任务的重复历史

[同内容离线审计](2026-10-07-direct-history-byte-audit.md)保留回执正文、ID及计时值，只将已观察code-mode结果表示变为direct表示，每份历史工具结果少109 UTF-8字节。在旧36产品请求的198次历史结果重放上，对此前紧凑回执投影继续减少21,582字节；第12轮单session的11份旧结果对应1,199字节。这与此前紧凑回执收益分开，不能重复计数。它说明收益会随历史重复累积，但只覆盖旧总输入差账约2.87%的表示投影，不能宣称已解决数倍成本。工具目录的缩减另计，模型调用文本及请求数变化未在该反事实中计入。
