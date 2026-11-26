# HOOK-CWD-1 (urgent, pilot-2 stalled) — Claude hook events dropped after the role `cd`s; Stop never seen

LIVE: pilot-2 Auditor loom-d173a83a (pane t3fw, never type into it) shows `stuck`; gate packet delivery d8f90c12 stalled `waiting-writable` > 20 min (DELIVERY-SLA-1 caught it).

Root cause (verified read-only):
- runtimes/tui/capture-hook.mjs:16 keeps an event only if `payload.cwd === cwd` (launch cwd).
- In its turn at 2026-11-26T03:44Z the Auditor ran Bash `cd .project`. Claude's hook payload cwd became `/Users/sun/Code/loom-pilot2/.project`, so PostToolUse and Stop were silently dropped. The transcript has the assistant reply, `system stop_hook_summary` (hook ran, no error, 88 ms) and `system turn_duration`. The events file ends at PreToolUse 1795664655084.
- The hook command is pinned to the launch release (`~/.loom-cell/releases/52219963/runtimes/tui/capture-hook.mjs`), so hot-upgrading loomd cannot fix a running session's hook.

Base: main @ 36b40f46. Do not commit.
1. **Filter by identity, not cwd.** Accept events whose `session_id` matches the bound session (and that are not a subagent via `agent_id`). Never filter on cwd; record cwd as data. Same audit for agy/Codex/OpenCode capture paths.
2. **Hot-fixable hook path.** New launches point the hook at a stable shim (e.g. `~/.loom-cell/hooks/capture-hook.mjs` or `<project>/.project/loomd/hook.mjs`). The shim delegates to the current release and keeps its argument/protocol contract across versions, so an upgrade fixes hook capture for live sessions. Document it in docs/HOTSWAP or PROTOCOL.
3. **Native turn-end fallback in loomd (this is what rescues the live session after a hot deploy).** For Claude TUI, when the hook stream lacks Stop but the bound transcript shows the turn closed (assistant final + `stop_hook_summary`/`turn_duration` after the last user prompt, with no pending tool_use and no running background task per HIST-FIX-1), treat it as a turn end with `source: transcript`. Also mark the session `hook-gap` in status so it is visible.
   - The live d173a83a must become idle by itself after deploy, and d8f90c12 must then deliver.
   - Similar transcript fallback for agy if its hooks can be dropped the same way.
4. Regression fixtures from this transcript tail and events file (read-only copies).
Tell me with a short line as soon as item 3 is green so I can hot-deploy; then finish 1, 2 and 4. Pause PROMPT-STATE-1 meanwhile (keep its WIP; don't mix commits — list which files belong to which card in RESULT.md).
npm test green; RESULT.md Chinese, `STATUS: done`. Red lines as before.
