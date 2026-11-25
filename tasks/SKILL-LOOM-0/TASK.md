# SKILL-LOOM-0：project-loom skill（用 loom 命令跑 super→leader∥auditor→workers）
基于 skills/project-hc-relay/SKILL.md 与 skills/project-hc/SKILL.md，写 skills/project-loom/SKILL.md：所有角色用 `loom spawn` 拉起（leader/auditor 默认 claude TUI；worker 默认 codex/agy headless，必须写 --effort），消息用 `loom send`（默认 queue；steer/interrupt 的使用时机），查进度先 `loom hist`/`loom ls`/证据卡，必要时才发问；Leader 派完一波即结束本轮等 relay；Auditor 只在 FAILED/MISMATCH 抄送时核查、合入前独立复核证据卡；接替时 `loom handover`；super 主动查历史而非要求汇报，除非用户要求定期汇报。把亲历者访谈中适合写进 skill 的纪律收进来（docs/REQUIREMENTS.md 第 5 节）：不轮询、不越权、先复现再修、汇报格式、不提选项式问题。命令以 LOOM-CLI-0 正在实现的接口为准（读 docs/PROTOCOL-v2.md 与 bin/loom --help；不一致处在 RESULT 列出）。控制在 120 行内。
只写 skills/project-loom/；不建立符号链接（由 super 审核后再链接）。

## 共同背景
loom_new 路线（用户已定）：loomd 为中心；运行后端两种——OAR（@botiverse/oar，无头：Codex app-server、agy ACP、OpenCode ACP）与 hc（TUI：Claude 顶层角色、人工接手）。协议 v2 以 OAR 契约为底座（PROTO-2 正在写 docs/PROTOCOL-v2.md；OAR-INTEG-0 正在写 runtimes/oar/ —— 二者目录勿改，可读）。现有零件：adapters/{claude,agy,codex}（TUI 适配器：screen.classify、hooks.normalize、transcript.parse/turnSummary、input.plan）、relay/（按波搬运最终回复）、docs/PROTOCOL.md（v1）、docs/REQUIREMENTS.md。OAR 源码只读：/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/oar。
Claude 入口标签：用户确认官方允许非默认 sdk-* 的自定义标签；loom 统一使用 `CLAUDE_CODE_ENTRYPOINT=loom`（仅无头 Claude 需要；TUI 不设置）。

## 共同红线
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己测试目录产生的会话记录；不改全局 CLI 配置。
- 只写本卡指定目录与 tasks/<本卡>/；不 commit；只操作自己创建的 hc 终端（实测目录放 /Users/sun/Code/exp-relay/<本卡小写>/），完成后 hc kill；不碰 Solars、t17*、CCP、其他 worker 终端。
- Node ESM 零依赖（OAR 除外）；测试 node --test 全绿；完成写 tasks/<本卡>/RESULT.md（中文），最后一行 STATUS: done。
