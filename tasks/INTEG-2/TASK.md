# INTEG-2 — second integration onto main (b5338fe4 or newer)
New worktree /Users/sun/Code/repos/loom-integ2, branch integ/main-2 from main. Commit each card in its own worktree first (Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>), then merge:
1. ROT-SELF-2 — /Users/sun/Code/repos/loom-rotself2 (infra/rot-self-2).
2. SKILL-VERIFY-1 — /Users/sun/Code/repos/loom-verify (infra/skill-verify). Reviewer was already retired in INTEG-1; reconcile.
3. WORKER-TIER-1 — /Users/sun/Code/repos/loom-tier (infra/worker-tier); its host grants must use SOCK-AUTH (now on main).
Resolve conflicts keeping every card's behaviour and tests; npm test twice (fail 0/cancelled 0), git diff --check, hot-upgrade rehearsal on a fixture project; list conflicts and resolutions. Don't push, don't move main. RESULT.md Chinese, STATUS: done.
