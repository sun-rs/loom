# LIVENESS-1 — "looks like it's working, actually stopped": detect, show, escalate (after PROMPT-STATE-1)

Sources: veteran answers /Users/sun/.loom-next/runs/loom-next/briefing/ANSWER-t17w-blocking-prompts.md and ANSWER-t17g-blocking-prompts.md (read both). User concern: coming back after hours to find a senior role stopped while Leader/workers kept going.
Base: main after PROMPT-STATE-1. Do not commit. Principle: no extra model requests; all signals are local (native records, hooks, holder bytes, token counters, process table).

1. **Liveness from crossed signals, not a status word.** Per session compute `lastProgressAt` from:
   - native record growth;
   - token counters (calls/output tokens increasing);
   - hook events;
   - de-noised screen change (spinner/clock regions masked).

   States:
   - `silent-hang`: the spinner moves but native, tokens and the de-noised screen stay static past a bound;
   - `waiting-poll`: a shell loop polling `loom state`/`sleep` with no model calls. Count it as waiting, not work, and show its cost as zero-progress time.
2. **Quota/429 and auth.**
   - `quota-wait` with next retry time when the CLI reports rate limit / quota exhaustion.
   - Clear it when a real turn makes progress, never from a stale statusline file. t2dv was still showing `quota_exhausted` 9 min after recovering.
   - `auth-expired` when login fails.
   - Both escalate for senior roles (desktop notice to user, once).
   - Never auto-switch models (existing rule).
3. **Native pop-ups that tool bans can't remove.** Each must be recognised (screen + native where possible) and handled. Fixtures from the veteran cases:
   - agy post-429 `[1..0]` rating box (blocked t2dv for 11 min, then 40 envelopes);
   - Codex update/upgrade prompt;
   - Codex cross-directory resume confirmation;
   - Claude trust dialog where the default is "No, exit";
   - agy wizard/announcement overlays.

   A dismissal is allowed only when the provider-specific safe key is known and proven. Otherwise use `awaiting-user` + escalation. Never a blind Enter.
4. **Crash back to shell.** If the CLI process exits and the pane returns to a shell, record `exited` with the code, notify, and offer to relaunch via the existing succession path. No keep-alive.
5. **Role prompts say nobody is watching.** Leader/Auditor/worker prompts and the skill must state:
   - no human is watching;
   - never ask the user interactively;
   - on a decision point, write facts + options + recommendation to a file, run `loom notifications --needs-decision … --kind decision`, end the turn with `BLOCKED <decision>`, and continue with anything independent.
   - Keep the tools available only for Super (the user's direct chat).
6. **Per-CLI-version smoke.** A `loom doctor --prompts` (or test script) that checks, for each installed CLI version, that the question-tool ban from PROMPT-STATE-1 item 4 still holds and that the recognisers still match. Run it in `loom upgrade --check` when a CLI version changed since the last run, and warn.
7. `loom status` top section, ordered by severity: stalled deliveries, awaiting-user/approval/choice, quota-wait/auth-expired, silent-hang, exited. Each shows role, since, and the one-line reason.
npm test green; RESULT.md Chinese, `STATUS: done`. Red lines as before; live checks in isolated HOME only.
