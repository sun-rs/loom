# INTEG-1 — integrate finished infra branches into main

Super has reviewed the RESULT.md of each card below; integrate them into one branch `integ/main-1` (new worktree /Users/sun/Code/repos/loom-integ1 from main), resolving conflicts by keeping every card's behaviour and tests:
1. HARDEN-PS-1 — uncommitted in the shared main tree /Users/sun/Code/repos/loom_new (t3b9's work). First commit it there on a branch: create branch `infra/harden-ps` from main in a separate worktree and copy exactly the files listed by `git -C /Users/sun/Code/repos/loom_new status --short` (excluding other tasks' untracked dirs), so the main tree ends clean. Then merge.
2. `ui/status-tui-2` (TUI-STATUS-2 v1 + TUI-STATUS-3 v2, committed).
3. `infra/rot-tune` (ROT-TUNE-1; uncommitted in /Users/sun/Code/repos/loom-rot-tune — commit there first).
4. `infra/worker-reap` (WORKER-REAP-1; uncommitted in /Users/sun/Code/repos/loom-reap — commit there first).
5. `infra/sock-auth` (SOCK-AUTH-1 incl. legacy peer-pid addendum; uncommitted in /Users/sun/Code/repos/loom-sock-auth — commit there first). Remove the reviewer rows/paths if SKILL-VERIFY-1 hasn't (note it; don't block).
Then: `npm test` twice on the merged HEAD (fail 0 / cancelled 0), `git diff --check`, a hot-upgrade rehearsal on a throwaway fixture project with live sessions (SOCK-AUTH legacy sessions keep rights; WORKER-REAP timers survive; Status TUI reconnects), and list every conflict and how it was resolved. Commit messages per card with "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>". Do NOT push and do NOT touch main's ref; Super fast-forwards main. RESULT.md in tasks/INTEG-1/, Chinese, STATUS: done.
