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

**Addendum 2 — Super's design (supersedes the "Leader must call release after every result" part of Addendum 1):**
Rationale: (a) an idle headless worker costs memory (~300 MB) but zero tokens; (b) once the provider's prompt cache has expired, reviving costs one cold full-context request — the same as if it had been offline — so keeping a session online past the cache window buys only a few seconds of startup; (c) every explicit `release` call is a tool call in the senior role's context, which R19/R21 tell us to minimise.
1. **States**: working · idle-warm (online, countdown) · offline (process released, resumable) · closed (its wave's merge gate approved or card cancelled; not offered for revive by default; hist/evidence kept).
2. **loomd does the routine mechanically**: idle-warm TTL = the CLI/provider cache window, configurable per CLI (`workers.warmMs.<cli>`, default 10 min); then offline. On merge-gate APPROVE for a wave → close its sessions. No Leader call needed in the normal path.
3. **Leader expresses intent through actions it already takes**: `spawn … --keep-warm` when it already knows a follow-up is coming (e.g. "write tests, then I'll send the impl"); for a fix after REJECT it chooses **revive** (`assign --resume-attempt <task>`) or **new** (`spawn`). Explicit `loom release` stays available as an override, never required.
4. **Skill rule for new vs revive** (put in the loom skill, Leader section, ≤8 lines): revive when the fix is in the same files/scope and the worker's context is < 60% and the gate round is recent; start new when the worker's context is large, the defect came from that worker's own reasoning (fresh eyes), or the scope changed. State the choice and reason in the dispatch receipt (one line).
5. Status/Leader digest shows per worker: state, warm countdown, context %, last result tag — so the Leader decides from data it already receives (no polling).
6. Metrics per gate: revives vs new spawns, cold-revive token cost, sessions closed/offlined by TTL.

**Addendum 3 — worker lifespan (user 2026-11-26):** "不能一个任务就废弃，也不能压缩 n 次还在用". Lifespan is measured by context, not by task count:
- A worker may be reused (kept warm or revived) for follow-up or closely related cards in the same area while its context is < 50% of the model window and it has had **zero compactions**.
- At ≥ 50% context, or after its first compaction, it finishes the current card and is then retired (closed, not offered for revive); further work in that area goes to a new worker with a short brief plus the relevant memory entries (cheaper than re-injecting a bloated context).
- loomd computes and shows per worker: context %, compactions, "reusable / retire after this card"; the Leader's new-vs-revive rule (Addendum 2 §4) uses these thresholds (configurable `workers.reuseMaxContext`, default 0.5; `workers.reuseMaxCompactions`, default 0).
- Metric per gate: reuses, retirements by threshold, average context at retirement.

**Addendum 4 — corrects Addendum 3 (user: thresholds too aggressive; switching workers mid-task is worse than a big context):**
- **Never replace a worker mid-card because of context or compaction.** A card runs to completion in the same worker however many compactions it takes; only failure/stuck/quota justify a mid-card switch.
- Thresholds apply only to **reuse for the next card**: reusable while context < 70% of the window and ≤ 1 compaction so far and the next card is in the same area; otherwise retire at card end. Defaults `workers.reuseMaxContext=0.7`, `workers.reuseMaxCompactions=1`, configurable; record the metrics so we can tune from data (e.g. fix-after-REJECT success with revived vs new worker).

**Addendum 5 — final lifespan rule (supersedes Addenda 3–4 thresholds), from veterans' answers + pilot data: see docs/research/2026-11-26-worker-lifespan.md "结论" items 1–7.** Implement items 1–6 as loomd data + Leader skill text (≤10 lines) + new-worker first-report check (branch, base SHA, WIP lines, active rulings verified against loomd; mismatch → stop and report). Defaults: cross-card reuse ≤50% used and 0 compactions; mid-card handoff at 2nd compaction or <15% remaining via a handoff sheet; all configurable.
