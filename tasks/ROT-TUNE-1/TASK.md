# ROT-TUNE-1 — senior roles rotate far too often; base rotation on the real window

User 2026-11-26 spotted it. pilot-2 today: Leader 8d74a63c → 0ef6d5a6 → 550a7cf2 → b201e51d (rotated at ~152k and ~157k input tokens), Auditor d173a83a → 8e5fb845 → b8f95f0b → 601864e7. Causes in code:
- `daemon/role-budget.mjs` `rotationReason`: `contextTokens > maxContextTokens` with a fixed default of 150,000 — about 15% of a 1M-class window (agy Gemini 4 Neon, Claude Sonnet 5.5) — and `wakes > maxWakesPerGate`, which turns "Auditor woken too often in one gate" into a rotation;
- policy `roles.auditor.rotateAt: "gate"` rotates the Auditor at every gate (Super has removed it from both pilots' policy.json).
Each rotation costs a full briefing turn (~160k raw tokens measured in LEADER-ROT-1) and loses working context.
Change:
1. Rotation trigger = fraction of the role's **actual** context window (read per CLI/model from native data: Codex rollout `model_context_window`, Claude/agy statusline or model metadata; record the source; fall back to a per-model table) — default rotate when the latest call's input ≥ 60% of the window, or when the role has compacted once and is approaching a second compaction (remaining < 15% after a compaction). Only at a card/gate boundary; never mid-turn.
2. Wakes-per-gate over budget → a process notice to Super (organisation problem), never a rotation.
3. Remove `rotateAt: "gate"` from defaults/examples; keep it as an explicit opt-in.
4. `loom status` shows per senior role: context %/window, compactions, rotations today and their reasons; `loom cost` shows rotation briefing tokens.
5. Fix wording everywhere (skill, docs) so there is no "2nd compaction OR <15%" paradox: the mid-work handoff condition is "already compacted once AND remaining < 15% again".
Tests for each trigger; replay today's pilot-2 events and show the new rule would have rotated ≤ 1 time per role. Own worktree from main. RESULT.md Chinese, STATUS: done, uncommitted.
