# HOTSWAP-4 — headless holder (phase B, headless half), Codex app-server first

Base: main @ 22b96cca (your HOTSWAP-3). Design: tasks/HOTSWAP-2/RESULT.md §1 (session-host inventory) and §4.3. A loom project (pilot-2, /Users/sun/Code/loom-pilot2) is running on release 22b96cca in parallel; it works only in memory/ and related tests — do not touch that worktree or its sessions, and avoid editing memory/.

Goal: headless sessions survive both loomd upgrades (already true) and **host upgrades** with zero manual action.
1. Reuse the native holder for headless: pipe mode (stdin/stdout/stderr pipes, journal per stream from birth, absolute offsets, same-PID `execve` handoff, write CAS without the human-input guard). Only holder-owned facts in the holder (fds, child, signals, waitpid, exit, journal).
2. Loom-side transport adapter instead of waiting for an OAR API: for **Codex app-server** first, loomd owns the JSON-RPC framing over the holder's pipes; persist initialize-done, threadId, RPC request ids/correlation, turn state and read cursors so a new loomd replays the journal and resumes without re-sending initialize/thread start. Confirmed business requests keep their existing ids and native evidence; resend only with proof of zero bytes written and not accepted.
3. Keep OAR for other providers in this card (agy/OpenCode ACP, Claude stream-json stay on session-host v1/v2); list exactly what each would need next (one paragraph each).
4. Coexistence/rollback rules as in HOTSWAP-3; release digest covers everything.

Acceptance: npm test green (302+); unit tests for RPC replay/correlation, partial-write and gap handling; live matrix for Codex app-server headless × idle/busy × (loomd upgrade, holder handoff, rollback) = 6 cells with the same assertions as HOTSWAP-3 (threadId, CLI PID, exactly-once native confirmations, zero manual action), local mock endpoint, isolated HOME, absolute binary. RESULT.md Chinese, `STATUS: done`, uncommitted for Super review.
Red lines as all prior cards.
