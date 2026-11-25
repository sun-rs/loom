# HIST-FIX-1 — fixes from the t17w independent audit (do before pilot-2 gets ROUTING-1)

Base: main @ 726e799f (ROUTING-1 committed but NOT deployed). Audit: /Users/sun/.loom-next/runs/loom-next/briefing/ANSWER-t17w-hist-audit.md (read it fully; it cites file:line and pilot-2 record lines). Do not commit.

1. **Claude TUI + background tasks**: a Stop while a `run_in_background` tool_use has no completion (or task-notification pending) is `paused`, not terminal — no relay, no turn-end delivery. The later task-notification turn is attached to the original delivery and its reply is the one relayed. Live-verify with native Claude 2.1.331 (isolated HOME, absolute path, mock). Also add to Auditor/Leader prompts + skill: don't wait on background Bash; use worker/reviewer.
2. **agy `fullyIdle:false` Stop**: record as "background in progress" (busy), never drop silently; removes the `idle-without-stop` STUCK false positives.
3. **Relay only conclusions**: on top of ROUTING-1's `--expect-reply`, relay a reply only if its first line carries a decision tag (DONE/BLOCKED/FAILED/PASS/REJECT/APPROVE…) or the request was a gate pack whose reply is the conclusion turn; support `NOREPLY`. Acks ("收到", "继续等待", "无需回复") are recorded, never delivered.
4. **Evidence false positives** (they feed ROUTING-1 `routing.mjs:20` red escalation — fix before it can fire):
   - assertion stats: count only real deletions (kind=deleted), report rewrites separately (evidence/git.mjs:71);
   - "all green" claim check: attribute results per command; a baseline-green claim must not be compared against intentionally-red new tests (test-first cards); add a card flag `expectRed` honoured by the checker;
   - test sequence display grouped per command; recognise agy background-task results and nested `exec` (no false "open tools");
   - agy headless: tool calls with `tool_call_ended ok` must not count as open; turn-end with git heads must not show missing-boundary.
   Red escalation in routing.mjs only after these are correct; add regression from the audit's T6/T13/L3/8f1d01d6 cases.
5. **Silent truncation of a delivery**: reviewer 8f1d01d6's 25,702-char reply arrived as 16,056 chars (message cea7053b) with no marker. Any oversize body must go through the reply-file pointer path (PILOT2-TOOLS-1) — never truncate silently; add an assertion that delivered bodies equal their digest or carry an explicit pointer.
6. **Upgrade preflight failed on `spawnSync ps ETIMEDOUT`** (daemon/processes.mjs, new in HEADLESS-UNIFY-1): pilot-2 upgrade 8a88b9ad→726e799f aborted (old release correctly kept serving). Make process enumeration robust (async, bounded, retry, no full-table ps per check if avoidable) and make a transient enumeration failure not abort an upgrade without a clear retryable reason.
npm test green; RESULT.md Chinese, `STATUS: done`. Red lines as before.
