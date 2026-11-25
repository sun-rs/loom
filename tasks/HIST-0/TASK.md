# HIST-0：会话索引 + loom hist（看见层）
目标：`index/` 与 `bin/loom` 的 `hist`、`state`、`ls` 子命令。
- 会话索引：JSONL 或 SQLite（单写者），字段：role、project、task、wave、addr、backend(tui|headless)、cli、model、sessionId、transcriptPath、cwd、account(占位)、baseCommit、startedAt、endedAt、parent。提供 `index.register/update/query` API，供后续 spawn 与 relay 写入；先从 relay 的 .project/relay/events 与 workers.md 导入已有记录（导入器）。
- `loom hist <role|task|addr> [--turns N] [--level L1|L2] [--json]`：用 adapters/*/transcript.parse 与 turnSummary 读原生会话记录；L1 每轮 ≤400 token（做了什么、工具计数、非零退出命令、最终回复首段），L2 展开单轮。Codex/agy 无头会话的原生记录同样适用。
- `loom state <target>`：TUI 用 hc read + screen.classify；无头的读取接口先留桩（等 runtimes/oar）。`loom ls [--project]`。
- 顺手修 adapters/codex 两项测试的可移植性（/var 与 /private/var 用 realpath 比较；launch 参数断言与实际实现对齐），只改 adapters/codex/*.test.mjs。
- 用 /Users/sun/Code/exp-relay/runs 下两轮实验的真实会话做验收：对每个角色 hist L1 输出与原生记录核对。
只写 index/、bin/、cli/（如需）、adapters/codex/*.test.mjs。

## 共同背景
loom_new 路线（用户已定）：loomd 为中心；运行后端两种——OAR（@botiverse/oar，无头：Codex app-server、agy ACP、OpenCode ACP）与 hc（TUI：Claude 顶层角色、人工接手）。协议 v2 以 OAR 契约为底座（PROTO-2 正在写 docs/PROTOCOL-v2.md；OAR-INTEG-0 正在写 runtimes/oar/ —— 二者目录勿改，可读）。现有零件：adapters/{claude,agy,codex}（TUI 适配器：screen.classify、hooks.normalize、transcript.parse/turnSummary、input.plan）、relay/（按波搬运最终回复）、docs/PROTOCOL.md（v1）、docs/REQUIREMENTS.md。OAR 源码只读：/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/oar。
Claude 入口标签：用户确认官方允许非默认 sdk-* 的自定义标签；loom 统一使用 `CLAUDE_CODE_ENTRYPOINT=loom`（仅无头 Claude 需要；TUI 不设置）。

## 共同红线
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己测试目录产生的会话记录；不改全局 CLI 配置。
- 只写本卡指定目录与 tasks/<本卡>/；不 commit；只操作自己创建的 hc 终端（实测目录放 /Users/sun/Code/exp-relay/<本卡小写>/），完成后 hc kill；不碰 Solars、t17*、CCP、其他 worker 终端。
- Node ESM 零依赖（OAR 除外）；测试 node --test 全绿；完成写 tasks/<本卡>/RESULT.md（中文），最后一行 STATUS: done。
