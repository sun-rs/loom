# OpenCode 内部 Worker MCP 与成功 final 停止边界

本审计限 **OpenCode 1.18.32**，官方 revision [`545f51d26cc39a907d2867492d498d9607ea5fa4`](https://github.com/anomalyco/opencode/tree/545f51d26cc39a907d2867492d498d9607ea5fa4)。在保持连续 warm session、`--pure` 用户插件隔离、不按“当前／最新 Run”猜身份的条件下，当前公开能力没有已验证的内部 MCP 安全接线与成功 final 同步停止路径。结论不是 MCP 协议理论上不可能，也不适用于未经审查的未来版本。

正式 OpenCode 产品路径继续使用 Worker CLI。没有采用改造用户安装的 CLI、放开用户插件、每轮冷启动偷换 warm 合同或重复调整提示词来宣称问题收口；现有 MCP facade 不宣称 final 后零追加生成。

## 源码依据

- **插件隔离**：[plugin/index.ts:183](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/plugin/index.ts#L183) 在 `flags.pure` 下清空外部插件集合。自有插件的 before/after hook 也不能通过普通配置绕过这条边界。
- **原生身份缺口**：[mcp/catalog.ts:54](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/mcp/catalog.ts#L54) 发出的业务参数只有工具名和 arguments；进度 token 不证明原始输入／Run。不能从模型正文、到达时间或当前 active Run 补造身份。
- **after hook 不是停止契约**：[插件接口:274](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/plugin/src/index.ts#L274) 的返回类型为 `Promise<void>`，可处理输出，没有成功结果的 return-direct／stop 控制项。[session/tools.ts:420](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/session/tools.ts#L420) 在 MCP 返回后调用 hook，此后才整理、截断并返回工具输出；hook 返回不等于回执已完整保存。
- **工具之后继续模型循环**：[session/prompt.ts:1101](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/session/prompt.ts#L1101) 明确要求工具结果回送模型：即使 finish 是 `stop`，仍有工具调用就不按普通最终回答退出。[processor.ts:693](https://github.com/anomalyco/opencode/blob/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode/src/session/processor.ts#L693) 的停止出口是 blocked／error，另有 compaction；没有“成功 final 回执保存后、下一请求前”的公开同步闸门。把成功发布伪装成错误／拒绝不能替代该契约。

## 免费实测及含义

[四家 MCP 验证](evidence/2026-10-04-worker-mcp-four-cli.md) 已证明工具协议可调用；OpenCode 同一 `serve --pure`、同一 session 两轮，各一次 MCP 调用、两次本地假模型请求。这不等于安全 warm Run 绑定或成功 final 停止。

另一次[最终停止探针原始结果](/Users/sun/.loom/reviews/2026-10-04-channel-cost-research/opencode-final-boundary/result.json)在隔离实验配置中启用自有观察插件，**并非产品 `--pure` 路径**：两轮均保存完整假回执，随后各出现第二次模型请求，异步 abort 未能消除它。假 Host final 信号是合成时序，不是真实 Kernel 提交证明。复现脚本、插件与分析同存该归档目录；没有付费模型、真实 Worker 写入或全局 CLI 配置变更。该证据支持“现有控制不能保证省掉后续请求”，不证明所有实现都不可能做到。

可靠实现至少需要可信的原始输入到工具调用映射，以及回执完整保存、并发工具收束之后、下一模型请求之前的同步停止能力。当前公开接口未提供这条完整路径；本轮不扩建适配框架，也不以异步抢停当作零请求证明。

因此，后续生成是当前实现**无法承诺消除**的成本，不应描述为语义协作必需成本。历史 P103 原生入口受继承 `PWD` 影响，加载了不同工作目录，其数值不能作为公平预算验收。修复工作目录后的免费探针仅证明入口选对目录；后续效率预算仍需公平同题的新批次验证；owner 本轮已授权持续开展必要的四家付费验收，无需逐批重复询问。本文不修改目标合同或产品状态。
