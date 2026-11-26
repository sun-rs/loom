# WORKER-REAP-1 — release finished worker sessions automatically (memory)

User 2026-11-26: 24 idle workers in pilot-2, "废弃的按理说应该释放掉，否则太占内存". Measured: 57 pilot-2 processes ≈ 7.8 GB RSS; after Super stopped 23 finished workers, 15 processes ≈ 1.5 GB.
1. loomd releases a headless worker's process once its card has a delivered final result AND it has been idle for `workers.idleRetainMs` (default 10 min), unless the Leader marked it `keep` (expected follow-up) or a continuation is queued. Released = process stopped; native session id, transcript, hist, worktree and evidence kept; `loom assign --resume-attempt` (or send to that task) revives it by native resume transparently.
2. Never release while busy, while a delivery to/from it is pending, or while its result is undelivered (DELIVERY-SLA-1).
3. Same for temporary reviewers (end after verdict delivered) and failed successors.
4. Status shows retained vs released and the countdown; `loom status --json` exposes it; memory per project (sum RSS of the session tree) shown in Status/Cost.
5. Skill: Leader may `loom keep <task>` when it expects to send follow-ups; otherwise nothing to do.
Tests: release after TTL, revive via resume for codex/agy/claude headless (fixtures + one real codex), no release while pending/busy, hot upgrade preserves timers. Worktree /Users/sun/Code/repos/loom-reap (branch infra/worker-reap from main). RESULT.md Chinese, STATUS: done, uncommitted.

**Addendum (user, 2026-11-26):** "一定不要长期维持太多的 session 在线…长时间不给指令就自动下线，但是保留 resume 回来的能力；leader 应该有责任去主动释放，他可以通过 status 知道哪些 worker 是 idle/working/offline，要么开新的，要么拉起旧的（假设这个任务需要过去的知识经验）。"
- Three explicit states everywhere (status JSON, `loom status`, Status TUI, Leader's view): **working**, **idle** (online, with release countdown), **offline** (released, resumable).
- **Leader duty** (skill + launch prompt): after reading a worker's final result, release it right away with `"$LOOM_BIN" release <task|addr>` unless a follow-up is planned; before dispatching new work, check status and decide: **new worker** (default, clean context, cheaper) or **revive an offline one** (`assign --resume-attempt` / send to its task) only when the job needs that worker's accumulated knowledge — and say which in the dispatch receipt.
- loomd's idle TTL is the safety net for when the Leader forgets; count Leader-released vs TTL-released per gate and show it, so we can see whether the Leader does its job.
- Revive must be cheap and reliable: native resume (codex/claude/agy/opencode session ids), same worktree, same card; verify with a real codex revive after release.
