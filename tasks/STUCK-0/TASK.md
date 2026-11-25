# STUCK-0：卡死检测与单边沿告警（自愈层）
目标：`watch/`：对索引中 live 的 TUI 会话，零 token 后台观测（hc get/read + adapters/*/screen.classify + hook 事件时间）。
- 识别：trust-dialog、picker、rate-limit/quota（含重置时间）、auth-fail、idle-without-stop（屏幕空闲但无 turn-end 超过阈值）、busy 超长无输出。
- 策略：已知安全弹窗（目录信任）按策略自动处理并记录；其他进入 needs-you，同一事件只告警一次（单边沿），恢复时发恢复事件；429/额度带重置时间，到点自动 resume 一次（发 queue 消息 "继续"）。
- 告警投递：写事件文件 + 可选 hc send 给指定 super 地址（参数传入，默认不发）。
- 60 秒内检测；单测用 adapters 的屏幕样本；实测在实测目录制造信任框与 idle-without-stop 各一次。
只写 watch/。

## 共同背景
loom_new 路线（用户已定）：loomd 为中心；运行后端两种——OAR（@botiverse/oar，无头：Codex app-server、agy ACP、OpenCode ACP）与 hc（TUI：Claude 顶层角色、人工接手）。协议 v2 以 OAR 契约为底座（PROTO-2 正在写 docs/PROTOCOL-v2.md；OAR-INTEG-0 正在写 runtimes/oar/ —— 二者目录勿改，可读）。现有零件：adapters/{claude,agy,codex}（TUI 适配器：screen.classify、hooks.normalize、transcript.parse/turnSummary、input.plan）、relay/（按波搬运最终回复）、docs/PROTOCOL.md（v1）、docs/REQUIREMENTS.md。OAR 源码只读：/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/oar。
Claude 入口标签：用户确认官方允许非默认 sdk-* 的自定义标签；loom 统一使用 `CLAUDE_CODE_ENTRYPOINT=loom`（仅无头 Claude 需要；TUI 不设置）。

## 共同红线
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己测试目录产生的会话记录；不改全局 CLI 配置。
- 只写本卡指定目录与 tasks/<本卡>/；不 commit；只操作自己创建的 hc 终端（实测目录放 /Users/sun/Code/exp-relay/<本卡小写>/），完成后 hc kill；不碰 Solars、t17*、CCP、其他 worker 终端。
- Node ESM 零依赖（OAR 除外）；测试 node --test 全绿；完成写 tasks/<本卡>/RESULT.md（中文），最后一行 STATUS: done。
