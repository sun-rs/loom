# Loom 角色遵循研究与设计选项

2026-11-28 · Loom 取证 CLI 和研究基线 `24147c64130fb7412cc4a29b31d57f37b322fd16`。本文供设计讨论。

两个 pilot 已经能记录并拦截一批高级角色的工具请求。现存记录对模型漏报、自行待命、换班后漂移和压缩后丢规则的观测要弱得多。7 次状态库交接失败全部发生在首报验证前。把这 7 次归到模型身份漂移，会优先修改提示词，却留下已经确认的投递和状态机问题。

本文承接 [11-27 身份研究](2026-11-27-agent-identity-adherence.md)、[换班与重启恢复 v2](2026-11-27-lifecycle-design-v2.md) 和本分支 [角色核心](../../skills/loom/SKILL.md)。新增部分是 pilot 的计数与归因、其他项目的实现核对，以及不同强制程度的方案。

## A · 两个 pilot 的失败证据

### 取样与计数

- **P2** = `/Users/sun/Code/loom-pilot2`，现场 HEAD `af01c396438352697fcf49596a878c23cd37b823`，状态快照 19:16:18 CST。**Cell** = `/Users/sun/Code/loom-pilot-cell`，现场 HEAD `491288257c00bdd21cfb6a3ed62f87a83a15461d`，状态快照 19:16:09 CST。HEAD 标记取样工作树。历史会话跨多次 release，依据逐会话元数据和当时裁决解释。
- 两边各用一次 `LOOM_EXTERNAL_SUPER=1 /Users/sun/.loom-cell/releases/24147c64/bin/loom status --project <绝对路径> --json`，按 `seniorTools` 的角色、事件类型和类别求和。用各自 `.project/loomd/notifications.json`、`sessions/` 的结构化字段和局部工具回执，与 `rulings.md`、审计和 notes 互证。下文路径以 P2 或 Cell 为根。单行 JSON 给出行号和字段或记录 ID。
- **已证次数**以同一次行为或事故为单位，同一证据重复出现只计一次。已确认的事实错误、拒绝尝试、例外授权、投递故障和未分类观测各自保留原来的含义。表里的 0 表示本次取样未证实实例。缺少触发机会或原生最终回执时，无法算总体违例率。没有读取凭证或完整 transcript。

| 项目 · 角色 | `senior-tool-denied` | `senior-override` |
| --- | ---: | ---: |
| P2 · Leader | 21（读 10 / 搜 4 / 未分类 7） | 1（未分类 1） |
| P2 · Auditor | 201（读 86 / 搜 44 / 未分类 71） | 160（读 72 / 搜 35 / 未分类 53） |
| **P2 小计** | **222** | **161** |
| Cell · Leader | 118（读 13 / 搜 3 / 集成 17 / 未分类 85） | 100（读 4 / 集成 17 / 未分类 79） |
| Cell · Auditor | 152（读 58 / 搜 10 / 未分类 84） | 121（读 52 / 搜 8 / 未分类 61） |
| **Cell 小计** | **270** | **221** |

当前聚合对 session 回执逐条计数，例外回执记录授权节点，执行结果需要单独证据。旧版还允许 Worker 不可用时产生无配对拒绝的例外，不能用例外总数除以拒绝总数估算转化率。Leader 两边共有 30 次读或搜索类拒绝，覆盖全量 diff、流水线和命令链等分类。Cell 的 17 次集成拒绝和 17 次例外为两个事件计数，不能推导出 17 次违规合入。工具拒绝次数也受会话长度、当时版本及命令分类器覆盖影响。 [聚合与例外实现](../../daemon/senior-tools.mjs#L12) · [工具分类实现](../../lib/senior-tool-guard.mjs#L157)

| 失败类型 | 已证次数及相关观测 | 实例与推断 |
| --- | --- | --- |
| **角色越权** | P2 有 1 次 Worker 自行停用 Git hooks。另有 1 次 Leader 亲跑全量测试的行为证据，发生于 11-25，早于 11-26 的 R21，故无法判为违反 R21。Cell 有 1 次 C3 超出宿主机授权次数。两边各 0 次可证实的 R21 生效后 Leader 亲跑测试或违规完成源码读取。 | P2 `.project/pilot2-final-report.md:8,47–49` 的 Leader 测试和 Worker 提交。限制生效时间见 P2 `.project/rulings.md:20–22,33`。Cell `.project/rulings.md:18` 明签一次违规。Cell `.project/loomd/sessions/loom-f1f61a04-4a73-4300-8a41-5b5105034a40.tool-guard.jsonl:178` 拦到含仓库级 Git 搜索的冲突检查。推断是角色倾向用熟悉的 shell 路径直接取证，分类器也会拦到合法的混合命令。P2 Leader 的部分旧回执只含类别和哈希，测试数量无法从该类别还原。 |
| **格式违规** | P2 0 / Cell 0 条已证实的最终回复格式违规。两边各 2 条 `no-final-reply`。Cell 另有 2 条 `worker-result-unconfirmed`。 | Cell `.project/notes/decision-goal4-leader-undelivered.md:3–12` 里，Auditor 明确给出 `REJECT`，但系统记作 `no-final-reply`。这是缺少可确认的输出边界。P2 的成功对照见 `.project/audit-goal5-tests-r2.md:9`。状态的 `lastResultTag` 不含原始行数和尾部，`firstReportCheck` 校验基线事实。推断应先识别回合边界，再判格式。 |
| **忘记裁决** | P2 / Cell 各 0 次证实在已收到且生效的裁决下仍按旧版行动。有 P2 **1 次简报漏载裁决**，以及 R45 的 **1 次识别后延迟写入**（整批最终 3/3 写入）。 | P2 `.project/audit-notes.md:21–25` 记录编号账本解析为空、交接单指针遗漏，继任者自行找到交接单。P2 `.project/rulings.md:66–70` 记录旧 Leader 把应写内容留给继任者，且首次读回来源混杂。推断分别是裁决供给缺口和动作未落地。R45b 后续在空目录验证读取通过，见 P2 `.project/goal9-final-report.md:30`。 |
| **原地待命不推进** | 可证实的主动空等 P2 0 / Cell 0。P2 有 5 条高级角色 `idle-without-stop` 告警（Leader 4、Auditor 1，至少 1 条误报），Cell 0。高级角色续作超时为 P2 3 / Cell 1，均路由到 Leader。 | P2 `.project/audit-notes.md:40–42` 记后台测试日志仍在增长。Cell `.project/notes/decision-goal4-leader-undelivered.md:9–17` 记 Leader 能发门禁包，近 27 分钟仍收不到那条补发。两边分别共 190 / 263 条 `stuck`，绝大多数是 OAR 会话的 `busy-without-output` 告警。推断是把可写、安静、工具/子进程活动和业务进展混成了一个信号。判断主动待命还需可执行事项、成功投递和无推进动作三者。 |
| **该报不报** | P2 **1 次已证实错报**，另有 **≥1 次**裁决或纠正随 `NOREPLY` 被逐轮整理跳过。Cell **0 次**可归责于角色的漏报，确认 **1 个 Auditor 门禁结论**自动回传丢失及 **2 个 Worker 结果**缺父级回执。 | P2 `.project/audit-notes.md:15–16` 的证据声称沙箱拒绝为 0，原件却有拒绝。P2 `.project/audit-goal8-tests-r1.md:9–10` 核实跳过现象，裁决账本同步仍有效。Cell `.project/notes/decision-goal4-leader-undelivered.md:4–12` 给出 `534ad0d6`、`ec3b37a6` 和 `5400c542`。推断是人工复述、完成回执和上报义务未形成同一条可查记录。 |
| **交接后身份漂移** | P2 0 / Cell 0 次确认。P2 15 条换班里 11 verified、4 failed，Cell 3 条均 failed。P2 9 个已验证首报有非零 `firstReportMisses`（1 个 12、8 个 1）。Cell 3 个继任者均 0 回合、未绑定。 | P2 `.project/audit-notes.md:20–25,42` 人工核过 12 项误报，另 8 个首报没有同强度证据。Cell `.project/rulings.md:27,51` 记两次 `waiting-writable` 和一次疑似启动提示被认成 `draft-held`，三个 `handoverFailure` 亦见下表。推断是验证信号和投递就绪错位。身份漂移需在成功绑定后看到角色、当前裁决或首动作发生偏离。 |
| **压缩后丢规则** | P2 **1 次记录到的高级角色压缩**，Cell **0 次观测到**。两边均 0 次能配对到压缩后规则违例。P2 的高级会话压缩字段为 1 个 1、14 个 0、3 个空值，Cell 为 3 个 0、3 个空值。 | P2 `.project/loomd/sessions/loom-d173a83a-ee67-4133-8ba1-ae3ac3cbe6ce.json:1` 的 `compactions` 有一对 Pre/Post，status 中对应同一次压缩。首个可用窗占比样本较事件晚约 9 小时，不能定位首个压缩后回复。P2 `.project/audit-goal5-merge-r3.md:24` 也只确认了书面冒烟记录。推断当前缺“触发 → 已回注规则版本 → 首个完整回合 → 同一规则的前后表现”关联。Cell 的 `compactHandover` 是首投形态。 |

`status.rotations` 与通知的覆盖范围不同。用 `successor` 计失败，用通知和会话元数据交叉验证，避免重复加总。

| 项目 | `status.rotations` 确认的失败 | `notifications.json:1` 的交接失败条数 |
| --- | --- | ---: |
| P2 | Leader `919d7ab2` 已绑定但验证前退出（截断详见 `.project/audit-notes.md:10,23`）；Leader `0f49cd82`、`8c4e7092` 在绑定前退出；Auditor `dfa8ec8d` 为 `payload-mismatch`。 | 3（Leader 2、Auditor 1） |
| Cell | `44fff2c4`、`5f88388a`、`e6aaf773` 的会话 JSON 各在第 1 行记 `handoverFailure.reason=self-rotation-overdue`。C11 与 C27 给出各次上游原因。 | 3（Leader 3） |

已有受控评测补上了一部分因果线索。SKILL-SPLIT-1 第二阶段各 138 个有效回合，整题通过 54→66，应读未读 19/30→2/30，三个 CLI 中 Codex 输入均值增加约 4.8%，Codex Worker 与 agy Auditor 有回退。第三阶段补测仍有不可评分轮次，历史原生 Claude 路径与此次要求的 CCP 路径不同。另一个目标 9 评测里，8f 写入提醒在两套脚本中命中 10/10、误报 0/4，但 R45 的实际例子仍出现当轮漏写。这两组评测支持把“是否收到规则”“规则是否执行”“业务任务是否达标”分别计量。 [SKILL-SPLIT-1 第二阶段](../../tasks/SKILL-SPLIT-1/RESULT-PHASE-2.md#L5) · [第三阶段](../../tasks/SKILL-SPLIT-1/RESULT-PHASE-3.md#L23) · P2 `.project/goal9-eval-comparison.md:11–26`、`.project/rulings.md:66`。

## B · 其他项目怎么加载和执行规则

公开仓均为 2026-11-28 只读源码快照。Cursor 的客户端规则引擎和 Claude Code 的核心加载器没有可核对的公开源码。下文区分官方接口、公开扩展实现和未验证的内部行为。这里的效果数据专指相关行为的对照测量，源码测试、发布说明和一般任务成绩各只证明其所覆盖的部分。

### Orca · 1.4.272 与公开源码 70c9eccd39a005466697003e161fe2052f5b65d8

- **放置与注入**：bot 名称和宿主生成的 Tools and Rules 一起成为规则块。启动给新上下文播种。若 Orca 不能确认续接上下文已持有当前块，则在下一次正常投递前置整个新块和替换声明。键由版本串 `v2`、名字行和内容一起做 SHA-256。SOUL.md 的更新也单独带替换范围。本机包 `out/main/index.js:4588–4596` 能定位同一行为，解包后该文件 SHA-256 为 `547f8990f664e664c4e9e5b54e97d7dc99ef66396dd23582478ed5ca7ea11f1b`。 [规则计划与回执](https://github.com/stablyai/orca/blob/70c9eccd39a005466697003e161fe2052f5b65d8/src/main/bots/bot-turn-rules-update.ts#L9-L91) · [SOUL 与指纹](https://github.com/stablyai/orca/blob/70c9eccd39a005466697003e161fe2052f5b65d8/src/main/bots/bot-turn-memory-update.ts#L43-L90)
- **续接、压缩、校验**：按 provider 的 `instructionsEachStart` 和上下文记录判断重播。只有持久回执成功才推进已送版本，失败或接管后可再次搭送。宿主也能对无运行的 in-progress 项目去重提醒。已找到压缩 UI 事件，但未找到它直接清除规则回执的证据。代码核对交付和活动状态，替换语义靠模型。公开测试覆盖回执和交付分支，未见规则遵循前后对照。 [启动判断](https://github.com/stablyai/orca/blob/70c9eccd39a005466697003e161fe2052f5b65d8/src/main/bots/bot-session-instructions.ts#L7-L60) · [主动工作提醒](https://github.com/stablyai/orca/blob/70c9eccd39a005466697003e161fe2052f5b65d8/src/main/bots/bot-active-work.ts#L65-L108) · [Claude 压缩事件](https://github.com/stablyai/orca/blob/70c9eccd39a005466697003e161fe2052f5b65d8/src/main/claude/structured/journal/claude-journal-compactions.ts#L25-L39)

### OpenClaw · 6d678ed3937e8dc803eb74ab428699144cf86f53

- **放置与注入**：工作区 `AGENTS.md`、`SOUL.md`、`IDENTITY.md`、`USER.md`、存在时的 `MEMORY.md` 等经 bootstrap 解析、会话筛选和限额处理，进入系统提示的 Project Context。默认 `always`，也可配置 `continuation-skip` 或 `never`。续接跳过依赖当前活动分支的 full bootstrap 标记，遇到 compact/reset 会失效。 [bootstrap 加载和标记](https://github.com/openclaw/openclaw/blob/6d678ed3937e8dc803eb74ab428699144cf86f53/src/agents/bootstrap-files.ts#L44-L87) · [文件解析](https://github.com/openclaw/openclaw/blob/6d678ed3937e8dc803eb74ab428699144cf86f53/src/agents/bootstrap-files.ts#L254-L329) · [系统提示](https://github.com/openclaw/openclaw/blob/6d678ed3937e8dc803eb74ab428699144cf86f53/src/agents/system-prompt.ts#L426-L475)
- **压缩与校验**：`postCompactionSections` 是另一个、默认未配置的机制。代码在 follow-up 路径按标题读取根 `AGENTS.md` 的指定段并去重追加到已有 `extraSystemPrompt`。原生 Codex 等路径有自己的压缩机制。工具 allow/deny 由运行时代码过滤。相关单测测段落提取与注入，未见对照量化模型复遵循。Loom 可借用“事件使交付版本失效”和“按指定段补回”，同时固定原有效规则源，避免压缩后换了来源。 [压缩刷新](https://github.com/openclaw/openclaw/blob/6d678ed3937e8dc803eb74ab428699144cf86f53/src/auto-reply/reply/post-compaction-context.ts#L43-L80) · [搭送逻辑](https://github.com/openclaw/openclaw/blob/6d678ed3937e8dc803eb74ab428699144cf86f53/src/auto-reply/reply/post-compaction-context.ts#L185-L205) · [工具策略管线](https://github.com/openclaw/openclaw/blob/6d678ed3937e8dc803eb74ab428699144cf86f53/src/agents/tool-policy-pipeline.ts#L128) · [压缩文档](https://docs.openclaw.ai/reference/session-management-compaction/compaction)

### Claude Code · 官方变更日志 2.1.332，公开仓 92f0be47475bc11c6bee9ed02610383044b05bfe

- **放置与注入**：根 `CLAUDE.md` 和无 `paths:` 规则在启动加载到系统提示之后的上下文。嵌套和路径规则按需加载。Skill 常驻描述，激活时展开 `SKILL.md` 正文。Output style 改系统提示层的角色、口吻和格式，启动参数 `--append-system-prompt` 可加独立指令。公开仓 `agents-md` 扩展的 `prompt.context` 和 Read 处理能确认一条按祖先与目录附加文件的路径。核心 `CLAUDE.md` 和 output style 加载只能由官方文档核对。 [变更日志](https://github.com/anthropics/claude-code/blob/92f0be47475bc11c6bee9ed02610383044b05bfe/CHANGELOG.md#L1-L26) · [公开扩展](https://github.com/anthropics/claude-code/blob/92f0be47475bc11c6bee9ed02610383044b05bfe/mods/agents-md/hooks/register.ts#L76-L146) · [记忆](https://code.claude.com/docs/en/memory) · [Skills](https://code.claude.com/docs/en/skills) · [Output styles](https://code.claude.com/docs/en/output-styles)
- **压缩、续接与校验**：系统提示和 output style 仍适用，根 `CLAUDE.md`、无路径规则从磁盘重注入，路径规则再按需加载。被调用过的 skill 正文重注入有每份 5k token、合计 25k token 上限。旧 hook 上下文参与摘要，匹配 `compact` 的 `SessionStart` 可重新给 `additionalContext`。原生 permissions 与 `PreToolUse` 可机械拒绝，`Stop` 可要求继续，不宜在零请求条件下用它触发自动补答。新会话重走加载。CCP 的启用面需单验，本文设计只用无 hooks 路径。公开研究有 Claude Code 文档文件对照，但未隔离出压缩回注或 output style 的遵循效果。 [压缩保留表](https://code.claude.com/docs/en/context-window#what-survives-compaction) · [Hooks](https://code.claude.com/docs/en/hooks) · [对照研究](https://arxiv.org/html/2602.11988v2#S4)

### Codex · 065e18b04021008e2e7d504db8dc50275f589f73

- **放置与注入**：将全局和项目根到当前目录的 `AGENTS.md` 链构建为项目指令，目录内优先 `AGENTS.override.md` 并支持后备文件名。此提交按信任状态和字节预算收集，预算不足会有告警。管理器按工作目录选集、信任和预算等维护快照。启动配置 `developer_instructions` 经初始上下文构建器生成独立的 developer 指令。 [官方 AGENTS.md 指南](https://learn.chatgpt.com/docs/agent-configuration/agents-md) · [加载与预算](https://github.com/openai/codex/blob/065e18b04021008e2e7d504db8dc50275f589f73/codex-rs/core/src/agents_md.rs#L53-L177) · [快照](https://github.com/openai/codex/blob/065e18b04021008e2e7d504db8dc50275f589f73/codex-rs/core/src/agents_md_manager.rs#L69-L158) · [developer 指令构建](https://github.com/openai/codex/blob/065e18b04021008e2e7d504db8dc50275f589f73/codex-rs/core/src/session/mod.rs#L5421-L5460)
- **压缩、续接与校验**：本地压缩路径和远程 v2 安装路径显式重建初始上下文，并把它编进压缩后的历史或前缀。该结论限于所审提交，Loom 所部署 CLI 仍需逐版本核验，且重建可使用已加载快照。规则行为属于指令遵循，沙箱、审批和工具资格属于运行时。仓库有压缩和上下文重建测试。Gloaguen 等的对照包含 Codex，支持规则文件会改变选工具与测试行为，未显示比无文件显著提高解题率。 [压缩重建](https://github.com/openai/codex/blob/065e18b04021008e2e7d504db8dc50275f589f73/codex-rs/core/src/compact.rs#L87-L120) · [远程 v2 安装](https://github.com/openai/codex/blob/065e18b04021008e2e7d504db8dc50275f589f73/codex-rs/core/src/compact_remote_v2_installation.rs#L221-L266) · [对照研究](https://arxiv.org/html/2602.11988v2#S4)

### Cursor · 官方 IDE 3.27 发布记录及 2026-11-28 文档

- **放置与注入**：用户规则、项目 `.cursor/rules/*.mdc`、`AGENTS.md`。项目规则可设每会话应用、文件 glob、描述引导模型选择、手动 @。3.27 明说编辑文件也会触发目录的嵌套规则，并按会话去重。新会话按各类条件加载。公开 hooks 文档提供压缩前事件和调用拦截，但未披露压缩后规则正文如何重建，不能从“每会话出现一次”推出压缩后仍逐字在场。 [规则](https://cursor.com/docs/rules) · [IDE 3.27](https://cursor.com/docs/release-notes#3-27) · [Hooks](https://cursor.com/docs/hooks)
- **校验与数据**：不同规则类型决定附加，拦截依赖显式 hooks 或权限。Cursor 客户端核心源码未公开，Cline 的兼容读法无法验证 Cursor 内部实现。AGIT-Instruct 论文包含 Cursor 规则文件样本并度量结构覆盖和内容对齐，未测活会话遵循或压缩保留。 [结构研究](https://arxiv.org/abs/2611.02383)

### Cline · VS Code v4.1.28，cbc7d1419a74464c622117a740fdfe87a5e0a7b2

- **放置与注入**：SDK 的路径解析接受项目 `.cline/rules` 与旧 `.clinerules` 布局，合并全局和工作区规则，也加载 `AGENTS.md`。watcher-backed 插件把加载器注册成系统提示的 rule provider。VS Code 侧保留 Cursor、Windsurf 规则读法和条件规则组合。换会话从配置重新注册和加载。 [路径解析](https://github.com/cline/cline/blob/cbc7d1419a74464c622117a740fdfe87a5e0a7b2/sdk/packages/shared/src/storage/paths.ts#L528-L589) · [注入插件](https://github.com/cline/cline/blob/cbc7d1419a74464c622117a740fdfe87a5e0a7b2/sdk/packages/core/src/extensions/config/user-instruction-plugin.ts#L248-L261) · [条件规则](https://github.com/cline/cline/blob/cbc7d1419a74464c622117a740fdfe87a5e0a7b2/apps/vscode/src/core/context/instructions/user-instructions/rule-helpers.ts#L199-L257)
- **压缩与校验**：SDK 压缩态可保存并返回 `systemPrompt`，而文件规则另有 watcher 通道。未验证每个客户端任意压缩场景下动态规则精确何时重算。VS Code 有独立 `.clineignore` 路径检查。单测验证规则选择和稳定顺序，未见对照测量模型按所选规则行事。 [压缩态](https://github.com/cline/cline/blob/cbc7d1419a74464c622117a740fdfe87a5e0a7b2/sdk/packages/core/src/extensions/context/compaction.ts#L818-L842) · [路径检查](https://github.com/cline/cline/blob/cbc7d1419a74464c622117a740fdfe87a5e0a7b2/apps/vscode/src/core/ignore/ClineIgnoreController.ts#L147-L187) · [选择测试](https://github.com/cline/cline/blob/cbc7d1419a74464c622117a740fdfe87a5e0a7b2/apps/vscode/src/core/context/instructions/user-instructions/__tests__/rule-loading.test.ts)

### Roo Code · b867ec9145750d0ae1ff7f02d35406e9bf2a0b16

- **放置、注入与保留**：全局、项目、可选子目录的 `.roo/rules/`，以及 `.roo/rules-<mode>/`，兼容旧规则文件，并加载 `AGENTS.md` 等。任务用当前 mode 和 cwd 重构系统提示，包含普通请求与主动压缩路径。任务压缩历史后依然有独立的提示构造路径。 [规则加载](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/core/prompts/sections/custom-instructions.ts#L382-L453) · [压缩](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/core/task/Task.ts#L1603-L1668) · [普通请求](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/core/task/Task.ts#L3898-L3913)
- **校验与数据**：mode 工具组在筛选及调用校验两侧生效，编辑组还可校验路径正则。自定义指令不隐式变成权限。相关测试覆盖工具拒绝和路径，未见规则遵循的在线对照。 [工具校验](https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/src/core/tools/validateToolUse.ts#L120-L228)

### OpenHands · 0.62.0 / 7fbb48c40679afd674970966b96185657d92a487；SDK cf8158bc25f5552c50ad131a5f0ce2dbc297789b

- **放置与注入**：旧版从仓库 `.openhands/microagents/`、用户同名目录和内置库加载。无触发条件的 repo microagent 进入 workspace context，knowledge microagent 按关键词匹配用户内容，作为召回 observation 提供。当前主仓拆出了 agent SDK，常驻 repo skill、关键词或路径触发，以及按需取正文的 AgentSkills 分开。第三方规则如 `AGENTS.md` 也可映射作 repo skill。 [旧加载器](https://github.com/All-Hands-AI/OpenHands/blob/7fbb48c40679afd674970966b96185657d92a487/openhands/runtime/base.py#L861-L920) · [旧召回](https://github.com/All-Hands-AI/OpenHands/blob/7fbb48c40679afd674970966b96185657d92a487/openhands/memory/memory.py#L139-L184) · [SDK Skill](https://github.com/OpenHands/software-agent-sdk/blob/cf8158bc25f5552c50ad131a5f0ce2dbc297789b/openhands-sdk/openhands/sdk/skills/skill.py#L186-L235)
- **压缩、续接与校验**：旧 CodeAct 先过历史 condenser，再构建消息。SDK 的 LLM condenser 保留配置指定的头尾事件，另用模型压缩中间事件，系统消息由 agent 单独构造。新会话按 workspace 发现，已触发正文的历史保留取决于事件位置和 condenser。关键词、路径和工作区匹配是代码，正文遵循是模型行为。加载和触发有测试，未见隔离 microagent 的遵循率。其独立摘要调用不适合成为 Loom 的新增动作。 [旧 CodeAct 路径](https://github.com/All-Hands-AI/OpenHands/blob/7fbb48c40679afd674970966b96185657d92a487/openhands/agenthub/codeact_agent/codeact_agent.py#L195-L212) · [SDK condenser](https://github.com/OpenHands/software-agent-sdk/blob/cf8158bc25f5552c50ad131a5f0ce2dbc297789b/openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py#L54-L81) · [SDK 系统消息](https://github.com/OpenHands/software-agent-sdk/blob/cf8158bc25f5552c50ad131a5f0ce2dbc297789b/openhands-sdk/openhands/sdk/agent/agent.py#L690-L726)

### Aider · 5dc9490bb35f9729ef2c95d00a19ccd30c26339c

- **放置与注入**：`CONVENTIONS.md` 是约定名称，须由 `--read`、`/read` 或设置文件显式加入。每次组装请求时重新读取，放进只读文件消息段。历史摘要更新 `done_messages`，只读段在另一条路径生成。新进程若要保持同文件，复用参数或配置即可。 [约定文档](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/website/docs/usage/conventions.md#L20-L49) · [只读消息组装](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L759-L784) · [历史与只读段](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L1265-L1288)
- **校验与数据**：文件写入由补丁应用路径检查，未加入可编辑集合的文件通常要确认才能提权。CONVENTIONS 中的流程和风格靠提示。未见同任务开关约定文件的遵循对照。 [可编辑检查](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L2191-L2240)

### Goose · c546eaa1cd02696e4cd628e203df51429e158175

- **放置与注入**：YAML/JSON recipe 有独立 `instructions`、`prompt`、参数、可用扩展和可选 JSON schema。运行时渲染 recipe，保存到 session。每次组装时，`instructions` 由 session 中的 recipe 贡献到系统提示，历史压缩可以替换 conversation 而仍保有该会话字段。已有会话可沿用 recipe，新会话须选 recipe 或显式继承。 [Recipe schema](https://github.com/block/goose/blob/c546eaa1cd02696e4cd628e203df51429e158175/crates/goose/src/recipe/mod.rs#L44-L122) · [提示片段](https://github.com/block/goose/blob/c546eaa1cd02696e4cd628e203df51429e158175/crates/goose/src/agents/state_machine/ops_recipe.rs#L155-L170) · [会话持久化](https://github.com/block/goose/blob/c546eaa1cd02696e4cd628e203df51429e158175/crates/goose/src/agents/state_machine/session.rs#L125-L130)
- **校验与数据**：recipe 响应 schema 在启动时构建并校验 `FinalOutputTool`，可用扩展有独立加载检查。输出结构可以机械定义，完成了业务步骤仍需证据。源码测试覆盖解析和调度，未见启用 recipe 的遵循率对照。 [加载与校验](https://github.com/block/goose/blob/c546eaa1cd02696e4cd628e203df51429e158175/crates/goose/src/agents/state_machine/ops_recipe.rs#L59-L103)

### Letta / MemGPT · Letta 源码 tag 0.16.8 / 1131535716e8a31c9a437f8695e25ac98f203a24

- **放置与注入**：以可持久关联到 agent 的 memory block 存 `persona`、`human` 和自定义内容。prompt generator 将块编进 system prompt。修改定义或值时，block manager 更新关联 agent 的系统提示。历史压缩与 core block 生命周期独立。同一 agent 跨会话可复用它的块，新 agent 则须显式配置或关联。当前默认分支 `8816d3a8516893bfdc0fa14bfb1235226012e295` 未提供同一 Python 服务实现，故固定到有源码的标签。 [Persona 模式](https://github.com/letta-ai/letta/blob/1131535716e8a31c9a437f8695e25ac98f203a24/letta/schemas/memory.py#L838-L857) · [Prompt generator](https://github.com/letta-ai/letta/blob/1131535716e8a31c9a437f8695e25ac98f203a24/letta/prompts/prompt_generator.py#L123-L172) · [块更新](https://github.com/letta-ai/letta/blob/1131535716e8a31c9a437f8695e25ac98f203a24/letta/services/block_manager.py#L211-L273)
- **校验与数据**：`memory_replace` 执行器拒绝修改只读块。规则是否应用靠模型。原始 MemGPT 论文测了长对话记忆召回、一致性和文档问答，支持持久记忆机制的用途，未对只读 persona 施加 Loom 式工具权限和回复格式测试。 [只读检查](https://github.com/letta-ai/letta/blob/1131535716e8a31c9a437f8695e25ac98f203a24/letta/services/tool_executor/core_tool_executor.py#L328-L359) · [MemGPT 论文 §3](https://arxiv.org/html/2310.08560v2#S3)

### claude-mem · ad682a38da4cdbd2076451f595adc7db512a626c

- **放置与注入**：插件收集工具观察和会话摘要，工作进程处理后持久化。Claude 的 `SessionStart` 匹配 startup/resume/clear/compact。它按项目拉取记忆上下文并以 `additionalContext` 附回宿主，`PostToolUse`、`Stop` 负责另一侧采集。工作进程可为观察或摘要调用模型，不能直接移植这个生成环节。 [插件 hook 配置](https://github.com/thedotmack/claude-mem/blob/ad682a38da4cdbd2076451f595adc7db512a626c/plugin/hooks/hooks.json#L20-L150) · [注入处理](https://github.com/thedotmack/claude-mem/blob/ad682a38da4cdbd2076451f595adc7db512a626c/src/cli/handlers/context.ts#L733-L837) · [工作进程](https://github.com/thedotmack/claude-mem/blob/ad682a38da4cdbd2076451f595adc7db512a626c/src/services/worker/session/GeneratorRunner.ts#L150-L208)
- **校验与数据**：项目作用域、返回格式与注入通道在代码里。记忆内容属于提示供给。已查材料没有可复现的角色遵循对照。对 Loom 的借鉴是从持久状态生成有限上下文，其触发可改用 loomd 已有投递，适配无 hooks 的 CCP。

对照数据的外推有限。Gloaguen 等在 SWE-bench / CTXbench 比较无指令文件、自动生成和开发者写的文件。正文 §4 的行为分析检测到工具选择随文件改变，但同无文件比较的解题率差异未达显著，成本有所增加。另一项 Claude Code / Codex 消融覆盖 17 个任务和 288 个运行，也未发现真实项目指令在该测试组扭转近失案例。长期角色红线、格式与上报需要各自的分母与验收结果。 [Gloaguen 等 v2](https://arxiv.org/html/2602.11988v2#S4) · [双代理消融](https://arxiv.org/abs/2607.27250)

## C · 设计选项

当前 Loom 已按角色渲染核心，挂在新会话启动投递，TUI 交接时还可能只投简报路径。运行中已有事件模块和压缩后随正常投递搭送事实卡的路径。以下方案沿用这些入口，分别改变规则何时算交付、哪些结果具备约束力、何时允许接管。 [角色与交接启动](../../daemon/sessions.mjs#L630) · [现有压缩搭送](../../daemon/supervisor.mjs#L1498) · [CCP 与 Codex 启动参数](../../memory/launch-config.mjs#L14)

### 失败与机制对应

| A 中失败 | B 中机制 | 可由 Loom 机械处理 | 仍需提示指导 |
| --- | --- | --- | --- |
| 角色越权 | Roo mode 工具组、OpenClaw 工具策略 | 按可信会话角色和卡权限裁决经拦截入口的命令。证据读取走现有证据卡、只读窄接口，例外一次性、限定范围。测试、构建、合入分开记尝试、获准和执行。 | 告诉 Leader 应派哪类 Worker，告诉 Auditor 何时值得进一步核证。 |
| 格式违规 | Goose schema、Claude output style | 仅在可靠终止事件后解析当前角色的回执语法。违规留原件和机器原因，阻止状态结案及 gate 流转。 | 给当前角色一条最短合法示例。下次正常投递时附上未完成事项。 |
| 忘记裁决 | Letta 只读块、Orca 替换声明、Aider 独立组装 | 账本解析出适用编号、作用域、取代关系和版本。遇空/解析错误进入可见状态，禁止依赖缺失裁决的敏感动作。可按当前编号验证结构化授权。 | 给出当前动作需要的裁决原文短摘，交接历史作为参考数据。 |
| 原地待命 | Orca active-work、按场景展开的规则 | 关联待处理事项、投递成功、出入队、活动及有效等待理由。按同一事项去重。只有已确认、可执行且无进展才计候选。 | 有可做事项就执行第一步，等资源时登记原因和负责方。 |
| 该报不报 | Goose 结构化结果、claude-mem 生命周期记录 | 将 gate 裁决、明确阻塞、回执异常等已具结构的义务绑定记录 ID。状态、收件箱与人类可见通知共用记录，分别保存出现、送达和签收。 | 语义性风险仍要求角色判断。告知何时升级、向谁报以及附什么证据。 |
| 交接后身份漂移 | Orca 每 provider 播种及回执、Letta 独立 persona | 绑定新 incarnation、接收正文哈希、核对首个业务回合中的机器事实，再允许依赖该身份的动作。未送简报、缺首报和事实冲突分开。 | 开头给角色、最新裁决和一项已有待办。成功后沿该回合完成首动作。 |
| 压缩后丢规则 | OpenClaw 段落刷新、Codex 初始上下文重建 | 有可信事件时使已交付版本过期，下一次正常正文搭送短核心。无事件时记证据未知，关键动作仍核外部规则版本。 | 声明替换范围和当期规则，按触发事件附一个短场景模块。 |

### 三套可独立讨论的边界

| 方案 | loomd 强制部分 | 提示部分 | 请求数、取舍 |
| --- | --- | --- | --- |
| **Ⅰ · 版本回执与事件补发** | 持久化角色核心版本、按作用域解析的裁决版本、接收正文回执。新会话、版本变化、原生压缩可证实时将该 session 的交付状态标旧。保留既有工具、授权和合入门禁，记录格式及业务义务未匹配。 | 核心置首，动态提醒限短且按事件去重。未改规则复用既有上下文，下一次正常投递补发已标旧的规则。 | **每条消息 +0**。改动最小，可先量出规则供给缺口。弱点是软指标只能观察，收到回执也只能证明正文到达。失去压缩信号时只能等可用触发。 |
| **Ⅱ · 增加角色操作与输出校验** | 包含Ⅰ的状态，进一步对可观测命令做角色、卡和作用域检查。对可靠终止回执执行角色对应语法，Gate 校验当前候选 SHA、有效裁决和证据。高风险状态转换拒绝时保存原回复，待下个既定业务回合或人类处置。 | 固定格式之外的判断仍靠模型，例如何时发风险报告、如何拆卡。就地工具拒绝保留短的改派方向。 | **每条消息 +0**。不发自动纠正消息，不用 Stop 重跑。拦截只适用于经过可信入口的动作。若 provider 自己在已开始的工具循环里重试，仍计量其请求数。覆盖面和误拒率都要验证，P2 的正常流水线误判是夹具。 |
| **Ⅲ · 增加换班和恢复屏障** | 可叠加Ⅱ。保留 v2 的别名、单实例锁与收件箱屏障。简报被验证收到后，仅将首项既定工作按 incarnation 投给待接班会话，其他在途投递留在收件箱。用首个业务回合的同一份事实卡核对角色、版本、待办和首动作。通过才切别名并解冻敏感动作。未通过则保留当前负责人，或恢复期进入人工处置。 | 角色短核心、下一步及少量机器可核字段，明确替换块和状态数据的作用域。 | **每条消息 +0**。核对随本来就要发出的首个真实工作项，取消单独机器题和自动重问。缺首项时继续冻结，状态和条件允许时再接管。它为交接前故障提供明确回退。状态机、并发投递和回滚的验证成本最高。 |

共同计数口径：一次本来会发出的业务投递只形成一次既有入口调用。规则回注、判定、更新账本、冻结、队列记录、面板与人类通知都是本地操作。接入已有的换班或恢复首投，不额外创建语言模型回合、摘要、评审器、探测请求或保活。自动告警若会唤醒另一模型，应合并到该模型原定下一次投递，或只走人类可见的状态通道。禁止自动纠错循环。CLI 原生压缩和工具往返作为原有成本单独统计。受相同输入驱动的真实请求数和 token 消耗都应度量，单次启动参数增加 token 也记账。任何会自动触发新增原生回合的处理都不启用。对可用工具的限制优先在工具暴露或授权阶段完成，以免把拒绝变成来回试错。

实现约束可以用同一组状态字段比较三案。由 loomd 按角色核心内容及格式版本生成 `ruleVersion`，按生效裁决正文、范围和取代关系生成 `rulingsVersion`。loomd 为每次投递的规则区块和数据区块标记作用域，可用原生投递正文验证哈希。只有当前 incarnation 的完整正文回执能推进已送版本。重启重复回执幂等，旧会话迟到回执无效。压缩未知时保留未知状态。语法按角色定义，Worker 三行的结果语法与 Auditor 门禁、Leader 首行分别处理。

### 三家 CLI 与 CCP 兼容性

| CLI | 规则放置和续接 | 无额外请求的校验和降级 |
| --- | --- | --- |
| **agy** | 以 Loom 受控首投和事件搭送为可移植基线。按 v2 对无法可靠原生续接的角色用新会话交接，始终重给短核心。现有证据尚未验证 agy 的原生系统层规则与压缩回注。 | 优先确认原生收到正确正文，允许经实测的封装和历史换行差异。不能将启动就绪、空输入框、投递和回执混判。状态未知时等待既有事件，不空投测试。五条历史误报已有封装及续写回放。 [DLV-AGY-1](../../tasks/DLV-AGY-1/RESULT.md#L3) |
| **Codex** | 可在已确认的部署版本用 `developer_instructions` 放短核心，用现有投递放动态裁决。项目 `AGENTS.md` 继续承载仓库约定。续接仍按同一 cwd 和版本条件校验，不能用上游 HEAD 代替部署行为。 | 用当前 transport 的 thread/turn 边界和可用结构化压缩事件。能经工具拦截器前置拒绝的动作按Ⅱ执行。普通输出用终止回执校验，不加 app-server 探测轮。 |
| **Claude 经 CCP** | 只用授权 CCP 入口。沿用无 hooks 设置。确认启动路径支持时可在已有 `--append-system-prompt` 放短核心，核心总有受控投递兜底。恢复保留 v2 先验证再启用原生 resume 的要求。 | 从既有原生尾记录或 holder 获取确定边界，压缩信号缺失时依赖固定启动层和下一次有效投递。拒绝由 Loom 权限、支持的启动限制或经管工具入口执行。看不见任意原生工具调用时，只能坚守外部动作门禁并记未覆盖，不能声称完成命令前置拦截。 [CCP 启动配置](../../memory/launch-config.mjs#L19) · [DLV-CCP-1](../../tasks/DLV-CCP-1/RESULT.md#L5) |

### 如何验证取舍

先用固定历史样本与本地夹具验证同一套计数：AGY 交接首投被截断或疑似草稿、正常命令链误拒、CCP 终止证据缺失、过期裁决、重复或迟到回执、压缩后首轮。已有常规业务回合按 CLI、角色、release 分层观察，下表各指标保留结构化分母。未覆盖的原生工具调用和压缩不可见样本单报覆盖率。

| 指标 | 分母与验证 |
| --- | --- |
| 越权和误拒 | 有经管证据的工具尝试。单看被拒、获准、实际执行和误拒，抽样复核分类与授权。 |
| 格式与漏报 | 有完整终止回执的适用回复，以及独立登记的应报事项。分别测首条格式、逾期未报告和已报告未送达。 |
| 裁决与待命 | 涉及可核对当前裁决的动作机会，以及已证实投递的可执行事项。记录收件到首个有证据的推进和有效等待理由。 |
| 交接与压缩 | 已尝试交接、已完成正文验证、具备首个正常回合、已知发生压缩各是独立条件。记录每阶段通过率及已知事件后首个完整回合的具体失配。 |
| 请求与成本 | 每个既定业务投递的增量请求须为 0。另对比原生工具循环请求数、输入 token 和拒绝造成的时间成本。 |

### 讨论题

1. 身份遵循的首个验收目标是规则成功交付、受保护操作无违规执行，还是业务事项按时完成？哪一项应成为首版门槛？
2. 哪些 Leader/Auditor 工具具备可靠的前置拦截，哪些只验证下游效果？哪些窄取证应有一等入口，哪些保留例外授权？
3. 缺原生终止信号时，哪些动作维持冻结，哪些只记为未确认？不同 CLI 是否接受同一门槛？
4. v2 的换班验证是否合并到首个真实工作项？新旧会话交替时，什么证据允许释放旧 alias 和解冻 gate？
5. 哪些裁决属于必须随角色版本重发的短核心？其余裁决用哪些触发条件搭送，如何处理无可信压缩事件的长会话？
