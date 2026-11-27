# TOOLGUARD-2 — senior-tool friction and hist paging (from pilot-2 goal-6 Auditor report)
1. `senior-tool` requires the retried command to match the denied one byte-for-byte; quoted commands failed repeatedly. Match on a normalised command (shell-parsed argv) and accept an explicit `--retry <deny-id>` from the denial receipt instead of retyping. Deny receipts show the exact retry line to paste.
2. Reason quality: reject empty/one-word reasons ("probe", "true"), require ≥ a short sentence; record and show reasons in status.
3. Auditor budget notice repeated 127/99 all phase — notice once per gate, with the sample time.
4. `loom hist` returns only the last 5 turns per session with no way to page: add `--before <turn>` / `--page N` and `--all` (L1 summaries).
Base main HEAD (after INTEG-1), own worktree. Tests. RESULT.md Chinese, STATUS: done, uncommitted.
