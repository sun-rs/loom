# ROT-TUNE-2 — rotation v2 follow-ups (after INTEG-1 lands)
From the Solars supervisor's answer (docs/research/2026-11-26-senior-rotation.md, "补充（t4c…）"):
1. Hard trigger: two consecutive dispatches that omitted a hard constraint (flagged by the counterpart with evidence) → rotate at the next clean boundary.
2. Soft "strict verification" mode (no rotation): at the 3rd native compaction, ~48 h continuous runtime, or entering a new phase, loomd attaches a short reminder to the next existing delivery: verify every SHA/path/number by command before stating it; self-check the ledger for drift about every 150 turns.
3. Stagger rule: the older counterpart verifies the successor's first report AND first decisions until one full phase has passed; loomd blocks a counterpart rotation during that window.
Base on integ/main-1 (or main after Super merges it). Tests per item. RESULT.md Chinese, STATUS: done, uncommitted.

**From t4c's review of v2 (briefing/REVIEW-ANSWER-t4c-senior-rotation.md):**
4. B1 only for cross-project or major-goal reset; same-project sub-phases (integration → regression → debugging) are allowed clean windows, not triggers.
5. B3/compaction thresholds → enter strict mode + "rotation evaluation" notice at the next clean boundary, never a hard rotation on count alone.
6. Automatic anomaly probes to cover human-marking gaps: dispatch/brief text containing a SHA that doesn't exist or isn't current where it claims to be, or paths that don't exist; the same worker slot failing for the same cause ≥ N times. Probe hits count as candidate verified errors pending counterpart confirmation.
7. Ruling churn: ≥2 new rulings that overturn earlier ones since the last rotation counts as a topic switch.
8. The handover note itself is checked by the counterpart (SHA/paths/open items verified by command) before the successor relies on it.
