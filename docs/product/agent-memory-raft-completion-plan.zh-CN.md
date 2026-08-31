# Agent Memory：Raft 剩余能力复用与实施计划

日期：2026-08-30。状态：**部分实施**：默认策略撤回、启动 index-only 收据与旧版只读兼容已完成；Runtime revision 与真实子进程已核验。随后七次真实 OpenCode/DeepSeek 与 Kimi 调用验证了形成、新会话召回、文件可见/不可见反向对照、不同 Agent 和跨 Provider 更新事实召回，见[真实验收报告](../audits/2026-08-30-real-memory-acceptance-and-product-audit.zh-CN.md)。配置闭环、自治维护、长期整理质量仍未完成，未部署到用户在线实例。

收紧修订：默认提示词中的 RAH 记忆价值筛选、跳过清单、项目标签写作/检索规则已撤回；全量 notes 哈希已撤出普通启动路径；自定义独立维护上下文、固定五分钟上限不再作为已接受设计。裁决见[策略收缩审计](../audits/2026-08-30-memory-policy-retraction-audit.zh-CN.md)，实施见[启动收缩验收](../audits/2026-08-30-memory-index-only-rollout-audit.zh-CN.md)。

后续修复：上段状态中的“配置闭环未完成”已由独立修复 A 更新；Human 页面、scoped CLI、持久 revision CAS 和双页面/移动端验收见[Cleaner 配置闭环报告](../audits/2026-08-30-cleaner-config-closure.zh-CN.md)。自治维护与长期整理质量仍未完成，未部署在线实例。

本文细化 [Raft 基线优先原则](./agent-memory-raft-baseline.zh-CN.md)与 [App Inbox 审计剩余项](../audits/2026-08-30-memory-app-inbox-audit.zh-CN.md)，不另建记忆架构。工程边界继续由 ADR-0023/0024/0025 约束。

## 1. 结论与必要性排序

保留一个 Agent 的 `MEMORY.md + notes/`，完整读取索引、正文按需读取，由 Agent 自己整理。先补真实使用证据和现有机制的接线，不增加 observer、向量库、内容切分、按 cwd 分库或后台自动摘要器。

| 剩余项                                  | Raft 已核实的做法                                                                                          | RAH 必要性与本轮裁决                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| prompt / Runtime 版本生效               | 启动时由 driver 构建 standing prompt；官方 Runtime 文档说明切换在下次启动用新 session 生效，身份和文件保留 | **发布必需，先做。** 复用现有不可变 RuntimeProfile import/probe/activate，不另造配置迁移框架                    |
| 真实跨 Room/DM 记忆形成与召回           | 原索引先读、正文按需读；文件跨 idle/session reset 保留                                                     | **发布必需，先验收。** 测试必须排除旧 Provider session、Room 历史和提问泄露答案的替代解释                       |
| cleaner 配置动作                        | 独立 App 配置 revision、读取后条件更新；提示的 action 可提高阈值，后台不会自动执行它                       | **最小闭环必需。** 先提供真实 scoped 配置动作；没有动作时不得显示可执行的假指引，不扩建通用 App 平台            |
| idle 自治维护                           | 超阈值提示可通过 restart snapshot 启动普通 Agent；不是每次 idle 都整理                                     | **完整 Raft 生命周期对齐需要。** 先评审复用同一 Agent 启动流程；暂停自定义维护 Runtime 方案，不阻塞基础召回验收 |
| busy / active notice                    | 有进程且 session ready 后仍按 Runtime 能力决定；不支持时不强行投递                                         | **后置能力。** 首版等当前工作结束或下次 Activation，不为所有 Provider 新开发 steer                              |
| 全量 notes digest 成本                  | 已取得的 cleaner 路径只测 `MEMORY.md`，不是每次启动哈希全部笔记                                            | **已收缩。** 新 Run 只记录索引，旧全量收据只读兼容；显式 Human 检查仍保留，不扩建审计或缓存服务                 |
| 跨 Computer handoff、远程 Human control | 安装包有迁移协议/执行代码，但官网 workspace 文档称不可迁移，存在证据冲突                                   | **本机版后置。** 不能据文档断言 Raft 无迁移，也不能据代码存在宣称线上迁移已通过                                 |
| 临时无记忆对话                          | 本次核对的基线仍要求读索引；未找到足够证据证明 Raft 提供硬隔离开关                                         | **独立需求，非本次基线门禁。** 关 cleaner 不等于关记忆；删 prompt 也不等于阻断旧上下文和文件读取                |

“Raft 等效”分两层：普通对话的跨会话记忆可先交付；空闲维护属于后续完整生命周期门禁。busy notice 是按能力支持，不要求每一家 CLI 都具备相同投递方式。

## 2. 固定源码证据与未证实边界

主证据：授权取得的 Raft Computer **1.0.18**。本地根目录：`/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/`。

`main.js` SHA-256：`20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。纯 memory prompt 切片 4,049 bytes，SHA-256：`b47ccf545645f927d543aa377d50434b6d0982896c28d7794f1f90b801e97f83`。不声称这是 Raft 最新发布版本。

| 文件 / 符号                                                                  | 可复用的已观察行为                                                                                       |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `memory-slices/memory-standing-prompt.js`                                    | 索引、notes、Active Context 与压缩恢复规则；当前已 byte-exact 纳入 RAH                                   |
| `memory-slices/memory-index-cleaner.js`，`SystemCleanerRuntime`              | 默认一小时检查，64 KiB 阈值，10 秒测量边界；revision fence、transient hint、失败不作成功推断；不改写文件 |
| `memory-slices/memory-cleaner-contract.js`                                   | source identity、阈值上下界与建议值、`materializeCleanerActionCli`                                       |
| `main.js:732460`，`src/commands/app/config.ts`                               | `getConfig` 后带 `expectedRevision` 调用 `patchConfig`；冲突报错；unset 回到默认                         |
| `main.js:764777`，`notifyAgentAppInbox`                                      | 内容为空的计数提醒；active 能力检查；只有 `idle` lifecycle record 才使用 restart snapshot                |
| `main.js:768046` 附近的 notice memo / idle drain                             | 按 item 去重，删除失效 ID，idle transition 后有界 drain；投递成功不证明整理完成                          |
| `main.js:763257`，`RuntimeProcessBindingFence`                               | runtime 与 Agent/process instance/launch/session 绑定，过期进程或错误 session 拒绝输入                   |
| `main.js:765158`、`765952`，standing prompt / `buildSpawnConfig`             | 正常启动构建 prompt；idle wake 复用普通启动路径与 managed runner credentials                             |
| `main.js:732523` 附近 migrate 命令、`772556` 后 migration transport/transfer | Agent 不能自行发起迁移；错误文本指向管理员操作；存在实际 transfer 执行代码，未做线上完整验证             |

辅助一手资料：

- [Raft Lifecycle](https://docs.raft.build/features/agents/lifecycle/)：idle 与 Human stop 不同；停止后不由触发器激活；session reset 保留 workspace。
- [Raft Runtime](https://docs.raft.build/features/agents/runtime/)：更换 Runtime 在下次启动使用新 session，不改变 Agent 身份和记忆。
- [Raft Workspace](https://docs.raft.build/features/agents/workspace/)：Agent 自行管理持久文件；其不可迁移说明与本次 bundle 的迁移路径存在冲突，暂不据任一方推断线上完整能力。
- [Multica memory #838](https://github.com/multica-ai/multica/issues/838)：本次读取仍为 open proposal，内容是 workspace 级索引与按需正文。这个 issue **不是已合并实现证据，也不足以证明整个当前 Multica 没有其他记忆实现**。本次不据它替换已取得的 Raft 代码。

Claude-Mem 的自动观察/编译路线与本次 Agent 自主管理文件的基线不同；此前研究保留在[记忆形成机制审计](../audits/2026-08-30-memory-p0-and-formation-audit.zh-CN.md)。本计划不移植其 observation pipeline，也不重做跨项目分类；后续只有具体缺口才追加固定 commit 的源码研究。

## 3. 最小适配设计

### 3.1 prompt 生效：用现有 Registry，不覆盖冻结版本

已核实 RAH 的 `localWorkbenchWorkerPrompt()` 进入 Runtime spec 的 `args`，再进入 manifest 的 `fixedArgs`。`prepareLocalWorkbench()` 对已有状态会重新 import/probe/activate；因此“重启也一定不会更新 prompt”并不准确。当前已运行进程不会热更新，其他显式配置/自定义 profile 也不能视为自动升级。

实施顺序：

1. 对测试实例列出当前 active revision、完整 prompt digest、memory transport schema 和实际 Provider continuity key；不读取或输出凭据。
2. 沿用 `RuntimeProfileRegistry.importManifest → probe → activateRevision`。相同内容幂等，不原地修改旧 revision、不覆盖用户自定义 profile。
3. 对新启动验证实际 Placement/RunAttempt 选中目标 revision，而不仅是 Registry 中有记录。旧在途 Run 保留自己的冻结输入；发布等 idle，不偷偷杀进程。
4. `ProviderSessionStore` 的 key 已包含 participant、provider、RuntimeProfile revision 与 workspace revision。测试证明新 revision 不误用旧 session；无需为更新 prompt 全量 reset Agent memory。
5. 回退是选择原 profile revision，保留两版 provenance；回退不承诺撤销期间 Agent 已写入的文件。只有隔离测试实例执行自动回退实验，用户服务发布另行明确操作。

验收涉及 `local-workbench-bootstrap.test.ts`、Registry、Provider session store、local/remote composition；不为记忆另写 Provider 启动参数和历史解析器。

### 3.2 cleaner 配置：独立配置 revision，而非角色 revision

当前 `agent-memory-coordinator.ts` 的 `cleanerConfig()` 每次由 AgentDefinition revision + 固定默认值生成。若只接阈值按钮，下次 Activation 会覆盖设置，这是必须先处理的接线缺口。

最小设计：

- 配置仍由 Computer 的 Memory coordinator 持有，只允许 `enabled / thresholdBytes / intervalMs`，独立单调 revision；无任意文件路径、owner 输入、模型选择或 Room 参数。
- 默认继续使用 Raft 值；override 采用 owner-private 原子持久化。无 override 时不要求新配置文件，不改变现有 seed 或索引格式。
- scoped CLI 复用现有 App Inbox credential/wrapper 生命周期；读取配置后条件更新，冲突返回当前 revision，不自行循环重试。Human 入口复用既有 Computer control 与管理 ACL，而非给浏览器本地文件路径。
- 应用配置与原子落盘必须具有明确提交次序和失败恢复：保存失败不能返回成功；进程恢复以已提交 revision 重新建立 timer。测试覆盖并发 patch、故障和后续 Activation 不覆盖。
- 建议阈值沿用 Raft 的加倍/上限算法；**不自动提高阈值，更不以提高阈值冒充减少上下文**。低于新阈值只代表满足配置，不证明文件已整理。
- `enabled=false` 只停止 cleaner 提醒/自动维护，不关闭 Agent 的记忆读取和写入。UI 与 CLI 文案必须明确。

该配置文件是既有 cleaner 的配置承载，不是第二份记忆库或业务 Inbox。不因三个字段引入通用 RAP App registry。

### 3.3 idle 维护：上游流程优先，适配方案待审议

直接保留上游已取得的分支：检查超限产生 hint；对可接收的现有 Runtime 发通知，否则只有可信 `idle + restartSnapshot` 才调用普通 `startAgent`。Human stopped、starting、cooldown 不能当 idle。不是定时由另一个模型总结所有聊天，也不是每次 idle 都整理。

Claude-Mem 本次核对的主链是 Hook → 后台 Worker/observer → 结构化 observation/summary → 检索；其 `Stop` summary 与 Raft 唤醒原 Agent 整理文件不是同一机制。不能只抽取 observer 的跳过规则，再把它接到 Raft 的文件体系中当成熟整体实现。

暂停此前独立维护上下文、固定五分钟上限和新管理执行路径的实施。它们尚无真实效果证据，不能仅凭“更安全/更省 token”的设计意图默认采用。下一次设计审议需先完成：

1. 将 Raft `notifyAgentAppInbox/startAgent` 分支映射到现有 AgentHost/driver，明确哪些代码可直接保留、哪些接口必须适配；不新增旁观 Agent 或第二套 Provider adapter。
2. 现有 RAH 启动输入是 Room-scoped `ActivationEnvelope`，权限也是 Activation-scoped；Raft 普通启动的 managed runner credential 与之不同。必须单独解决这个接口差异，不能伪造 Room/Activation，也不能把所有普通 Worker 凭据直接暴露给未授权维护。
3. 已有同 Agent 单 lane、真实 terminal proof、Human stop、凭据回收继续作为不变量。是否需要独立执行上下文必须比较复用原上下文的行为、权限和恢复成本后再决定；不能把“独立新上下文”当成上游原设计。
4. 源测量、通知 ack、执行退出和语义质量仍分别记账。没有双 lane、没有错误业务写入，不等于整理没有漏掉知识，后者必须实测。

本机/remote composition 的 wake 当前仍为 unavailable；此修订不自动启用后台模型调用，也不修改现有 memory 文件。

### 3.4 active notice：可选投递，禁止扩展为第二条消息通道

先支持自然结束后/下一次 Activation 读取 hint，能验证基本记忆闭环。随后仅对已有认证能力的 Runtime 接入上游 content-free notice 与 binding fence：

- 在现有 Run 内发送不另 acquire idle-only exclusive lease、不启动第二个进程；严格绑定 Agent/process generation/session/turn。
- 当前接口尚无统一 `send`，不能因为 Raft descriptor 标了 `direct` 就宣称 RAH adapter 已支持。只接已有可证明的投递能力，unsupported 明确 defer。
- 去重参考 Raft item memo，但适配 RAH item version 和当前 runtime generation；一次“已写入”不能长期屏蔽新版本/新进程。
- 发送前后状态变化、迟到结果、进程替换和 provider 拒绝必须有反例；不据 stdout/模型自述确认投递或整理。

### 3.5 notes 全量哈希：已撤出普通启动，不增加缓存

改造前已追踪消费者：`materializeAgentMemoryForRun` 生成全量 files/digest；同一 Run 再次物化做一致性检查；`prepareAgentMemoryRun` 仅使用首项索引 digest 校验索引读取。未找到聊天调度、Task 状态或执行恢复消费全量 notes digest 的路径。

结论：全量哈希有诊断与导出校验价值，但没有充分理由成为每次聊天的必经路径；它不存正文、不能恢复笔记、不证明模型读取，也不是文件系统的原子快照。即使本机当前很快，也不能仅凭性能合格证明功能必要。

已实施的最小收缩：

1. 普通启动保留稳定 Agent 目录、索引原文读取及必要的 owner/路径/读取安全检查；不为生成审计清单预读全部 notes。正文仍由 Agent 按需读取。
2. 新记录为 v2，`coverage=index_only`，files 只能有 `MEMORY.md`，不再有 snapshotDigest。旧 v1 全量收据只读兼容且原字节保留，旧 Run 不能以局部检查重新物化；须使用新 RunAttempt。不伪造 notes digest，不自动改写历史。
3. 全量扫描只在显式审计/导出等确实需要它的动作中使用；UI 的内容读取校验与正常启动解耦。按需检查不声称在同 UID/full-access 下形成强文件系统隔离。
4. 反例证明大量或无关 notes 不再触发启动全量读取，旧 receipt 可读、同 Run 身份仍受保护、索引读取安全不退化。测量用于验证是否真正减少 I/O，不新写增量索引/缓存数据库。

该缺口已通过零笔记读取/零目录遍历、4,100 文件、旧版读取、索引竞态、UTF-8/BOM、owner/身份/完整 policy ref 与父目录链接反例。新 schema 是 RAH 收据适配，不宣称为 Raft 原源码；既有索引文件与 notes 未迁移或改写。

## 4. 分阶段开发与停止条件

| 阶段                  | 交付范围                                                                           | 退出条件                                                                               |
| --------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A：基线收缩与实测     | 撤回附加语义规则；收缩启动全量扫描并兼容旧收据；验证 prompt/revision 与真实召回    | 原文保留，无自增选择策略；实际使用当前版本，记忆来自文件而非旧上下文；不先开维护       |
| B：配置与维护判定     | 最小 cleaner 配置 owner/CLI；复用 Raft lifecycle 分支的可测试 decision；启动仍禁用 | 并发配置/恢复正确，Human stopped 永不自启动，queued Human 工作优先，不能制造 Room 事件 |
| C：维护流程审议后实施 | 暂停自定义方案，先证明 Raft 原启动/通知流程与 RAH 权限边界如何最小适配             | 设计差异逐条评审后才写代码；单 lane/停止/恢复/记忆质量验证均需通过                     |
| D：可选能力           | 已有 Runtime 的 active notice；未来成熟记忆体系的整体评估                          | 不扩建自有记忆引擎，不因可选能力延迟本机基础闭环                                       |

跨 Computer handoff、临时无记忆硬隔离、大型检索/分类体系均不塞入 A–C。

未来若整体引入成熟记忆体系，应固定上游版本并评估完整的采集/形成/存储/检索/维护链路、Agent 隔离、多 Provider、上下文与后台模型成本、数据迁移和回退。批准前继续保留朴素 Raft 文件基线，不提前开发抽象 MemoryEngine、通用插件接口或第二份索引数据库。不同体系的片段不得无对照地混成默认策略。

每次行为变更遵守 TDD：先反例失败，再最小实现，最后定向与仓库门禁。不修改原 `raft-ui` 母版；如需配置 UI，复用现有 Raft 控件/状态协议，官方无对应可验证入口时标为 RAH 扩展，不能凭空声称 1:1。

## 5. 最终验收：用户结果与后台证据同时成立

1. **形成**：在隔离测试 Agent 的 Channel 告知一次不可猜测的事实及一条限制条件，通过真实模型形成短索引与按需 notes。测试 harness 不代写内容来冒充模型记忆形成。
2. **跨对话召回**：在全新 DM/Channel 与新 Provider session 提问，问题不包含答案；确认 input/Room delivery 不含旧事实，但回复正确保留限制条件，并有相应文件读取证据。模型说“我记住了”不算证据。
3. **反事实对照**：同模型、相同问题、隔离 continuity，使用临时复制的测试 memory 做可见/不可见两组；不同 Agent 不获该内容，不能把偶然猜中当召回。测试不读取或改写用户真实记忆。
4. **切 Runtime/恢复**：至少两个已经明确允许的真实 Provider，记录 CLI/model/effort、profile revision 与 session evidence；身份/人设/文件不变。使用当前已验证的 OpenCode/Kimi 等 profile，不自动选择更贵或 Ultra 模型。重启仅操作隔离 fixture。
5. **更新与整理**：更正旧事实后不能继续答旧版本；手动开启一次真实维护后索引大小可检查，notes 内容与限制条件仍在且可召回。单纯缩短或提高阈值不通过质量门禁。
6. **生命周期反例**：忙时不双启动、停止时不唤醒、lease 超时不放行；维护期间新消息随后正常回复；SIGKILL 后只凭 terminal/recovery evidence 解除 fence。
7. **浏览器结果**：先同尺寸大屏 1440×1000 核验 Raft 与 RAH 的 Agent workspace、Channel、DM、Runtime 更换/恢复语义；再验证 390×844 共用交互。保存操作、截图、canonical 消息和文件/Run 证据；不能只报 DOM 单测通过。不能公开读取 Raft 私有服务端状态时，明确哪一侧只有可见 UI 证据。

上一次 633 项后端测试等记录属于 [App Inbox 实现审计](../audits/2026-08-30-memory-app-inbox-audit.zh-CN.md)，不是上述计划已完成的证明。A–C 全部有当前版本 E2/E3 证据后，才能宣布本机 Memory 核心闭环；未支持的 active notice、远程和隐私模式仍单独列出。
