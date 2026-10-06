# 成熟项目如何控制模型上下文：固定源码对照

**确有直接可借鉴的实现。最贴近 Loom 的是“完整记录保留，返回给模型的内容另做投影”，其次是有界读取和按需展开；不是要求模型记住后就自动免掉历史输入。** 这次先读源码再裁决，没有修改产品或运行付费模型。

比较了 Multica、OpenCode、OpenHands SDK、AutoGen 四个官方仓库。固定 commit、许可证、文件 SHA 和阅读范围见[来源清单](2026-10-06-upstream-context-design.json)。后三者固定本次官方 HEAD；Multica 使用已有固定版本并从官方远端独立取得同 revision 文件，逐字核对，不声称它是最新 HEAD。源码存在只证明实现与配置边界，不证明 Loom 可直接使用或获得相同成本。

## 1. Multica：最接近当前问题的返回值精简

固定 `11861145abc59a0d39c8c8f24ad837d4584e664f`。

[`compactComments`](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/server/cmd/multica/cmd_issue.go#L2880-L2912)从工具的 JSON 返回中省去已由请求路径确定的 `issue_id`、运行 bookkeeping `source_task_id`、与创建时间相同的更新时间、null 和空数组，保留内容与其余身份/讨论字段。这发生在 HTTP 读取后的内存对象上，只有 JSON 输出且指定 `--compact` 才执行，不是删除数据库信息。[调用位置](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/server/cmd/multica/cmd_issue.go#L1958-L1970)

源码注释明确将冗余元数据与后续上下文前缀累积联系起来。这是与 Loom 当前情况直接对应的工程问题；上游注释中的节省比例属于其样本，不作为 Loom 的收益证据。

它还把已明确 resolved 的完整讨论映射成“根问题＋结论”；根本身 resolved 则仅保留根。未解决讨论不折叠，标注省略数量，允许 `--full` 取回。`since`、`tail`、只取根等局部结果不满足完整线程条件，拒绝组合折叠；已知不完整的返回也不会折叠。[实现与前提](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/server/internal/handler/comment.go#L154-L279)、[入口检查](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/server/internal/handler/comment.go#L462-L493)

实际提示改成先读讨论索引，再按 thread/tail 有界展开；源码还记录 `recent 30` 限的是线程数量、可能意外返回所有后代回复的问题。[提示与问题记录](https://github.com/multica-ai/multica/blob/11861145abc59a0d39c8c8f24ad837d4584e664f/server/internal/daemon/prompt.go#L380-L406)

**Loom 裁决：** 可借鉴普通成功返回的字段投影；不要把所有内部 ID 和空字段都自动送给模型。讨论折叠只能作后续设计参考，不能把上游 resolved 等同于 Loom 的 Task 完成、消费者 ACK 或“模型已经读过”，也不能省掉尚未真正投递的正文。Loom 不为复制此功能新增场景状态。

## 2. OpenHands SDK：事件存储与模型视图分开

固定 `250dd4817c7174e349f5872e70f5b5a5c17de79d`，范围为 SDK 与 default tools preset，非所有 OpenHands 部署。

[`EventStore`](https://github.com/OpenHands/software-agent-sdk/blob/250dd4817c7174e349f5872e70f5b5a5c17de79d/openhands-sdk/openhands/sdk/conversation/event_store.py#L188-L233)保存事件；[`View`](https://github.com/OpenHands/software-agent-sdk/blob/250dd4817c7174e349f5872e70f5b5a5c17de79d/openhands-sdk/openhands/sdk/context/view/view.py#L111-L159)只选可转换成模型消息的事件，内部状态更新不会因已入事件存储就全部进入模型。压缩记录改变视图，没有把摘要伪装成原始事件。[摘要应用](https://github.com/OpenHands/software-agent-sdk/blob/250dd4817c7174e349f5872e70f5b5a5c17de79d/openhands-sdk/openhands/sdk/event/condenser.py#L52-L99)

每次生成仍发送整个选中视图，不是只把新事件发给 LLM。[调用点](https://github.com/OpenHands/software-agent-sdk/blob/250dd4817c7174e349f5872e70f5b5a5c17de79d/openhands-sdk/openhands/sdk/agent/agent.py#L747-L794) 裸 Agent 的 condenser 为 None；标准工具 preset 才显式装摘要器。默认工厂的限制为 80 个事件、保留开头 4 个；直接实例化摘要类的默认值不同。因此不能说所有 OpenHands 都默认自动压缩。[preset](https://github.com/OpenHands/software-agent-sdk/blob/250dd4817c7174e349f5872e70f5b5a5c17de79d/openhands-tools/openhands/tools/preset/default.py#L97-L107)、[工厂](https://github.com/OpenHands/software-agent-sdk/blob/250dd4817c7174e349f5872e70f5b5a5c17de79d/openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py#L552-L563)

终端工具给模型的呈现可按 30000 字符截断为头尾；配置持久目录时尝试保存收到的完整文本并返回引用。底层部分路径已先截断，不能概括为所有 stdout 永久完整保存。[终端呈现](https://github.com/OpenHands/software-agent-sdk/blob/250dd4817c7174e349f5872e70f5b5a5c17de79d/openhands-tools/openhands/tools/terminal/definition.py#L174-L201)、[截断与保存](https://github.com/OpenHands/software-agent-sdk/blob/250dd4817c7174e349f5872e70f5b5a5c17de79d/openhands-sdk/openhands/sdk/utils/truncate.py#L50-L127)

**Loom 裁决：** 借鉴内部事件与模型呈现分离，尤其是不把运维信息直接渲染为对话。摘要会新增模型调用并可能遗漏内容；SDK 自己拥有 messages 数组，Loom 不拥有第三方 CLI 的完整请求构建器，不能直接装该摘要器替换连续 session 历史。

## 3. OpenCode：先限制工具输出，再管理请求窗口

固定 `3f393d78bfc3f0826b2c7080e57964c235704695`；当前官方代码已在 `packages/core`，不等于用户已安装版本。

[`tool-output-store.ts`](https://github.com/anomalyco/opencode/blob/3f393d78bfc3f0826b2c7080e57964c235704695/packages/core/src/tool-output-store.ts#L13-L173)默认限制工具文本为 2000 行、50 KiB；超限时保存临时全文文件，给模型头尾预览与路径。文件默认保留 7 天，不是永久 Artifact。模型得到的有界文本、session 保存的表示、临时全文不是同一个对象；不能宣称持久 session 保存了无限完整工具输出。[工具出口](https://github.com/anomalyco/opencode/blob/3f393d78bfc3f0826b2c7080e57964c235704695/packages/core/src/tool/registry.ts#L50-L81)

[`history.ts`](https://github.com/anomalyco/opencode/blob/3f393d78bfc3f0826b2c7080e57964c235704695/packages/core/src/session/history.ts#L13-L48)按最新 compaction 边界选择请求历史，不删除更早的持久消息。压缩另发模型请求，保存摘要和近期片段；不是无成本裁剪。[compaction](https://github.com/anomalyco/opencode/blob/3f393d78bfc3f0826b2c7080e57964c235704695/packages/core/src/session/compaction.ts#L177-L245)

它还维护稳定的 context epoch 前缀；普通变化追加，成功压缩后才替换 baseline。缓存 hint 不能保证命中。[epoch](https://github.com/anomalyco/opencode/blob/3f393d78bfc3f0826b2c7080e57964c235704695/packages/core/src/session/context-epoch.ts#L56-L77) 本 revision 的配置虽仍接受 `prune`，当前执行路径不读取旧式 prune 开关，不能照抄旧文章的裁剪阈值。[设置读取](https://github.com/anomalyco/opencode/blob/3f393d78bfc3f0826b2c7080e57964c235704695/packages/core/src/session/compaction.ts#L123-L135)

**Loom 裁决：** 每轮几百字节的成功回执远未达到这种大输出上限，等 CLI 自动截断不会消除其累积。应在 Loom 输出源头精简。大结果按需读取可以参考，但须沿已有授权 API/Artifact 机制，不为短回执另造文件，也不把 Channel memory 写入文件。原生压缩与缓存管理须由已验证的 CLI 能力负责。

## 4. AutoGen：增量投递与模型历史确实是两层

固定 `027ecf0a379bcc1d09956d46d12d44a3ad9cee14`。

GroupChat container 只把新增 buffer 交给 agent；AssistantAgent 随后把它追加进 model_context，每次调用 model client 时仍取 `system + get_messages()`。默认 Unbounded 返回全部历史。[新增 buffer](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_chat_agent_container.py#L128-L145)、[真实请求](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/python/packages/autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py#L1085-L1114)、[默认上下文](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/python/packages/autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py#L837-L848)

Buffered、HeadAndTail、TokenLimited 改的是 `get_messages` 的视图，底层 save_state 仍保存消息。它们不是天然安全的业务摘要：窗口可能丢早期事实，预算不一定覆盖稍后附加的 system/tool 内容。[context 存储](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/python/packages/autogen-core/src/autogen_core/model_context/_chat_completion_context.py#L48-L68)、[TokenLimited](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/python/packages/autogen-core/src/autogen_core/model_context/_token_limited_chat_completion_context.py#L42-L77)

工具结果的公开摘要只改变对外 chat_message；执行 agent 的完整工具结果此前已加入自己的 model_context。不能把“同伴少看工具日志”当作“执行者不再支付工具历史”。[工具历史](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/python/packages/autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py#L1230-L1256)、[对外摘要](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/python/packages/autogen-agentchat/src/autogen_agentchat/agents/_assistant_agent.py#L1507-L1537)

**Loom 裁决：** 学习分层，不能直接移植 model_context；裁掉 Loom 的投递队列不等于裁掉原生 CLI 已有历史。Loom 已区分 Room 回复和内部诊断，不能把已有能力算成这次新增收益。

## 5. 工具厂商的设计建议与源码结论相符

Anthropic 的[工具设计文章](https://www.anthropic.com/engineering/writing-tools-for-agents#returning-meaningful-context-from-your-tools)建议返回对下一步有用的信息、减少低层技术 ID，按需提供简洁和详细结果，并用真实任务评价替代固定工具路径。其[上下文工程文章](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)也强调少量高价值上下文与按需获取。这是官方设计经验，不是 Claude Code 源码审计，更不把文中的省费数字外推到 Loom。

## 对 Loom 的实施顺序判断

| 机制                                  | 当前判断             | 理由                                                                                                    |
| ------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| 普通成功回执的紧凑模型投影            | 优先做最小实现与验证 | Loom 自己拥有出口；完整 HTTP 校验、Kernel 事件、ACK、marker 和 unknown 围栏可独立保留；已有离线字节预算 |
| 投递内部元数据、重复说明精简          | 其次逐项验证         | 同样属于入 CLI 前的表示；作者/目标/因果范围、必要警告及恢复能力必须保持                                 |
| 历史/大结果的索引、有界查询与按需展开 | 按真实缺口补充       | 先查现有能力；不能为了每个几百字节回执反而制造一次读取请求                                              |
| 复制框架窗口裁剪或另造摘要服务        | 本轮不采用           | 原生 CLI 拥有已形成的 session；额外摘要有质量、计费与双重压缩问题                                       |
| 只依赖缓存或原生溢出压缩              | 不作为近期成本修复   | 缓存不是免费；小而持续的协议残留在触发压缩前已累积                                                      |

最小首刀应是一个无新增状态的模型成功回执投影：先定义并测试正常发表、警告、幂等、held、确定拒绝和未知结果；内部完整响应继续验证和保留，模型结果保留必要引用。既有深等值 gate 改为核验投影与真实持久事实的对应，不降低业务唯一性/ACK 断言。随后用免费真实 CLI 链确认最终请求确实变小；真实质量与长期 token 收益仍需独立配对，不能由字节预算或上游名气代替。

这与[上一轮归因](2026-10-06-long-cost-attribution.md)一致，但现在有成熟实现的直接代码依据。项目没有证明“所有旧内容读一次就永不再送”，而是显式管理模型应看到的表示和历史窗口。Loom 先减少自己制造的非必要上下文，保留原生会话连续性和 Room 权威。

## 证据与采用状态

本轮仅源码/文档研究，未移植源码、未安装依赖、未启动 provider、未部署。AutoGen 的 TokenLimited 原函数另做了本地合成计数的局部边界检查，非完整 SDK/模型测试；其余不宣称运行了上游测试。Multica 投影与完整线程保护由第二位审查者交叉核对。固定源码可审计，不证明所有产品部署或安装版本行为相同。

OpenCode/OpenHands 为所读 revision 的 MIT；AutoGen 代码 MIT、文档 CC-BY-4.0；Multica 当前所读许可证是 Apache 文本加附加条件，不能记作纯 Apache-2.0。这里只研究机制，没有复制实现；若后续实际移植，仍需记录来源、许可、差异和测试。Raft 已有客户端/运行时证据不覆盖其服务端完整上下文组装，不能据此宣称其已解决长期成本。
