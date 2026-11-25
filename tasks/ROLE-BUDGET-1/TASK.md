# ROLE-BUDGET-1 — enforce the consumption pyramid (workers > Leader > Auditor)

Base: main HEAD. Do not commit. Rule source: docs/ORG.md "消耗金字塔" (user ruling 2026-11-25). Evidence: pilot-2 tokens — Auditor 69% raw (239 calls × ~230K cached context), Leader 18%, workers 12%; fresh input roughly equal across roles.
1. `loom cost`/`loom status`: per-role calls, raw tokens, fresh(new) input (Claude cache-write counts as new), output, and a pyramid check. Inversion (Auditor > Leader, or Leader > sum(workers)) over a rolling window → drift notice to Super (not to the Auditor), at most once per hour.
2. Auditor wake budget: policy `roles.auditor.maxWakesPerGate` (default 3) and `maxContextTokens` (default ~150K): when exceeded, loomd proposes Auditor rotation at the next safe boundary and tells the Leader to batch.
3. Gate packet: `loom gate pack <gate-id>` produces one compact file (evidence cards, diff --stat, test summary, reviewer verdicts, open questions ≤ 2 KB summary + pointers) and delivers ONE pointer to the Auditor — the only gate wake.
4. Leader/Auditor prompts and skill: Auditor reviews only the gate packet + reviewer conclusions, delegates deep checks to an ephemeral reviewer; Leader does not run full test suites itself (workers do, in their sandbox).
Tests for each; npm test green. RESULT.md Chinese, `STATUS: done`. Red lines as before.
