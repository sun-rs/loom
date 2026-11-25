# MEMORY-0 调研结果

2026-11-25。设计稿见 [docs/MEMORY.md](docs/MEMORY.md)。

## loom-next 的实际使用

- 冻结报告记载，L3 盘点的 65 个机制中有 33 个从未触发，专门的 memory 机制记录为 0 次使用，ledger 为 0 次裁决。仓库的账本文档确有历史裁决及运维记录，冻结数字说的是试跑机制的用量。L3 运行约 2 小时且仍需 1 次人工干预。一次能力验收中，原生压缩信号及 `[MEMORY_REFRESH]` 投递已有实证，试跑价值仍要看角色是否实际依靠检索完成工作。[冻结报告](../../../loom-next/docs/FREEZE-2026-11-23.md) · [历史账本](../../../loom-next/docs/LEDGER.md) · [M3 验收](../../../loom-next/docs/evidence/M3-acceptance.md)
- 早期设计要求独立记忆桶、v9 元数据索引、摘要 Worker、内容／哈希守卫、账本哈希链、跨 CLI 原生开关及压缩重注。v0.7 已去掉自动摘要派工、新账本条目的哈希链和宽泛内容正则。实跑日志记下了在技术报告中误判凭据词而拒收一条总结。冻结报告把缺乏价值度量、方法论进入 daemon 和反复返工作为问题。由这些记录推断，应先验证写入、找回与核对确实减轻了交接工作，再增加自动化。[设计修订](../../../loom-next/docs/DESIGN_CHANGES.md) · [M3-A 记忆卡](../../../loom-next/docs/cards/M3-A-file-memory-and-summarizer.md) · [M2-C 账本卡](../../../loom-next/docs/cards/M2-C-live-state-and-ledger.md) · [v0.7 §1、§4.4](../../../loom-next/docs/DESIGN.md) · [实跑日志](../../../loom-next/docs/DOGFOOD_LOG.md)

## 产品与工具链

各条目依次说明范围、写入、读取、过期处置与失败模式。「无独立收益数字」表示所引资料没有给出这一记忆机制的独立对照。风险描述为依据机制推断，明确列出的试验结果除外。

**Claude Code。** 用户、仓库和目录的 `CLAUDE.md` 由人维护，当前路径祖先的指令首启加载，子目录可随工作按需载入。Claude 在会话中把纠正、偏好和调试发现写进机器本地的同仓共享记忆目录。首启只读 `MEMORY.md` 的前 200 行或 25 KB，主题文件按需读取。Skills 的说明用于发现，执行时才载正文。可用 `/memory` 审查和编辑，时间标记辅助识别老条目，笔记保留到有人修改或删除。超长指令、冲突以及索引截断会丢掉关键信息。无独立收益数字。[记忆与指令](https://code.claude.com/docs/en/memory) · [Skills 文档](https://code.claude.com/docs/en/skills)

**Codex。** 人维护全局及仓库／子目录的 `AGENTS.md`，启动时按层级从全局到工作目录合并，受默认 32 KiB 预算和覆盖规则约束。可选本机 memories 把符合条件的历史聊天在后台提炼为文件，读取一个可注入后续聊天的摘要，并可进一步查证据。支持分别关闭生成和使用、限制生成所考虑的历史年龄，以及删除存储。扫描资格、空闲门槛或额度会造成遗漏，历史摘要仍可能过时。LongMemEval-V2 提供原生 Codex 记忆基线，评的是特定回放中的问答检索，产品文档未给 CLI 轮换收益。[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) · [Memories](https://learn.chatgpt.com/docs/customization/memories) · [配置参考](https://learn.chatgpt.com/docs/config-file/config-reference) · [LongMemEval-V2](https://github.com/xiaowu0162/LongMemEval-V2/)

**Google Antigravity。** 发布说明称 agent 从过去工作及反馈生成、检索 Knowledge Items，早期 Agent Manager 可浏览，当前设置文档把它们列为本机应用数据。公开材料未说明精确的条目权限范围、提炼时点、淘汰或冲突裁决。规则可设用户全局或项目范围，由人编辑，也可在会话中用 `/learn` 提炼。启动／每轮应用常驻规则，其他规则可按模型判断、匹配路径或手动加载。规则过大可能降为指针，错误触发配置可能被静默跳过。知识条目可能把旧经验带入新项目。无独立收益数字。[官方发布介绍](https://antigravity.google/blog/introducing-google-antigravity) · [设置](https://antigravity.google/docs/agent-settings) · [Rules](https://antigravity.google/docs/rules/) · [/learn](https://antigravity.google/docs/commands/learn/)

**Orca Bots。** 每个 bot 在指定电脑运行，用户可读改其 `SOUL.md` 与 `MEMORY.md`。Bot 完成首次设置后把职责保存供新聊天使用。支持 Claude Code 或 Codex 的 bot 有新对话后，默认在不忙的次日凌晨整理记忆，支持改周更或关闭。可审阅修改并在可用时撤销 `MEMORY.md`。新聊天复用保留上下文，公开快速入门未承诺记忆全文首轮装载、上限或按题检索策略。后台整理可能滞后，也可能覆盖一条仍有效的经验。无独立收益数字。[Orca Bots 快速入门](https://orca.dev/docs/bots) · [Orca 项目说明](https://github.com/stablyai/orca/blob/main/README.md)

**Devin。** Knowledge 由人创建，Devin 从会话反馈建议新增或修改，用户编辑后保存。范围有个人、组织、企业及仓库绑定。命中描述或宏时读取，绑定仓库的条目在该仓始终应用，过时内容靠更新或逐条禁用。官方正将旧 Knowledge 迁移到保留范围及仓库绑定的插件 Skills。Playbooks 是人工编写、组织共享、启动任务时通过 Shortcut 等入口选用的流程，包含步骤、验收与限制。过宽触发和已过时的流程会误导执行。官方称可减少往返，所引资料无独立对照数字。[Knowledge 与迁移](https://docs.devin.ai/product-guides/knowledge) · [Playbooks 发布](https://cognition.com/blog/june-24-product-update) · [Shortcut](https://cognition.com/blog/sept-24-product-update)

**Cursor。** User Rules 跨工程应用，版本化 Project Rules 用 `.mdc`，另有 Team Rules。人写或改规则，可选常驻、按路径、模型相关性或手动。历史 1.0／1.2 发布说明记载从对话后台生成项目 Memories，其他会话会用相关记忆，1.2 引入用户批准。现行 Rules 文档没有说明旧 Memories 的可用范围或自动过期机制。依赖当前规则维护和响应中的来源核对，防止重复或冲突规则与旧事实误召回。无独立收益数字。[Rules](https://cursor.com/docs/rules) · [1.0 发布](https://cursor.com/changelog/1-0) · [1.2 发布](https://cursor.com/changelog/1-2)

**OpenHands。** 旧 microagents 目录仍兼容。人维护仓库常驻 `AGENTS.md`，以及项目、用户、组织或公共注册表的按需说明。旧无触发 Markdown 全文常驻，关键词或路径触发按会话注入，现代形态通过目录描述发现、按需展开。项目同名条目覆盖用户／公共条目，仍要靠维护者修订旧规则。常驻内容占每轮预算，关键词匹配会漏召回或噪声召回。无独立收益数字。[OpenHands 概览](https://docs.openhands.dev/overview/skills) · [SDK 的加载机制](https://docs.openhands.dev/sdk/guides/skill)

**Letta／MemGPT。** 按 agent 持久，在对话间共享，支持把用户或项目内容分块。当前 Letta 的 Git 型 MemFS 允许 agent 随工作编辑、`/remember` 教学、后台 dreaming 按步数或压缩触发整理。固定核心进入系统提示，档案按需搜索，`/doctor` 审查重复、位置与 token 用量。Git 版本可追溯，仍需角色判断过期。原始 MemGPT 论文表 2 在多会话 DMR 任务报告 GPT-4 Turbo 加 MemGPT 后从 35.3% 到 93.4%，基线只能看递归摘要。该对照限于原论文任务。模型自写会积累错误，常驻核心也可能膨胀。[Letta Memory & dreaming](https://docs.letta.com/configuration/memory) · [MemFS](https://docs.letta.com/concepts/memfs) · [档案](https://docs.letta.com/v1-sdk/memory/archival-memory) · [MemGPT 论文表 2](https://arxiv.org/html/2310.08560#S3.T2)

**Mem0。** 应用可按用户、agent、应用或运行 ID 隔离。应用写入消息，默认推断事实，也可直接写。按实体和查询找回相关条目，由应用决定是否注入。推断和整合有更新路径，另有明确的更新和删除接口。错误归因、归并或近似匹配会把旧事实带回。作者在 LoCoMo 上报告相对 OpenAI 对照的裁判指标提升 26%，相对全文上下文报告 p95 延迟少 91%、token 成本少逾 90%。比较对象不同。[添加](https://docs.mem0.ai/core-concepts/memory-operations/add) · [更新](https://docs.mem0.ai/api-reference/memory/update-memory) · [论文](https://arxiv.org/abs/2504.19413)

**Zep／Graphiti。** 应用把会话消息写到用户 thread，默认汇入用户图，也可另建业务图和写入业务事件。按需取得事实、线程摘要或用户上下文。系统提取带时间的关系事实，衍生有效和失效时间，保留旧事实供按时点回溯。冲突识别及日期抽取会出错，来源仍需核对。作者报告 DMR 94.8% 对 93.4%，在 LongMemEval 上报告相对基线最高 18.5% 的准确率改善及较低延迟。[范围与读写](https://help.getzep.com/v4/concepts) · [事实与时间](https://help.getzep.com/v4/facts) · [论文](https://arxiv.org/abs/2501.13956)

**LangGraph。** Thread 的 checkpointer 保存和恢复会话状态，跨会话 store 的 namespace 由应用自由定义。应用可在响应路径让模型决定保存事实，或后台生成和写入。应用按 key 读取、按过滤条件或相似性查找并挑选要注入的条目。覆盖、删除、摘要和独立事实核验由应用设计。后台更新可晚于读取，错误 namespace 会丢失／串用记忆，完整历史会膨胀。框架文档无独立收益数字。[Memory overview](https://docs.langchain.com/oss/python/concepts/memory) · [实现示例](https://docs.langchain.com/oss/python/langgraph/add-memory)

**Anthropic API Memory Tool。** Claude 在任务前查看目录，工作途中请求创建、读改或删除文件。应用执行这些操作，把虚拟 `/memories` 映射到自己的存储，并决定用户、项目和会话能否共享。交给模型的是目录及按需正文。应用承担隔离和保留策略，仍需要核实过时或错误笔记。官方内部 agentic search 中，memory tool 与 context editing 合用比基线高 39%，无法归因到单项；100 轮搜索节省 84% token 是 context editing 的结果。[Memory Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) · [Anthropic 实验](https://claude.com/resources/articles/context-management)

## 个人助理和旧 raft

**旧 raft 分支。** 当前仓库只有 `origin/raft`，用本地对象 `bf43946040c0f8ab55c867bb013d80e3a02b5c51` 只读核对。分支中的 Loom／RAH 实现将私有记忆绑定稳定 Agent 身份与本机 owner，而非 Room、项目或 ProviderSession。首启 seed 一次，Agent 遇到重要学习写 `notes/` 并更新 `MEMORY.md`；长任务前写 Active Context，完成后更新。Raft 上游提示要求启动或压缩后先读完整小索引，再按需读正文。64 KiB 是整理告警，不是上下文上限。曾试过只显示部分索引，后撤回，因为截断可能丢掉父标题和适用条件。运维范围、原始 Room 消息与 Agent 笔记各有权威来源。交付到模型的入口和提示不能证明模型实际阅读。分支后期还另有频道共享记忆，启动索引限 3 KiB，后续以序号发增量，人可失效或删除；这类共享条目仍区别于 Room 聊天历史。一次早期真实夹具中，OpenCode 写入并修正虚构项目值，换为新 Kimi 会话后答对新值，最终索引 575 bytes、笔记 1,261 bytes；这是有限正反对照，不是准确率测量，后续协议审计也明确未复验真实召回。可借鉴稳定身份和基于原件的验收。[架构](https://github.com/sun-rs/loom/blob/bf43946040c0f8ab55c867bb013d80e3a02b5c51/docs/architecture/memory-and-context.zh-CN.md) · [ADR-0025](https://github.com/sun-rs/loom/blob/bf43946040c0f8ab55c867bb013d80e3a02b5c51/docs/adr/0025-agent-memory-home-and-index-formation.md) · [频道注入](https://github.com/sun-rs/loom/blob/bf43946040c0f8ab55c867bb013d80e3a02b5c51/packages/agent-host/src/channel-memory-index.ts) · [真实夹具审计](https://github.com/sun-rs/loom/blob/bf43946040c0f8ab55c867bb013d80e3a02b5c51/docs/audits/2026-08-30-real-memory-acceptance-and-product-audit.zh-CN.md) · [后续记忆交付审计](https://github.com/sun-rs/loom/blob/bf43946040c0f8ab55c867bb013d80e3a02b5c51/docs/audits/2026-09-08-core-conversation-memory-delivery.zh-CN.md)

**claude-mem。** 插件从会话生命周期 hook 接收事件，后台工作进程把提示、工具观察和会话摘要写入本机存储，带 session 和 project 信息。启动可注入近期上下文，深查走搜索索引 → 时间线 → 按 ID 展开，支持项目与时间过滤。隐私标记可排除指定输入，日期过滤也有助于避开旧结果，摘要更新仍需核对原件。文档三段查询成本是估算，不能当作长期记忆收益。高频工具观察会带来存储、摘要噪声和敏感内容收录风险。[介绍](https://docs.claude-mem.ai/introduction) · [搜索](https://docs.claude-mem.ai/usage/search-tools) · [项目仓库](https://github.com/thedotmack/claude-mem)

**Grok Bot。** 每个个人 Bot 的持久记忆跨该 Bot 的聊天，少量用户资料可跨个人 Bot 共享；团队 Bot 的团队条目由 owner 或 Manager 批准。用户可在对话中教它、询问记住了什么、纠正或要求忘记。重置聊天保留记忆，删除 Bot 清理其记忆。公开文档描述了自动复用，未给首轮注入量或检索算法。私聊记忆可影响群聊答复，且用户可能把 Bot 的复述误当原记录。变更日志有并发保存覆盖的修复，无独立收益数字。[创建、记忆及查看权限](https://docs.x.ai/grok-bot/bots) · [变更日志](https://x.ai/changelog/bot)

**Grok Build。** 另有面向工程的用户全局和项目记忆。每轮完成后后台记观察，`/dream` 合并到按主题的 Markdown，后续会话在开始相关工作前读取。`/memory` 可看实际文件，当前对话指示优先。合并错误或同主题范围混淆会保留旧规则。无独立收益数字。[Memory in Grok Build](https://x.ai/news/grok-build-memory)

**OpenClaw。** 每个 agent 有自己的 workspace；`USER.md` 放稳定用户偏好，`MEMORY.md` 放短的长期事项，日期文件留过程。Agent 和启用的 hook 记笔记，部分入口加载近两天笔记；正文可全文或混合检索，自动注入限可信且已提炼的条目。跨会话原文用 `sessions_search` 再展开。偏好原地更新，日期笔记在查询排序中衰减。按天衰减解决排序，无法确认条目真假，自动注入或过宽索引会暴露不该共享的内容。官方机制文档无独立收益数字；外部实测报告记录过助理的隐私与权限失效，未单独归因到记忆。[记忆层](https://docs.openclaw.ai/concepts/memory) · [检索](https://docs.openclaw.ai/concepts/memory-search) · [Agents of Chaos](https://arxiv.org/abs/2602.20021)

**Hermes Agent。** 每个实例／配置档的 `MEMORY.md` 与 `USER.md` 分别放环境知识和用户概况，默认 2,200 与 1,375 字符，首启形成固定快照。Agent 用工具主动添加、替换或移除，超限要合并或删旧条目，活动快照也可能晚于磁盘更新。跨会话的 `session_search` 用 SQLite FTS5，按会话血缘去重，默认查用户／助手，再以消息锚点展开。短文件限住常驻体积，关键词查询仍可能漏掉同义说法，旧笔记仍要核对。官方机制文档无独立收益数字。[持久记忆](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory) · [会话检索](https://hermes-agent.nousresearch.com/docs/user-guide/sessions)

## 2026 年评测

- **LongMemEval-V2。** 用长时、多模态网页代理轨迹测试知识、历史动作与可检索证据。作者提供无检索及原生 Codex 记忆等基线。论文报告 AgentRunbook-C 平均准确率 72.5%，最强 RAG 基线 48.5%，现成编码 agent 基线 69.3%，且编码 agent 检索有明显延迟成本。Loom 可以同样记录检索是否命中正确原件、答案是否正确，分别计量成本。[论文](https://arxiv.org/abs/2605.12493) · [评测和基线](https://github.com/xiaowu0162/LongMemEval-V2/)
- **Memora。** 同时考记忆、推理、推荐和遗忘，用 FAMA 惩罚继续依赖已失效事实。四个语言模型、六个记忆 agent 的测试中，过时内容被频繁误用，附加记忆带来的提升有限。这支持把「替换后仍返回旧事实」单独计为失败。[ACL Findings](https://aclanthology.org/2026.findings-acl.1337/)
- **Supersede。** 在 LongMemEval 知识更新子集，GPT-5.4 的准确率从全文上下文 92% 降为有界自管记忆 77%。这是一项预印本里的特定对照，说明能找到旧信息也可能答错当前状态。[预印本](https://arxiv.org/abs/2606.27472)
- **MemTrace。** 用当前仓库状态重新检查历史执行证据，并只取下一步需要的东西。作者在 Codex CLI 上报告 DeepSWE pass@1 提升 21.2 分、SWE-EVO 解决率提升 4.4 分、SWE-Milestone 提升 17.8 分。结果依赖该方法、评测和运行配置。Loom 可先复用路径／SHA 核验，并把当前 ref 一致性列入验收。[预印本](https://arxiv.org/abs/2610.04838)

## 草案中的选择与验收范围

- 持久事实采用 Loom Markdown，用户问答复用 Loom 适配器、SQLite 索引和 `loom hist` 查询入口。记录来源、稳定角色及回复关系，避免把对历史的推断当成实际答复。选本机默认 90 天／每范围 50 MiB 是草案参数，需用实际问答密度验证。
- 当前 `loom switch` 的常驻角色入口支持 Leader、Auditor，另有 Worker 配置路径。草案把同一连续性合同扩展到 Super，并提出 `loom hist` 的问答过滤及 `loom memory search`。这些为待实现接口。[现有 CLI 分派](../../cli/loom.mjs) · [会话索引](../../index/index.mjs)
- 实施时可在相同转录上对照现有交接和历史查询。覆盖换 CLI 后仍能按主题和时间还原用户原问与对应回复、同一问答重放只入库一次、后来更正可找到、无对应答复时明确标记、权限外及已删除内容查不到。记录首轮及检索的 token、响应耗时、实际采用和误用次数。本卡完成文档调研和设计。

STATUS: done
