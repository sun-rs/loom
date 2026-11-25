# CLAUDE-TUI-RT-0：把 Claude TUI 实现为 OAR 契约的自定义 runtime
目标：`runtimes/claude-tui/` 实现 OAR `Runtime` 契约（/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/oar/packages/oar/src/contracts/，参考 community/ 下 cybion、morph 的外部实现方式），内部用 hc 持有 PTY + adapters/claude（hook 注入用当次 --settings；信任框 down enter）。用 `createRuntimeRegistry` 与 OAR 内置 runtime 并列注册。
必须：开会话（spawn TUI）、发一轮、turn 结局与最终回复（来自 Stop hook + transcript）、记录流（按 OAR record 形状，从 transcript/hook 生成）、interrupt、resume（同窗格续作）、steer（按 adapters/claude 能力声明 tui-queue，降级排队）、quota/rate_limited 识别（屏幕+StopFailure）。不支持的能力在 capabilities 中如实声明。
实测：用真实 claude（sonnet）在实测目录跑：两轮对话、一次中断后续作、一次工具调用期间 steer。
只写 runtimes/claude-tui/。

## 共同背景
loom_new 路线（用户已定）：loomd 为中心；运行后端两种——OAR（@botiverse/oar，无头：Codex app-server、agy ACP、OpenCode ACP）与 hc（TUI：Claude 顶层角色、人工接手）。协议 v2 以 OAR 契约为底座（PROTO-2 正在写 docs/PROTOCOL-v2.md；OAR-INTEG-0 正在写 runtimes/oar/ —— 二者目录勿改，可读）。现有零件：adapters/{claude,agy,codex}（TUI 适配器：screen.classify、hooks.normalize、transcript.parse/turnSummary、input.plan）、relay/（按波搬运最终回复）、docs/PROTOCOL.md（v1）、docs/REQUIREMENTS.md。OAR 源码只读：/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/oar。
Claude 入口标签：用户确认官方允许非默认 sdk-* 的自定义标签；loom 统一使用 `CLAUDE_CODE_ENTRYPOINT=loom`（仅无头 Claude 需要；TUI 不设置）。

## 共同红线
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己测试目录产生的会话记录；不改全局 CLI 配置。
- 只写本卡指定目录与 tasks/<本卡>/；不 commit；只操作自己创建的 hc 终端（实测目录放 /Users/sun/Code/exp-relay/<本卡小写>/），完成后 hc kill；不碰 Solars、t17*、CCP、其他 worker 终端。
- Node ESM 零依赖（OAR 除外）；测试 node --test 全绿；完成写 tasks/<本卡>/RESULT.md（中文），最后一行 STATUS: done。
