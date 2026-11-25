# INBOX-0：空闲投递收件箱 loom send（说话层）
目标：`inbox/` 与 `loom send <target> --mode queue|steer|interrupt [--from <addr>] "<msg>"`。
- queue（默认）：持久化排队（单写者、每条有 id），目标 turn-end 事件到达后投递；回执 {id, status: queued|delivered|steered|interrupted, at}。0 丢 0 重：投递前后落盘，重启恢复。
- steer：按目标 adapter 的 capabilities（Codex native、Claude tui-queue、agy tui-queue）执行 input.plan；不支持则降级 queue 并在回执标明。
- interrupt：执行中断后在原窗格发送消息（续作）。
- 回复路由：消息带 from，目标处理该消息的那一轮最终回复由 relay 送回 from（与 relay 对接，最小改动 relay/ 并保持其测试通过）。
- turn-end 事件来源：TUI 用现有 hook 事件文件（relay 的 events）；无头留接口等 runtimes/oar。
- 实测：codex 与 agy TUI 各一个目标，忙时 queue、忙时 steer、interrupt 各一次；验证回复回到 from。
只写 inbox/、relay/（最小改动）、bin/loom 中 send 子命令（如 HIST-0 同时在写 bin/loom，请把子命令实现放 inbox/cli.mjs，由 bin/loom 动态加载，避免冲突）。

## 共同背景
loom_new 路线（用户已定）：loomd 为中心；运行后端两种——OAR（@botiverse/oar，无头：Codex app-server、agy ACP、OpenCode ACP）与 hc（TUI：Claude 顶层角色、人工接手）。协议 v2 以 OAR 契约为底座（PROTO-2 正在写 docs/PROTOCOL-v2.md；OAR-INTEG-0 正在写 runtimes/oar/ —— 二者目录勿改，可读）。现有零件：adapters/{claude,agy,codex}（TUI 适配器：screen.classify、hooks.normalize、transcript.parse/turnSummary、input.plan）、relay/（按波搬运最终回复）、docs/PROTOCOL.md（v1）、docs/REQUIREMENTS.md。OAR 源码只读：/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/oar。
Claude 入口标签：用户确认官方允许非默认 sdk-* 的自定义标签；loom 统一使用 `CLAUDE_CODE_ENTRYPOINT=loom`（仅无头 Claude 需要；TUI 不设置）。

## 共同红线
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己测试目录产生的会话记录；不改全局 CLI 配置。
- 只写本卡指定目录与 tasks/<本卡>/；不 commit；只操作自己创建的 hc 终端（实测目录放 /Users/sun/Code/exp-relay/<本卡小写>/），完成后 hc kill；不碰 Solars、t17*、CCP、其他 worker 终端。
- Node ESM 零依赖（OAR 除外）；测试 node --test 全绿；完成写 tasks/<本卡>/RESULT.md（中文），最后一行 STATUS: done。
