# LEADER-ROT-1 — the Leader's context bloat is now the top token cost; rotate it at gate boundaries / context size

Evidence (pilot-2 goal 4, `loom cost`): Leader ≈22.3M raw tokens vs Auditor ≈6.1M, Worker ≈9.3M, Reviewer ≈3.0M. Last hour: Leader 35 calls / 10.19M raw (≈290K cached input per call), Auditor 10 calls / 0.94M. The agy Leader loom-8d74a63c has run since 2026-11-25 ~09:00 without rotation. Routing (R20) fixed the Auditor; the Leader now re-reads a huge context on every worker result. R19 wants worker > Leader > Auditor.

Base: main @ 955874e5 (deployed). Do not commit. No extra requests per message; rotation trades one briefing turn for much smaller later turns.
1. **Policy.**
   - `roles.leader.rotateAt` takes `"gate"` (after a gate completes and no card is mid-flight) and/or `maxContextTokens` (default e.g. 150K for the Leader, from the CLI's last-call input tokens).
   - The same mechanism and defaults as the Auditor's ROLE-BUDGET-1 rotation. Reuse it, don't duplicate.
   - The rotation decision is made by loomd from local counters. It is a Super/Auditor-visible event (`loom status`, notification log), not a wake of the Auditor.
2. **Safe succession** using the existing `--handover-from` path:
   - the brief is generated mechanically by loomd: open cards/waves, pending deliveries, last gate verdicts and their files, rulings pointer, policy pointer;
   - it is delivered with the DELIVERY-SLA-1 guarantees, and the half-pasted-brief case (919d7ab2) must be impossible: prove the brief is complete or use the oversize reply-file pointer for it (a one-time briefing, not per message);
   - in-flight worker results queue for the successor;
   - the predecessor retires only after the successor's first native turn acknowledges the brief.
3. **Side benefit to verify.** The successor starts with the new hook shim (HOOK-CWD-1), the stable LOOM_BIN shim (LIVENESS-1), and native question tools off (PROMPT-STATE-1). Show in `loom status` that the legacy-path warning clears for the role.
4. **Measure.** Replay pilot-2 goal 4 Leader turns with the rotation rule (read-only) and report the expected raw-token reduction vs the extra briefing turns. Report in tokens, not price.
5. Docs/skill: docs/ORG.md 消耗金字塔 section; the Auditor rotation and Leader rotation are described together.
npm test green; RESULT.md Chinese, `STATUS: done`. Red lines as before; never type into pilot-2 panes; no live rotation in pilot-2 from the worker (Super will trigger it after deploy).

## Item 6 (user, 2026-11-26): the Leader does reviewer/worker work itself
The pilot-2 agy Leader read memory/store.mjs, thought for 26 s and diagnosed the defect itself before forwarding. That work belongs to a worker or reviewer, and every file read costs the Leader's whole big context.
- Leader prompt and skill: the Leader does not read source or tests or diagnose. It forwards reviewer findings verbatim to the worker card (`loom send` with the reply file path) and spawns a reviewer for anything that needs reading. Allowed reads: gate packs, evidence cards, `loom hist` summaries, `git diff --stat`.
- Measure from `loom hist --role leader` (pilot-2, read-only): count Leader file reads/greps/test runs per gate before the change, and report it in RESULT.md as the baseline metric.
