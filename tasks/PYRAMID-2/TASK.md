# PYRAMID-2 — remaining Auditor token leaks seen in pilot-2 goal 3 (after ROUTING-1/HIST-FIX-1 deployed)

Base: main @ 407f94c4 (deployed to pilot-2 2026-11-25). Do not commit. Evidence: /Users/sun/Code/loom-pilot2/.project/goal3-final-report.md and the Auditor pane screen.
Goal-3 phase raw tokens: Auditor ~14.55M > Leader ~7.69M > Worker ~2.99M (still inverted; R19 wants worker > Leader > Auditor).

1. **Claude idle compaction.** Claude 2.1.x compacts the context while idle ("⏺ Compacted while idle, before the prompt cache expired · turn off with \"idleCompaction\": false in settings.json"). It spends tokens with no loom wake and loom's screen recogniser reports the Auditor as `unknown`.
   - adapters/claude/launch.mjs: add `idleCompaction: false` to the `--settings` JSON loom already passes (never touch user settings.json). Policy override `roles.<r>.claude.idleCompaction` (default false), because loom rotates roles at gate boundaries itself.
   - Screen recogniser: treat that line (and the other "Compacted …" notices) as idle, not unknown. Add a fixture.
   - Live check with native Claude (isolated HOME, absolute path): the setting is accepted and has no startup warning.
2. **Reviewer before the gate pack.** Today the Auditor spawns the reviewer, and the reviewer's result wakes the Auditor a second time per gate. Change the default flow (skill, docs/ORG.md, role prompts):
   - The Leader runs the independent reviewer before `loom gate pack`.
   - The reviewer's conclusion is delivered to the Leader and included in the pack.
   - `loom gate pack` warns if a gate has no reviewer conclusion.
   - The Auditor may still spawn a reviewer for a deep check (counts as a wake against `maxWakesPerGate`).
   - Reviewer replies to the Auditor go through the reply-file/conclusion rule (no ack relays).
3. **Notification channels** (Auditor report "通知没有送出"):
   - `loom notifications --complete` is recorded per phase/goal (`--phase ID`), not once per project.
   - Add a plain pending-decision channel for the Auditor (`--needs-decision TEXT --kind decision`) separate from the four escalation reasons.
   - Super sees both in `loom notifications`.
4. **Stale pending delivery.** `loom ls` still shows delivery 5b58581e `uncertain` to the stopped Leader loom-919d7ab2. When a target session has ended, its pending deliveries must resolve to a terminal state (`target-ended`) and stop showing as pending.
5. Regression: replay pilot-2 goal 3 (read-only from /Users/sun/Code/loom-pilot2/.project) and report Auditor wakes per gate under the new flow.

npm test green; RESULT.md Chinese, `STATUS: done`. Red lines as before (no credentials, no user config writes, absolute CLI paths, isolated HOME for live checks, don't touch Solars/CCP/loom-next).
