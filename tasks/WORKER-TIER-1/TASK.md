# WORKER-TIER-1 — graded worker permissions, up to a Super-granted host tier

User 2026-11-26: "之前不是说过给 worker 权限分级吗？…应该很容易配置最高权限，就可以访问外面了". Today only two levels exist: the default sandbox and `spawn --integration` (GATE-NOTIFY-1: process listing + private tmp, no network/credential widening). pilot-cell's goal 1 is blocked because no worker can run a logged-in, read-only `loom accounts --refresh` (sandbox denies ~/.codex writes and Keychain).
Design and implement four tiers, per card:
- **T0 sandbox** (default): worktree + private tmp; model API only; no credential access.
- **T1 integration** (existing `--integration`): + own process tree listing, project-scoped resources.
- **T2 host**: the CLI runs without loom's/CLI's sandbox in the user's normal logged-in environment (real HOME, Keychain via the CLIs themselves), for probes and live verification. Still enforced: red-line hooks (no reads of credential files, no writes to global config, no PATH-resolved CLIs in tests, egress through allowed tools), full command log into the evidence card, time limit, auto-expiry at card end.
- **T3 full**: like T2 without the time limit and with write access outside the worktree when the card names the paths; for Super-approved maintenance only.
Grant model: Super grants (`loom grant <task|wave> <tier> --reason "<why>" [--ttl]`), or the charter/policy pre-authorises a tier for named waves (`roles.worker.tiers.<wave>`); the Leader can only request (needs-decision with the tier and reason) and spawn with a tier already granted; T3 never pre-authorised by policy. Status/TUI show elevated workers prominently; notices to Super on grant, use and expiry; evidence card lists every command run at T2/T3.
Map to each CLI's real sandbox switches (Codex sandbox modes/approval policy, agy Seatbelt/permission modes, Claude permission mode/sandbox settings, OpenCode) — launch-scoped only; record versions.
Tests per tier and CLI (fixtures), plus one real T2 Codex worker running a read-only logged-in probe. Worktree /Users/sun/Code/repos/loom-tier (branch infra/worker-tier from main). RESULT.md Chinese, STATUS: done, uncommitted.

**Super decision: three tiers, not four.** Merge T2 and T3 into one **host** tier: no sandbox, logged-in environment, red-line hooks, command log, auto-expiry at card end; extra write paths outside the worktree only when the grant names them (`loom grant <task> host --reason … [--write PATH]… [--ttl]`). Policy may pre-authorise `host` only for named waves and never with `--write`. Tiers: sandbox (default) · integration · host.
