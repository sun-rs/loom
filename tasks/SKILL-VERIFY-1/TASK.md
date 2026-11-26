# SKILL-VERIFY-1 — verification over review (methodology into skill + checks)

Read docs/research/2026-11-26-verification-over-review.md. Implement its 8 items:
- loom skill (Leader/Auditor/Worker sections) gets the rules, each ≤2 lines; remove prose rules that become checks.
- `loom lint` (project-level, runs in CI/`npm test`): red-line rules — tests must not spawn binaries outside fixture dirs or resolve CLIs via PATH; no reads of credential paths; network egress only via an allowlisted module; no writes to global config paths. Error messages written as root-cause instructions for agents.
- Evidence card: automatic diff of weakened assertions, new skips/only, deleted tests, plus red-proof link; list of invariants checked when the card touches persistence/retry/idempotency/egress.
- **Remove the reviewer role** (user 2026-11-26: "我们的 reviewer 其实就应该是 auditor，但他的检查是阶段性的"; R21 already forbade a routine reviewer, yet goal 5 used 3 temporary reviewers): delete `roles.reviewer`, the reviewer spawn path, the per-gate reviewer quota and the reviewer cost line; the Auditor's deeper check happens at phase boundaries by the Auditor itself, based on the deterministic checks above plus a worker evidence card when it needs something run (it does not read code broadly). Gate packs stop referencing reviewer verdicts. Migrate existing projects' policy files (warn, ignore the key).
- Per-phase metric: findings caught by review but not by checks, by category.
Base main HEAD, own worktree. Tests for each rule. RESULT.md Chinese, STATUS: done, uncommitted.
