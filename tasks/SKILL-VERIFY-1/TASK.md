# SKILL-VERIFY-1 — verification over review (methodology into skill + checks)

Read docs/research/2026-11-26-verification-over-review.md. Implement its 8 items:
- loom skill (Leader/Auditor/Worker sections) gets the rules, each ≤2 lines; remove prose rules that become checks.
- `loom lint` (project-level, runs in CI/`npm test`): red-line rules — tests must not spawn binaries outside fixture dirs or resolve CLIs via PATH; no reads of credential paths; network egress only via an allowlisted module; no writes to global config paths. Error messages written as root-cause instructions for agents.
- Evidence card: automatic diff of weakened assertions, new skips/only, deleted tests, plus red-proof link; list of invariants checked when the card touches persistence/retry/idempotency/egress.
- Reviewer trigger policy in loomd: allowed only when the gate pack is tagged security/egress/persistence/red-line or the Auditor states a reason; reviewer brief requires running code/checkers.
- Per-phase metric: findings caught by review but not by checks, by category.
Base main HEAD, own worktree. Tests for each rule. RESULT.md Chinese, STATUS: done, uncommitted.
