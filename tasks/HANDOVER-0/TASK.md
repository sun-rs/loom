# HANDOVER-0：高级角色历史留存与接替简报（机械）
依据：用户要求留存 leader/auditor 历史，方便接替者查询；亲历者痛点：压缩失忆、换班过重（/Users/sun/.loom-next/runs/loom-next/briefing/ANSWER-t17g-painpoints.md、/Users/sun/.loom-next/runs/loom-next/briefing/ANSWER-t17w-painpoints.md）。
目标：`handover/`：
- 留存：leader/auditor/super 每次会话结束、换班、压缩（Claude compact_boundary、Codex/agy 对应事件）时，保证原生会话记录可找到（不复制大文件；登记路径+哈希；若 CLI 会轮转/清理则做只读归档副本到 .project/archive/）。
- 接替简报（daemon 机械生成，不调用模型，≤1500 token）：角色、项目、会话链（parent 链）、最近 N 轮 L1 摘要（调用 adapters turnSummary）、在途 worker 与波次状态（workers.md/relay state）、收件箱待投/未回复消息（inbox/，INBOX-0 正在实现，可读其持久文件或留接口）、近期卡死告警（watch/，STUCK-0 进行中，同上）、最近证据卡 MISMATCH（evidence/，EVID-0 进行中，同上）、未提交改动（git status --short）。
- `loom handover <role> --project P [--to <新地址>]`：生成简报；若给出 --to，用 queue 模式投递给接替者。业务判断（是否换班、交接什么决策）留给角色与 skill。
- 验收：用 exp-relay 两轮实验中 leader/auditor 的真实会话生成简报，核对事实无误；单测覆盖缺失组件时的降级（组件未就绪时写明"不可用"）。
只写 handover/。

## 共同背景
loom_new 路线（用户已定）：loomd 为中心；运行后端两种——OAR（@botiverse/oar，无头：Codex app-server、agy ACP、OpenCode ACP）与 hc（TUI：Claude 顶层角色、人工接手）。协议 v2 以 OAR 契约为底座（PROTO-2 正在写 docs/PROTOCOL-v2.md；OAR-INTEG-0 正在写 runtimes/oar/ —— 二者目录勿改，可读）。现有零件：adapters/{claude,agy,codex}（TUI 适配器：screen.classify、hooks.normalize、transcript.parse/turnSummary、input.plan）、relay/（按波搬运最终回复）、docs/PROTOCOL.md（v1）、docs/REQUIREMENTS.md。OAR 源码只读：/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/oar。
Claude 入口标签：用户确认官方允许非默认 sdk-* 的自定义标签；loom 统一使用 `CLAUDE_CODE_ENTRYPOINT=loom`（仅无头 Claude 需要；TUI 不设置）。

## 共同红线
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己测试目录产生的会话记录；不改全局 CLI 配置。
- 只写本卡指定目录与 tasks/<本卡>/；不 commit；只操作自己创建的 hc 终端（实测目录放 /Users/sun/Code/exp-relay/<本卡小写>/），完成后 hc kill；不碰 Solars、t17*、CCP、其他 worker 终端。
- Node ESM 零依赖（OAR 除外）；测试 node --test 全绿；完成写 tasks/<本卡>/RESULT.md（中文），最后一行 STATUS: done。
