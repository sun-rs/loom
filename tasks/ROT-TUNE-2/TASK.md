# ROT-TUNE-2 — rotation v2 follow-ups (after INTEG-1 lands)
From the Solars supervisor's answer (docs/research/2026-11-26-senior-rotation.md, "补充（t4c…）"):
1. Hard trigger: two consecutive dispatches that omitted a hard constraint (flagged by the counterpart with evidence) → rotate at the next clean boundary.
2. Soft "strict verification" mode (no rotation): at the 3rd native compaction, ~48 h continuous runtime, or entering a new phase, loomd attaches a short reminder to the next existing delivery: verify every SHA/path/number by command before stating it; self-check the ledger for drift about every 150 turns.
3. Stagger rule: the older counterpart verifies the successor's first report AND first decisions until one full phase has passed; loomd blocks a counterpart rotation during that window.
Base on integ/main-1 (or main after Super merges it). Tests per item. RESULT.md Chinese, STATUS: done, uncommitted.
