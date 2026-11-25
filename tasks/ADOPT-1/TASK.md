# ADOPT-1 — robustness items adopted from the Paseo audit (and the aggregator survey, if ready)

Base: main after UPGRADE-FAIL-1. Source: docs/research/2026-11-25-paseo.md §8 (code-level audit with file:line). Do not commit.
1. Codex deterministic refusals (daemon/codex-pipe-session.mjs ~200-205, inbox/engine.mjs ~319): map exact codex 0.171 errors (`no active turn to steer`, `activeTurnNotSteerable`, `active turn uses a different output schema`, `no active turn to interrupt`) to refused/steer-unavailable/status-mismatch instead of uncertain; steer refusal downgrades to queue. Test with fake -32600 frames: no `delivery-uncertain` notice.
2. After an aborted Codex turn, terminate its background terminals: record processId from commandExecution item/started; after aborted turn-end send `thread/backgroundTerminals/terminate` once per id (never clean); next turn/start only after terminates are sent. Test ordering + exactly-once.
3. OpenCode TUI export (daemon/tui.mjs ~46-68): raise maxBuffer sensibly, and N consecutive export failures → explicit `stuck`/report, never silent busy. Test >8MB fake export.
4. L2 tool calls get `status` (completed/failed/canceled/open) and an `openCalls` fact on turns that end with open calls (lib/turn-tools.mjs, lib/activity-digest.mjs). Test with an interrupted-turn fixture.
5. Check whether OAR bounds `session.dispose()`/ACP close; if not, add a bounded close in daemon/sessions.mjs with a test.
6. If docs/research/2026-11-25-aggregators.md exists by then, also take its top items that the Super marked (see that doc's final section); otherwise skip.
npm test green; RESULT.md Chinese, `STATUS: done`. Red lines as before.
