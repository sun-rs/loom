# EXP-STATS-1：EXP-RELAY-1 第 1 轮统计报告

## 输入
- 实验目录 /Users/sun/Code/exp-relay（README.md 的"统计"节说明了方法），本轮 run：runs/20261124151218-59651（timeline.jsonl 含角色地址；h0/h1 的 .project/workers.md 含 worker 地址；h1/.project/relay/events/ 含原生 Stop 会话 ID；Orca Run 为 `orca orchestration run-list` 中 objective 以 ER1O-20261124151218-59651 开头者，CLI /Applications/Orca.app/Contents/Resources/bin/orca，只读命令）。
- 隐藏验收：`DIR=<arm> node --test ~/.exp-graders/exp-relay/accept.test.mjs`。

## 要做
1. 为三臂（h0、h1、orca）的 Leader、Auditor、T1–T5 worker（含续开会话）定位原生会话文件，写 `runs/20261124151218-59651/sessions.json`，运行 `python3 tokens.py <manifest>` 和 `--json`。若 tokens.py 有 bug，可修复并在报告中说明。
2. 写 `runs/20261124151218-59651/REPORT.md`（中文），包含：
   - 三臂 × 角色表：调用数、新鲜输入、缓存读、输出、总量、fresh_plus_out；三臂合计；worker 合计；Leader+Auditor 合计。
   - Leader、Auditor 上下文增长：每臂的调用数、首次/末次/峰值上下文、上下文 token 序列之和。
   - 每个 worker 中途 send 次数及内容摘要。
   - 隐藏验收结果（每臂 pass/fail，失败项名称和原因）。
   - 时间线：每臂开始、各 worker 完成、项目完成时间；干预记录（timeline.jsonl 中的 intervention/manual 条目；H1 的 Codex worker 因 .codex/hooks.json 触发 Codex 文件夹信任框卡住约 20 分钟，由 super 手工确认）。
   - relay 行为：H1 relay 的投递次数、每次包含哪些任务（看 relay 终端日志 `hc read t2wx` 及 .project/relay 状态）、Leader 被唤醒次数。
   - 结论：三臂差异及其来源（按调用次数、上下文增长解释），注明 n=1 和 H1 的干预对耗时的影响。
3. 最后一行 `STATUS: done`。

## 红线
- 只读取 cwd 属于 /Users/sun/Code/exp-relay/{h0,h1,orca} 且时间在本轮（2026-11-24 15:12Z 之后）的会话文件；不读其他会话记录、凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）。
- 只读命令：不 hc send/keys/kill，不改三臂仓库，不调用 orca 的写操作。只写 runs/20261124151218-59651/、tokens.py 和 loom_new/tasks/EXP-STATS-1/。
