# 记忆系统调研（2026-11-25）

> 调研日期 2026-11-25。各产品更新很快，引用的版本、默认值和链接可能已经过时，复用前请按"版本"列重新核对。
> 设计结论见 [MEMORY.md](../MEMORY.md)，测试计划见 [MEMORY-TESTS.md](../MEMORY-TESTS.md)。

## 1. 单机记忆：谁写、怎么注入

| 系统（版本） | 谁写 | 注入 | 范围 | 遗忘 / 去重 | 来源 |
|---|---|---|---|---|---|
| Claude Code（2.1.331） | 正在工作的 agent 按系统提示自行判断 | 会话开始注入 `MEMORY.md` 索引（前 200 行或 25KB），正文按需读 | 按 git 仓库根，worktree 共用，只在本机 | agent 自己删；写后检查体积 | https://code.claude.com/docs/en/memory ；本会话亲见的系统提示 |
| Codex CLI（0.171.0，tag `rust-v0.171.0`） | 后台两阶段流水线：Phase 1 用 luna（低推理）逐个 rollout 提炼，Phase 2 用 terra 子 agent 全局合并；主 agent 只在用户要求时追加笔记 | 初始上下文注入 `memory_summary.md`（≤2500 token，developer 角色）；正文由模型用 shell 搜索 | `$CODEX_HOME/memories` 全局一份，靠 `applies_to` 文本区分项目 | 30 天未用剪掉；去重靠合并 prompt；引用标记计数 | `codex-rs/memories/`、`ext/memories/`；issues #19732（后台耗额度）、#30299（MEMORY.md 膨胀到 600KB） |
| claude-mem 插件 | hook 自动捕获工具调用，haiku 压缩成 observation | SessionStart 注入约 50 条；MCP `search→timeline→get_observations` 逐层展开 | `basename(cwd)`，所有项目共用一个库 | 未核实 | https://docs.claude-mem.ai |
| OpenClaw | agent 自己写 | 启动注入 MEMORY.md；`/new` 时加载当天和前一天的 daily note；压缩前静默 flush | 每 agent 一个 workspace | 只追加 | https://docs.openclaw.ai/concepts/memory |
| Hermes agent | agent 用 `memory` 工具写，有硬上限；每 N 轮后台 reviewer | 会话开始注入冻结快照（MEMORY.md 2200 字符、USER.md 1375 字符），中途写入不改快照（保护前缀缓存） | 每 profile | 超限报错逼合并；拒绝完全重复 | https://hermes-agent.nousresearch.com/docs/user-guide/features/memory |
| Orca bot | agent 自己写，一行一事实，标注来源 | 新对话注入 `MEMORY.md` 前 200 行，标明"notes to consult, not instructions" | 每 bot 一个目录，跟 bot 跨项目 | `forget` 守护；夜间整理有删除上限；改动有历史 | Orca.app `out/shared/bots/` |
| raft（`origin/raft`） | agent 自己写；cleaner 只测量体积，超限唤醒 agent 整理 | Activation 注入路径和 standing prompt；频道索引 3KiB，唤醒推增量，>30 条警告过时 | Agent 身份私有；频道记忆由凭据推出范围 | Human 删除，留 tombstone | `docs/architecture/memory-and-context.zh-CN.md`、`packages/agent-host/src/channel-memory-index.ts` |

结论：
- 没有任何系统靠模型自己记得去调用工具来读记忆。唯一可靠的保证，是启动时由运行时强制注入一份小索引。
- 只有 raft 做过因果对照实测：有文件、移走文件、恢复文件、换 CLI 四种情况下各问一次。见 `docs/audits/2026-08-30-real-memory-acceptance-and-product-audit.zh-CN.md`。
- 后台模型提炼（Codex、claude-mem、mem0）的共同问题是额外消耗额度，且质量不可控。

## 2. 跨机记忆

| 系统 | 拓扑 | 写入冲突 | 跨机身份 |
|---|---|---|---|
| raft 频道记忆 | 中心 Kernel 权威 | `expectedRevision`，不一致即拒绝 | 频道 ID，由凭据推出 |
| raft 私有记忆 | 固定在一台 Computer | 单写者，跨 Host 拒绝；"single-writer handoff 未实现前不得自动复制或双向同步" | 未完成 |
| Orca 配对服务器 | 每台机器各存一份，配对只传消息和事实 | 不跨机 | 无 |
| multica | 中心 Postgres 存 instructions/context，没有记忆表 | 不回写；Codex 原生记忆默认关闭，理由是会跨任务泄漏 | repo URL |
| GitHub Copilot Memory | 中心 | 写入需要 push 权限；使用前按当前分支校验引用 | 仓库；fork 不继承 |
| Letta | 中心 | 后写覆盖（反例） | ID |
| mem0 v3 | 中心 | 只 ADD | user/agent ID |
| Graphiti | 中心图，双时间（有效期 / 记录期） | 作废旧边，不删除 | group_id |

结论：没有先例靠多主写入加合并来做跨机记忆。真正跨机的系统只有两种做法：一是中心权威加乐观锁，二是干脆不跨机。loom 选择 home loomd 作为唯一权威，cell 只缓存只读副本、写入经 home 转发。见 MEMORY.md §6。

## 3. 各 CLI 原生记忆的关闭方式

| CLI（版本） | 原生记忆 | 关闭方式 | 依据 |
|---|---|---|---|
| Claude Code（2.1.331） | auto memory | 环境变量 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`，进程级生效 | 官方文档；raft 已实测；OpenCode 的 claude-agent provider 也设置这个变量 |
| Codex（0.171.0） | 后台流水线 + 注入 | `features.memories=false`、`memories.generate_memories=false`、`memories.use_memories=false` | 官方配置参考；raft 实测 `config/read` 返回三项均为 false |
| agy（1.5.17，2026-11-25 复核） | 二进制仍包含 Knowledge Items 和 Persistent Context 提示 | 官方 CLI 参考和本机 `agy --help` 均未列出记忆开关。二进制内置 `cascade-knowledge-config` 为 `enabled:false`，`cascade-conversation-history-config` 为 `enabled:true, max_conversations:20` | 本机 `agy --version`、`--help`、二进制 `strings`；[官方 CLI 参考](https://antigravity.google/docs/cli/reference/) |
| OpenCode（2.3.0） | **没有**长期记忆。启动只注入 AGENTS.md 和 instructions，另读 `~/.claude` 的 skills | `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`，不读 Claude 侧的 skills | 源码 `packages/core/src/config/plugin/instruction.ts`、`packages/cli/src/server-process.ts` |

直接问两个 CLI 自己的回答：agy 称系统指令里没有 KI 相关内容；OpenCode 只提到 `import-memory` 这个 skill。模型自述不可靠，以源码和二进制为准。

agy 1.5.17 复核仅查看命令帮助和二进制内置值。登录后下发的配置、项目间复用以及知识条目的实际写入行为仍待验证。

## 4. 对 loom 的取舍

- **借用 Claude Code 的做法**：
  - agent 自己写；
  - 有"不该存什么"清单；
  - 只注入短索引，规则和索引放在稳定前缀里，以便命中缓存。
- **借用 Codex 的做法**：
  - 写入判断沿用 "No-op is preferred"，以及"未来的 agent 会因此做得更好吗"；
  - 记录引用计数；
  - 写入前脱敏。
- **借用 raft、Copilot 的做法**：
  - 中心权威加 expectedRevision；
  - 作用域由凭据推出；
  - 用前校验所引用的内容。
- **不采用**：后台模型提炼、全局混存、多主合并。

## 补充：Claude Code 记忆由谁生成（2026-11-26，Claude Code 2.1.331 本机二进制字符串，未运行实验）
- **主路径：工作会话自己写。** 系统提示告诉在岗 agent 记忆目录和格式，agent 判断值得记时直接用 Write 写文件并更新 `MEMORY.md` 索引。
- **补漏：回合后抽取（`extractMemories`，`CLAUDE_CODE_POST_TURN_MEMORY`）。** 回合结束后先做一次"first look"小判断（只答 `{"write_likely": true|false}`），否才跳过；本回合主会话已直接写过记忆则跳过（`skipped_direct_write`）；用的是刚结束回合的上下文（`stashed context`），不是去读历史库。
- **整理：`autoDream`（"Dream: Memory Consolidation"，`autoDreamEnabled`）。** 后台定期运行，取上次整理以来动过的会话（`listSessionsTouchedSince`、`readLastConsolidatedAt`，带锁），对照会话记录合并、去重、修正过时条目；规则含"不在 dream 中改 CLAUDE.md，与之矛盾时标注待核"。
- **对 loom：** 生成以在岗角色当场写为主（loom：结论标签 `REMEMBER:` / Super 记账 / loomd 结构化事件）；回合后抽取暂不做（每回合多一次请求，与"少请求"冲突，必要时只对高级角色、先用规则预筛）；读 hist 只用于阶段边界的整理（对应 dream），产出合并/作废/更正，不作为主要生成来源。
