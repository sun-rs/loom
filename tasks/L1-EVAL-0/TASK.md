# L1-EVAL-0: build a sample pack so senior reviewers can judge L1/L2/fact rows on real sessions
Context: L1 summaries are produced by loomd with deterministic rules from native transcripts (no model). LOOM-UX-1 added fact rows, outcome filter, --wave, --diff, --grep. The two senior reviewers (ex-Leader agy, ex-Auditor Claude) have only read the description, not real output.
1. Pick real native transcripts that already exist from our own experiments only: /Users/sun/Code/exp-relay/runs/* worker sessions (Codex, agy), the Claude TUI sessions created by tasks LOOM-CLI-0/TUI-REL-0/CLAUDE-TUI-RT-0 test dirs under /Users/sun/Code/exp-relay/. At least: 3 Codex, 3 agy, 2 Claude, including at least 2 failed/aborted turns and 1 long multi-turn session.
2. For each, produce side by side in one markdown file per session: (a) the raw native final reply, (b) loom hist L1 (with fact rows), (c) L2 of the most interesting turn with filters, (d) --diff output if commits exist, (e) evidence card if available. Record token counts (approx) of each view vs raw transcript size.
3. Write tasks/L1-EVAL-0/PACK.md: index of samples plus 6 questions for reviewers (Would L1 have let you skip reading raw? What fact is missing? Any misleading line? etc.). Do not judge yourself beyond listing obvious extraction bugs found (fix none; list them).
4. If loom hist cannot ingest a transcript outside the index, write a small read-only script in tasks/L1-EVAL-0/ that calls the same adapter functions.
Writable: tasks/L1-EVAL-0/ only. Write RESULT.md in Chinese, last line STATUS: done.

## 共同红线
- 不读凭据（~/.codex/auth.json、~/.codex/memories*、Claude 凭据/keychain、agy token、~/.loom-next/provider-homes、.env）；只读自己测试目录产生的会话记录；不改全局 CLI 配置。
- 只写本卡指定目录与 tasks/<本卡>/；不 commit；只操作自己创建的 hc 终端（实测目录放 /Users/sun/Code/exp-relay/<本卡小写>/），完成后 hc kill；不碰 Solars、t17*、CCP、其他 worker 终端。
- Node ESM 零依赖（OAR 除外）；测试 node --test 全绿；完成写 tasks/<本卡>/RESULT.md（中文），最后一行 STATUS: done。
