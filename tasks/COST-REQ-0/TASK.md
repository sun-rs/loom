# COST-REQ-0: is request count the main token driver? Quantify from real records
Hypothesis (user): token spend is driven mainly by the NUMBER OF MODEL REQUESTS per session (each tool round-trip re-sends the whole context, even with caching), not by output size; avoidable "tail" requests (extra tool calls after the work is effectively done) are a major waste.
Data you may read (read-only):
- loom-next repo /Users/sun/Code/repos/loom-next (docs, ledgers, journals, task results, any usage/telemetry logs) and /Users/sun/.loom-next/runs/loom-next/ EXCEPT anything under provider-homes.
- /Users/sun/Code/exp-relay/runs/* (tokens.json, REPORT.md, timelines) and existing stats from tasks/EXP-STATS-1, EXP-STATS-2 in loom_new.
- Native session files (Codex ~/.codex/sessions rollouts, Claude ~/.claude/projects/*.jsonl, agy transcripts) ONLY for sessions whose cwd is under /Users/sun/Code/repos/loom-next, /Users/sun/Code/repos/loom_new, /Users/sun/Code/exp-relay, /Users/sun/Code/exp-csvstat or /Users/sun/.loom-next/runs/loom-next. Filter by cwd before reading content; never read sessions of other projects.
Do:
1. Per session: number of model requests (API calls), input tokens (uncached / cached), output tokens, cost-weighted total (state the weights: e.g. cached input at its discounted rate). Use per-request usage fields where present.
2. Fit/describe how total spend relates to request count vs output size vs context length (simple regression or binned tables; state R²). Show how per-request input grows over a session.
3. Classify requests by purpose using the tool call that triggered them; identify "tail" requests: after the substantive work (last edit/test), e.g. writing RESULT, loom report / hc send / notify commands, git status/diff for self-reporting, re-reading files to confirm, polling status. Count them per worker and estimate their share of spend (cost-weighted, since tail requests carry the largest context).
4. Same for Leader/Auditor sessions: wakes, polling, reading worker output, confirmation calls.
5. Separate process-induced requests (required by skill/protocol: self-report, send, line counts) from model-habit requests (repeated git status, re-reading the same file).
6. Recommend concrete changes for loom_new: actions loomd should do mechanically, things the skill should forbid, with estimated savings per worker/leader.
Write tasks/COST-REQ-0/RESULT.md in Chinese with tables and sources; scripts in tasks/COST-REQ-0/. Last line STATUS: done.
Red lines: never read credentials (~/.codex/auth.json, ~/.codex/memories*, Claude credentials/keychain, agy tokens, ~/.loom-next/provider-homes, any .env); do not modify any repo except writing tasks/COST-REQ-0/; no commits; do not touch Solars, CCP, t17* terminals or other workers.
