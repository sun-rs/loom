# PROTO-0：loom_new 顶层 Agent 协议 v0

## 你是谁、在做什么
你是 loom_new 项目的协议作者 worker。loom_new 是一个全新项目：一个常驻 hub 为多个项目调度 agent CLI 角色（super / leader / auditor / worker）。角色可以跑在不同机器或容器里，跑的 CLI 可以是 Claude、Codex、agy、OpenCode，也可以是长尾 CLI。你的任务是写出 loom_new 的**顶层协议 v0**。这份协议是 hub ↔ cell ↔ 各 CLI 适配器之间的契约，以后每个适配器都要实现它、通过它的一致性测试。

## 核心原则（必须遵守）
**协议的能力范围以"别人已经做到的"为准。** 别人项目里没有的能力，CLI 大概率也提供不了。因此：
1. 协议里的每个命令、状态、事件字段，都必须在**至少一个**参考项目的源码里找到对应实现，或者在 CLI 自身可验证的接口里找到（schema 导出、`--help`、官方 hooks 文档），并引用 `文件:行号`。
2. 找不到出处的能力，不得写进协议正文，统一放进 `SOURCES.md` 的"未纳入 / 未知"附录，并说明为什么需要它、验证方法是什么。
3. 如果某个能力只有部分 CLI 支持，就通过**能力声明**表达（不支持 = 类型上缺失 + typed refusal）。不要为了统一而假装所有 CLI 都支持。

## 参考来源（只读）
- 固定版本源码：`/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/`
  - `oar`（重点：`packages/oar/src/contracts/`，Session 契约、observe projection、typed refusals、SessionKernel seq/cursor；`runtimes/*`，15 个 runtime 的真实能力；`docs/design/decisions.md`；`docs/runtimes/*.md`）
  - `t3code`（orchestration 事件、`delegate_task` 半中继、receipts、restart continuation、provider adapters）
  - `orca`（`src/main/agent-hooks/README.md`：hooks 与 OSC 的优先级；`src/main/claude/hooks/claude-managed-hook-events.ts`：Claude 8 个 hook 事件；`src/main/claude/transcripts/`；codex shared server pool；OSC 7501 矩阵）
  - `raft-source`、`paseo`、`happy`、`multica`、`lody`、`herdr-core`（`README.md`：OSC 7501 状态协议）、`herdr`
- 已有研究报告（先读，避免重复）：同目录 `../../../REPORT-R2.md`（即 `arch-research-2026-11-23/REPORT-R2.md`），以及 `AR-*/*/RESULT.md`，特别是 AR-2b（Codex app-server）、AR-3、AR-4、AR-5。
- 旧项目 loom-next 的经验（只读）：`/Users/sun/Code/repos/loom-next/docs/HC_MODEL.md`（send/started/working/turn 都不能证明送达；codex 首个 turn 前 status 为 null；agy 有后台任务时一直处于 working；blocked kind 可能缺失）、`docs/DESIGN.md`。
- 允许的不调用模型的本地探针：`codex app-server generate-json-schema --out <loom_new 内的 scratch 目录>`、`codex --help`、`claude --help`、`agy --help`、`opencode --help`，以及类似的只读帮助或 schema 命令。

## 已定的架构立场（协议要服务于它们）
- **没有审批**：自动化角色（尤其是 worker）不走 approve，也不弹选择器。安全靠容器隔离。角色有问题时，用普通文本写在最终回复里，由上级处理。`needs_human` 只用于认证失效和真实错误。
- **daemon 中继**：角色 session 不知道自己运行在哪里，也不调用任何通讯命令。它只需要被派活、输出、结束。cell 检测到结束后，由 hub 搬运。默认只投递**最终回复**。
- **证据层**（来自 auditor 的实际需求，必须纳入）：审查方需要的是证据，不是思路。cell 从原生 transcript 或协议事件中**机械提取**事实：实际执行的命令和退出码、改动的文件、测试输出尾部、报错、沙箱拒绝、工具调用次数、耗时、压缩次数。推送时附在最终回复后面，形式是一行证据摘要加引用；完整切片按需拉取（命令列表、某次工具调用的完整输出、最后 N 轮）。只报事实，不下结论。
- **事实来源优先级**：结构化事件（Claude 的 hooks 和 transcript JSONL；Codex app-server 的通知；ACP 的 updates）高于 OSC 7501，OSC 7501 高于屏幕文本。不得靠空闲超时来推断 turn 已结束。
- **进程存活**：CLI 进程不能是 cell 主进程的子进程。TUI 类 CLI 交给 PTY holder（hc）；Codex 用 app-server daemon，cell 作为客户端重连。协议必须定义断线、重连后如何按游标补齐事件。
- **人工接管**：`human_lease`。人在终端里输入时暂停投递。
- 适配器分组（只为确定协议覆盖面，不要写实现）：Claude/agy 走 TUI + hooks；Codex 走 app-server daemon；OpenCode 以后走 serve；长尾 CLI（kimi/pi/grok/dsh/qwen…）以后通过 OAR 挂在协议后面。所以协议字段要与 OAR 的 observe projection **尽量同名同义**，降低以后接入的转换成本。

## 交付物（全部写在 `/Users/sun/Code/repos/loom_new/` 下）
1. `docs/PROTOCOL.md`：协议正文 v0
   - 范围和非目标：只管派活、状态、最终回复和证据；业务判断不在协议内
   - 实体：Cell、Role Session、Task、Delivery（id、生命周期）
   - 命令：至少包含 deliver / steer / abort / status / evidence。逐条写输入、输出、幂等语义和 typed refusal 列表
   - 状态机：idle / working / needs_human / error / exited。如果有证据支持，可以增删状态并说明理由；每个转换都要写明触发信号
   - 事件 schema：append-only，带 seq 和 cursor，覆盖证据层
   - 投递语义：投递 id、ack、去重、至少一次还是恰好一次（选哪个、为什么）、cell 重启或断线后如何补齐
   - 能力声明：每个适配器声明自己支持哪些能力
   - human_lease
   - 版本和兼容规则
2. `docs/SOURCES.md`：字段来源映射表
   - 行：协议里的每个命令、状态转换和事件字段
   - 列：Claude（TUI+hooks+transcript）/ Codex（app-server）/ agy / OpenCode / ACP 类（kimi/grok…）/ OAR 对应概念
   - 每格写来源（`文件:行号` 或探针命令），并标注 【已验证】、【源码推断】 或 【未知】
   - 附录 A："未纳入 / 未知"能力清单，以及每一项的验证方法
   - 附录 B：参考项目之间的分歧和你的取舍（例如 OAR、T3、Orca 对同一能力的不同处理）
3. `schema/`：协议类型的 TypeScript 定义，纯类型，没有实现，与 PROTOCOL.md 一一对应
4. `tasks/PROTO-0/RESULT.md`：完成摘要、关键决策、未决问题、需要付费探针才能回答的问题；最后一行写 `STATUS: done`

## 红线
- 不读、不打印、不复制任何凭据：`~/.codex/auth.json`、`~/.codex/memories*`、Claude 的凭据或 keychain 条目、agy 的 token、`~/.loom-next/provider-homes`、任何 `.env`。
- 不读用户真实的会话 transcript（`~/.claude/projects`、`~/.codex/sessions` 等）。transcript 格式请从参考项目的 fixtures 和解析代码推断。
- 只能在 `/Users/sun/Code/repos/loom_new/` 内写文件。不修改 loom-next、rah_os、参考仓库或任何其他目录。
- 不调用付费模型，不安装软件，不使用 `hc send`、`hc keys`、`hc kill`，不运行 `loom` 写命令，不 git push。
- 不碰 Solars 和 CCP（`/Users/sun/Code/ccp`）。
- 可以在 loom_new 内执行 `git add`/`git commit`，提交信息以 `PROTO-0:` 开头。
- 不复制会伪造身份的做法：不设置或伪造 `CLAUDE_CODE_ENTRYPOINT`，不伪造 ACP 的 clientInfo，不读写 OAuth token。

## 风格
中文写作，标识符和字段名用英文。宁可少而准，不要多而虚。协议正文里每一句"必须"，都要能在 SOURCES.md 里找到依据。
