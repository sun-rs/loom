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

## Item 8 (user principle, 2026-11-26): senior roles make decisions, not tool calls — enforce it mechanically
User: "为了保障高级角色始终有清晰的意识，也就是上下文没被信息塞满，这样压缩次数少，幻觉少，那么必须让他们做决策，而不是具体的工具调用。"

Evidence that the cause is our own planning, not the model:
- The skill the pilot-2 Leader loaded (9603c9c1) told it to "执行门禁、集成和获授权的合入" and "在固定候选 SHA 的干净隔离 worktree 执行项目授权的集成验收".
- The Auditor's verdicts demanded a full `npm test` record from the Leader (goal 3: "合入后在 pilot-2 跑一次 npm test…发我"; goal 4 merge r1: "没有全量 npm test 全绿记录").
- Workers could not run the suite in the sandbox until LIVENESS-1.
- A comparable hc-era agy coordinator (t37) ran 4 tests and 5 reads in 123 steps; the pilot-2 Leader ran 47 and 35 in 478 steps.

1. **Rewrite the Leader and Auditor sections of skills/loom/SKILL.md, docs/ORG.md and the role prompts** as decision roles.
   - Leader: split cards, dispatch, read worker receipts/evidence summaries, decide next, pack gates, escalate.
   - Auditor: judge from the gate pack.
   - Remove every instruction that makes a senior role integrate, merge, run tests or read code.
   - Integration, merge and full-suite runs on the candidate are an integration worker card. Its evidence card is what the Auditor asks for.
   - Fix the Auditor wording so it asks for "the integration worker's evidence", never "run npm test and send me".
2. **Graduated guard, never an absolute ban (user + Super decision, 2026-11-26).** User: "不能绝对限制，可以留口子……否则真的遇到处理不了的问题怎么办". Decision: default-deny with a reasoned override, cap the output, count it. Hooks are launch-scoped and per CLI (Claude PreToolUse; agy's mounted PreToolUse; Codex/OpenCode equivalents). The setting is `roles.<r>.toolGuard`, default on for leader/auditor. Super is exempt.
   - **Tier 0, always allowed:**
     - `$LOOM_BIN` commands;
     - reading `.project/` (gate packs, evidence, rulings, charter, reply files);
     - `git log` / `diff --stat` / `rev-parse`;
     - a targeted read of a source range of at most ~200 lines, needed to write good cards;
     - writing `.project/` notes.
   - **Tier 1, not recommended, needs a reason:**
     - what it covers: test/build runners, `git merge/rebase/cherry-pick/worktree add`, broad reads or recursive grep over the repo, loop polling of `loom state`;
     - the first attempt is denied with "建议派 worker 卡；确有必要请带理由重试", and the retry passes when it carries a reason (e.g. `LOOM_SENIOR_OVERRIDE="<reason>" <cmd>`, or the CLI's equivalent);
     - an allowed Tier-1 call has its output capped to a tail (~40 lines) or a one-line summary before it enters the role's context — this matters more than the deny;
     - each override is recorded in hist and `loom status` (`senior-override`, with the reason);
     - the budget is 3 per gate by default; going over it is never blocked and raises one Super notice ("division of labour or card design needs a look").
   - **Tier 2, emergency:** when loomd itself sees worker spawn failing, OAR down, or a delivery stalled past the SLA, Tier-1 overrides are auto-permitted with reason `worker-unavailable` (still capped and logged).
3. **Context hygiene signal.** loomd tracks the per-role share of context filled by tool output (the categorisation from item 7) and raises a Super-visible drift notice when a senior role's tool-output share in a window exceeds a bound. Local counters only.
4. Measure: replay the pilot-2 Leader transcript with the guard. Report which of the 47 test runs, 35 reads and 11 git operations would have been denied, and the expected context ceiling.
