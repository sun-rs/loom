# MERGE-PILOT-1 — bring pilot-1 into main (user approved 2026-11-25)

Source: /Users/sun/Code/loom-pilot branch `pilot-1` @ 2bf357d3 (base 1f529eca; 3 cards approved by the pilot Auditor: PILOT-MEMORY-0, PILOT-POLICY-1, PILOT-OPENCODE-TUI-1). Target: main in /Users/sun/Code/repos/loom_new (currently 5707c762 + FIX-5 8f4ef4e5; has PILOT-FIX-1..5 and MEMORY-1 docs).
Known conflicts: daemon/tui.mjs, skills/loom/SKILL.md.

Do:
1. In a throwaway worktree of loom_new (under /Users/sun/Code/exp-relay/merge-pilot-1/), fetch pilot-1 from the pilot repo path and merge into a branch `merge/pilot-1` off main. Resolve conflicts keeping BOTH intents: main's FIX-1..5 behaviour (trust, overlays, draft verifier, LOOM_BIN contract, worker env) and pilot's memory/policy/OpenCode changes. SKILL.md: keep main's `$LOOM_BIN` absolute-path contract; add pilot's memory entry rules but mark the storage location `.project/memory/` as "v0, import source for v1 (docs/MEMORY.md)".
2. Do NOT implement memory v1. Add one line to docs/MEMORY.md §6 only if needed to say v0 now lives in main.
3. Leftovers to record (in tasks/MERGE-PILOT-1/RESULT.md, not new code): OpenCode interrupt unsupported at loom layer; production openTui-with-effort path for OpenCode untested; memory v0 never used in a live session; examples/policy.json now lists two vendors per role.
4. Acceptance: full `npm test` green on the merge branch (count before/after), `git diff main...merge/pilot-1 --stat`, and a short conflict-resolution note per file. Leave the branch un-merged into main; Super reviews and merges.
Red lines as before (no credentials, no CCP/Solars/loom-next; pilot repo read-only).
RESULT.md Chinese, `STATUS: done`.
