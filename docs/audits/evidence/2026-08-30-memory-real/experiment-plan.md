# Real memory acceptance — 2026-08-30

Isolated RAH OS current-worktree fixture, port 4189; no production restart.
Approved providers: OpenCode 1.18.22, deepseek/deepseek-v4-flash/max;
Kimi 0.38.0, kimi-code/k3/default. No Ultra, Claude or unpinned model run.

1. A learns fictional facts in a new Channel through a real CLI. The model,
   not the harness, writes MEMORY.md and notes. Preserve an index and a constraint.
2. A answers in a fresh DM with no answer in the question. Invalidate only
   fixture provider-continuity records after proven idle; record distinct sessions.
3. B independently answers the same question without training or A's membership.
4. Withhold A's test-only memory (recoverably) and continuity, then repeat in a
   fresh Channel. Restore the exact original memory after proven terminal state.
5. Correct A's fact, switch runtime to Kimi, ask in a new Channel. Verify stable
   identity/files and new native session. If a failure occurs record it, do not
   silently retry until success.
6. Record canonical messages, Run/Placement, prompt/revision/digest, file contents,
   native session identities, elapsed time and actual browser outcomes.

No production memory or chats are read by the fixture. No reference answers in
the project directory or role prompt. Diagnostic transcripts are evidence only,
never substituted for canonical replies. Finite call budget: at most 8 model turns,
each observed for at most 5 minutes before reporting failure/cancelling fixture.

Audit: Raft read-only UI at 1440x1000, RAH same-size interactive fixture, 390x844
smoke. Multica fixed source + official current source status. Distinguish observed,
automated, historical and untested. Do not claim statistical reliability or 1:1
equivalence from a bounded sample.
