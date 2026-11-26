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

## Item 7 (user ruling R21, 2026-11-26) — no routine reviewer; the Leader stops running tests
User: "新增一个角色，这是在原计划之外的，不合理。你可以顶多是auditor自己派出sub或者小worker，但是一般是临时的，不是常规动作。"
User also noted the Leader in the pure-hc prototype was woken often and had long conversations, yet was never the top token consumer.

Measured from the pilot-2 Leader transcript (9a62b0a0, 478 steps). Context grew from 57K to 317K tokens with no compaction. Tool-output and system content by category:

| Category | Count | Share |
|---|---|---|
| Running tests | 47 | 46% (192K chars) |
| File reads/searches | 35 | 21% |
| Other | 38 | 12% |
| `loom state`/send JSON | 27 | 8% |
| git merge/worktree | 11 | 6% |
| agy efficiency reminders | 44 | 5% |

Ten background-task results were ~10K chars each.

1. **Revert PYRAMID-2 item 2 as a default.** Gates no longer spawn a reviewer. `loom gate pack` no longer warns about a missing reviewer conclusion. A reviewer is an Auditor-only, occasional, temporary one-turn check: rate-limited per gate, counted against `maxWakesPerGate`, never spawned by the Leader by default.
   - Update docs/ORG.md, the skill and role prompts, and the policy example (reviewer no longer listed as a standing role; keep the spawn mechanism for the Auditor's rare use).
2. **Verification lives in the worker card.**
   - The worker runs the full suite in its own card (now possible under the sandbox, LIVENESS-1 item 9) and the evidence card records it.
   - Integration/merge of candidate branches and the full-suite run on the candidate are a worker card ("integration worker"), not Leader commands.
   - The Leader never runs `npm test`, never reads source/tests, never polls `loom state` in loops. It uses `loom status`/evidence summaries that loomd pushes on its next wake.
3. **Measure** with the same categorisation (script in the task dir), before and after on a replay, and report the expected Leader context and raw-token drop.
