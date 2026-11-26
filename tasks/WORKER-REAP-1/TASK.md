# WORKER-REAP-1 — release finished worker sessions automatically (memory)

User 2026-11-26: 24 idle workers in pilot-2, "废弃的按理说应该释放掉，否则太占内存". Measured: 57 pilot-2 processes ≈ 7.8 GB RSS; after Super stopped 23 finished workers, 15 processes ≈ 1.5 GB.
1. loomd releases a headless worker's process once its card has a delivered final result AND it has been idle for `workers.idleRetainMs` (default 10 min), unless the Leader marked it `keep` (expected follow-up) or a continuation is queued. Released = process stopped; native session id, transcript, hist, worktree and evidence kept; `loom assign --resume-attempt` (or send to that task) revives it by native resume transparently.
2. Never release while busy, while a delivery to/from it is pending, or while its result is undelivered (DELIVERY-SLA-1).
3. Same for temporary reviewers (end after verdict delivered) and failed successors.
4. Status shows retained vs released and the countdown; `loom status --json` exposes it; memory per project (sum RSS of the session tree) shown in Status/Cost.
5. Skill: Leader may `loom keep <task>` when it expects to send follow-ups; otherwise nothing to do.
Tests: release after TTL, revive via resume for codex/agy/claude headless (fixtures + one real codex), no release while pending/busy, hot upgrade preserves timers. Worktree /Users/sun/Code/repos/loom-reap (branch infra/worker-reap from main). RESULT.md Chinese, STATUS: done, uncommitted.
