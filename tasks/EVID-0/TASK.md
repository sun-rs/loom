# EVID-0：机械证据卡（声称 vs 实际）
依据：两位亲历者的痛点（/Users/sun/.loom-next/runs/loom-next/briefing/ANSWER-t17w-worker-history.md、/Users/sun/.loom-next/runs/loom-next/briefing/ANSWER-t17g-worker-history.md、/Users/sun/.loom-next/runs/loom-next/briefing/ANSWER-t17{w,g}-painpoints.md）——77% 审查退回、"自称全绿"不可信、沙箱跳测。
目标：`evidence/`：worker 一轮结束时（relay 收到 turn-end）由 daemon **机械**采集，不调用模型：
- `git diff --numstat` 相对 baseCommit（来自会话索引；HIST-0 正在实现 index.query，可先用参数传入）、改动文件清单、命中保护路径（项目配置的 glob 列表）、被修改/删除的测试文件与被删除的断言行数、新增 skip/only。
- 从该轮原生会话记录（adapters/*/transcript.parse）提取实际执行过的验证命令（node --test、npm test、pytest、go test 等）及退出码、最后几行输出的哈希与摘录；标注是否在沙箱中运行。
- 最终回复中的声称（DONE/全绿/通过 N 项/已合入等，用简单规则提取）与实际证据并排；不一致处标 MISMATCH。
- 输出：`.project/evidence/<task>-<turn>.json` + ≤300 token 的文本卡；提供 `evidence.forTurn()` API，供 relay 附在搬运消息后（relay 只做最小改动：可选附加，保持测试通过）。
- 验收：用 /Users/sun/Code/exp-relay 两轮实验（runs/*/arms-final.tgz 与当前 h0/h1/orca 仓库、相关会话）生成证据卡，人工抽查 5 张；单测覆盖 MISMATCH、跳测、删断言。
只写 evidence/、relay/（最小改动）。

## 共同背景
loom_new 路线（用户已定）：loomd 为中心；运行后端两种——OAR（@botiverse/oar，无头：Codex app-server、agy ACP、OpenCode ACP）与 hc（TUI：Claude 顶层角色、人工接手）。协议 v2 以 OAR 契约为底座（PROTO-2 正在写 docs/PROTOCOL-v2.md；OAR-INTEG-0 正在写 runtimes/oar/ —— 二者目录勿改，可读）。现有零件：adapters/{claude,agy,codex}（TUI 适配器：screen.classify、hooks.normalize、transcript.parse/turnSummary、input.plan）、relay/（按波搬运最终回复）、docs/PROTOCOL.md（v1）、docs/REQUIREMENTS.md。OAR 源码只读：/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/oar。
Claude 入口标签：用户确认官方允许非默认 sdk-* 的自定义标签；loom 统一使用 `CLAUDE_CODE_ENTRYPOINT=loom`（仅无头 Claude 需要；TUI 不设置）。

## 共同红线
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己测试目录产生的会话记录；不改全局 CLI 配置。
- 只写本卡指定目录与 tasks/<本卡>/；不 commit；只操作自己创建的 hc 终端（实测目录放 /Users/sun/Code/exp-relay/<本卡小写>/），完成后 hc kill；不碰 Solars、t17*、CCP、其他 worker 终端。
- Node ESM 零依赖（OAR 除外）；测试 node --test 全绿；完成写 tasks/<本卡>/RESULT.md（中文），最后一行 STATUS: done。
