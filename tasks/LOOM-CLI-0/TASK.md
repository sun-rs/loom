# LOOM-CLI-0：统一 loom spawn + loomd 串联 + 收尾整合
先读所有已交付 RESULT：tasks/{OAR-INTEG-0,CLAUDE-TUI-RT-0,HIST-0,INBOX-0,STUCK-0,EVID-0,HANDOVER-0,PROTO-2}/RESULT.md 与 docs/PROTOCOL-v2.md。
1. `loom spawn <role> --cli codex|agy|claude|opencode --mode tui|headless --model --effort(必填，不依赖各家默认) --cwd --project --task --wave [--parent] "<prompt>"`：headless 走 runtimes/oar（codex app-server、agy ACP、opencode ACP）；tui 走 hc + adapters（claude 走 runtimes/claude-tui）。claude --mode headless 允许，经 OAR 并设置 CLAUDE_CODE_ENTRYPOINT=loom；TUI 不设置。spawn 时写会话索引（含 baseCommit=git rev-parse HEAD、transcriptPath 绑定后回填）、登记 workers.md 波次。原生 Claude 二进制路径要显式解析，避免 PATH 命中 CCP 包装器。Codex 人工接手提示附 `-c check_for_update_on_startup=false`。
2. `loomd`：单进程（单写者）串起 relay（按波搬运+证据卡附加）、inbox（queue/steer/interrupt 投递与回复路由）、watch（卡死检测单边沿告警）、索引写入；`loom daemon start|stop|status`，可前台运行；崩溃重启后从持久状态恢复。
3. `schema/`：按 PROTOCOL-v2 建议，import type 并 re-export @botiverse/oar 类型，只保留 loom 扩展类型（Role、SessionIndex、SendMode、波次/投递记录、命令参数与回执）；核心索引保留 transcriptPath、baseCommit。docs/PROTOCOL.md 移到 docs/archive/PROTOCOL-v1.md，README 指向 PROTOCOL-v2。
4. 依赖统一：根目录 package.json 锁定 @botiverse/oar@0.130.1，删除 runtimes/claude-tui/node_modules 等子目录重复依赖。
5. 修 agy 中断轮 endedAt 为 null 的解析 bug（adapters/agy，见 OAR-INTEG-0 RESULT 失败项）。证据卡与简报的长度上限从字节改为近似 token（中文按字计），保持 ≤300 / ≤1500 token。
6. 一键测试：根目录 `npm test` 运行全部 *.test.mjs（排除 node_modules），全绿。
7. 端到端冒烟（实测目录 /Users/sun/Code/exp-relay/loom-cli-0/）：loomd 启动 → spawn claude TUI leader（sonnet）→ leader 用 loom spawn 派 1 个 codex headless + 1 个 agy headless worker 同一波 → relay 合并一条（附证据卡）→ super 用 loom send queue 问 leader 一句，回复回到 super（用一个普通 shell 终端扮 super）→ loom hist 查 leader 与 worker → loom handover leader 生成简报。记录每步证据。
可写全仓库（除 docs/REQUIREMENTS.md、tasks/ 下其他卡），保持各模块原有测试通过。

## 共同背景
loom_new 路线（用户已定）：loomd 为中心；运行后端两种——OAR（@botiverse/oar，无头：Codex app-server、agy ACP、OpenCode ACP）与 hc（TUI：Claude 顶层角色、人工接手）。协议 v2 以 OAR 契约为底座（PROTO-2 正在写 docs/PROTOCOL-v2.md；OAR-INTEG-0 正在写 runtimes/oar/ —— 二者目录勿改，可读）。现有零件：adapters/{claude,agy,codex}（TUI 适配器：screen.classify、hooks.normalize、transcript.parse/turnSummary、input.plan）、relay/（按波搬运最终回复）、docs/PROTOCOL.md（v1）、docs/REQUIREMENTS.md。OAR 源码只读：/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/oar。
Claude 入口标签：用户确认官方允许非默认 sdk-* 的自定义标签；loom 统一使用 `CLAUDE_CODE_ENTRYPOINT=loom`（仅无头 Claude 需要；TUI 不设置）。

## 共同红线
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己测试目录产生的会话记录；不改全局 CLI 配置。
- 只写本卡指定目录与 tasks/<本卡>/；不 commit；只操作自己创建的 hc 终端（实测目录放 /Users/sun/Code/exp-relay/<本卡小写>/），完成后 hc kill；不碰 Solars、t17*、CCP、其他 worker 终端。
- Node ESM 零依赖（OAR 除外）；测试 node --test 全绿；完成写 tasks/<本卡>/RESULT.md（中文），最后一行 STATUS: done。
