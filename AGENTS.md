# Loom engineering contract (evo branch)

This guide applies to the `evo` branch of Loom (repository `rah_os`), not the
legacy sibling `rah` repository. There is no `HANDOVER.md`. Do not import the
legacy project's Session-first rules or obsolete roadmap restrictions.

- `main` is the frozen UI milestone (tag `milestone-ui-raft`) and accepts
  emergency fixes only.
- `evo` is the backend rebuild. Its frontend product code (`apps/web/src`,
  `packages/ui-web`, `packages/ui-tokens/specs`) stays identical to `main` until
  phase 4; test files may differ only where `main` is corrected first.
  Acceptance uses the throwaway `apps/console` (served by the local gateway at
  `/_rah/console/`) plus API and tests. The console shows channels, instance
  state and queueing, usage, runtime settings, RunAttempt drill-down, the
  private box and the channel-memory panel, and performs Human interventions
  through the same client contract (unknown-result writes are verified or
  abandoned, never silently resent). It is deleted in phase 4 together with
  `scripts/run-console-browser-gate.mjs`, the gateway `consoleDirectory` branch
  and the `build:console`/`test:console:*` scripts; the full list is the
  "phase 4 删除清单" in `docs/evo/status.zh-CN.md`.
- `docs/evo/target-contract.zh-CN.md` is the single target contract and takes
  precedence; `docs/evo/status.zh-CN.md` records the evo-vs-main delta; code
  proves current behavior but never overrides owner goals or safety
  constraints. Owner documents in `docs/architecture` and `docs/product`
  describe the `main` baseline and are superseded where they conflict with the
  evo documents.

## Reading map

- Target contract: `docs/evo/target-contract.zh-CN.md`; current evo state,
  contract deviations and open items: `docs/evo/status.zh-CN.md`; paid and
  real-CLI runs: `docs/evo/paid-runs.zh-CN.md`; construction history (sections
  1–65, cited as "status §N"): `docs/evo/log/status-history-2026-09.zh-CN.md`;
  efficiency gate: `docs/design/cli-efficiency-gate.zh-CN.md`.

Main-baseline references (valid unless superseded by the evo documents):

- Product/ownership: `docs/architecture/room-first-core.zh-CN.md`,
  `docs/architecture/core-sdk-boundary.zh-CN.md`.
- Delivery/execution: `docs/architecture/delivery-and-activation.zh-CN.md`,
  `docs/architecture/runtime-adapter-and-observation.zh-CN.md`.
- Client/deployment: `docs/architecture/client-daemon-and-deployment.zh-CN.md`,
  `docs/architecture/frontend-platform.zh-CN.md`.
- UI integration: `docs/architecture/raft-ui-product-integration.zh-CN.md`,
  `docs/product/raft-frontend-local-contract.zh-CN.md`.
- UI library: `docs/design/neo-brutalist-ui.md` and
  `docs/adr/0028-owned-neo-brutalist-ui-library.md`.
- Upstream reuse history: `docs/audits/2026-08-29-raft-multica-reuse-ledger.zh-CN.md`.
- Memory (current isolated baseline): `docs/product/agent-memory-raft-baseline.zh-CN.md`.
- Task intent/ownership: `docs/adr/0020-task-intent-single-owner-and-secondary-roles.md`.

Dated audits specify evidence and limits at that revision, not current
completion. Resolve contradictions against code and recent evidence explicitly.

## Product boundary

Scope is one Human with multiple instances on the local Mac. Multi-Human
features and nonmember public-Channel parity are a future optional project, not
blockers (`docs/product/single-human-mainline-and-multi-human-backlog.zh-CN.md`).
Preserve authentication, membership/execution fences and memory isolation.

RAH-managed third-party MCP connection/catalog/assignment/call management is excluded by the user. Do not restore its Settings or Agent tabs, API, executor configuration or runtime proxy. Preserve provider-owned CLI tools and Room Worker communication; keep historical database compatibility. See `docs/product/managed-mcp-retirement.zh-CN.md`.

Loom is room-first. The durable Room ledger, Inbox, Task, Activation, Artifact, Review, and RunAttempt state are authoritative. Provider sessions, transcripts, JSONL, PTY screens, stdout, thinking, and tool streams are diagnostics only.

The permanent causal chain is:

```text
Room event -> Inbox item -> Activation -> AgentHost lease -> RunAttempt -> explicit Room action
```

WebSocket/SSE notifications are hints. They may be duplicated or lost. Reconnection must recover from durable state.

MCP and CLI are facades over the same application service. They are used after an agent is activated; an LLM tool-call loop must never own notification delivery or long-term waiting.

Loom is a local-first multi-Agent platform: single-Mac Core/daemon/runtime
first, secure LAN access, future direct remote-Computer extension; no Raft
central account, billing or relay. Local deployment keeps authentication, ACL,
causal barriers and execution fencing. Users install and authenticate their own
Codex/Claude/Kimi/OpenCode CLIs; Loom discovers, invokes and manages them but
never installs them or configures their accounts.

## Role / Instance / Session / Channel

- **Role** is configuration, not an entity: CLI + model + effort + prompt +
  skills, with a stable Role ID. Every save creates an immutable Revision.
  Editing a Role never changes existing instances; they show as out of date.
- **Instance** is a Channel member and principal (Instance ID) with a frozen
  Role Revision snapshot; one Role may have several instances per Channel. It
  may switch model/effort natively, never CLI. Removal stops delivery, safely
  ends execution and keeps history; re-adding creates a new instance.
- **Session** is the instance's native CLI session. Each instance has its own
  execution lane and one continuous session that is never silently replaced and
  never auto-rotated by task, turn count or tokens.
- **Channel** is the collaboration record and message box; its members are
  instances, not Roles. A Channel owns one platform-created home directory (the
  CLI cwd and default artifact directory of its instances, private box
  included) plus optional Human-attached directories, both fixed at creation
  (owner approved 2026-09-26). Platform memory is shared per Channel and never
  materialized as instance or Channel files (contract §4, "Memory boundary").
  Channels created before the home directory keep their instances' private cwds.

Instances run in parallel; each has one serial lane. A Channel `@instance` is a
public directed request; when a Human message's canonical @ names enabled
instance members, only those are woken (message-level set; no such @
broadcasts; `@all`/`@所有人` broadcasts for Human and instance authors alike), and a woken instance reads the delta for channel posts, followed threads and
explicitly delivered targets, using independent target positions (contract §3,
owner ruling 2026-10-02). Unfollowed Task bodies are not automatic catch-up;
explicit history reads retain Channel membership permissions. The private box shares the instance session (so it
affects later context), queues while busy, never steers Channel work and is
invisible to other instances. Only Human messages steer; other instances'
replies are read when idle. The legacy persona-Agent path is being removed from
the evo backend; old data is not migrated. A new data home seeds no persona
Agent, and every Kernel unconditionally creates no Inbox item or Activation
for a persona Agent (an Agent definition that is not a Role instance). Phase-4
close-out removed `POST /v3/client/agents/provision`, its SDK operation and the
optional scheduling switch; low-level historical provisioning and the protocol
configuration schema remain for compatibility and Role creation.

Loom builds only the Channel foundation, never scenario-specific features: users
reach discussion, collaborative development, planned tasks and similar goals by
talking with instances in a Channel (owner ruling 2026-09-26). Do not add
per-scenario workflows, roles, prompts or endpoints.

The remote-Computer mechanism (Computer protocol, k-carrier, remote AgentHost
control, release/upgrade) is frozen and kept, not deleted (owner ruling
2026-09-27): it is the planned basis for OAuth account-pool load balancing and
single-machine multi-container deployments of several CLI subscriptions. It is
outside current review scope; do not extend or remove it.

## Vertical MVP first

Build the smallest usable end-to-end business flow before broadening
subsystems. Each slice is a complete working path; do not complete identity,
lifecycle, memory, provider and UI layers horizontally first. Record rare edge
cases explicitly with triggers and limitations and defer them; do not build
disabled APIs or large frameworks in anticipation. Authentication,
channel/instance isolation, idempotency and preservation of existing data remain
necessary MVP behavior. Tests establish the vertical workflow and critical
invariants, not hypothetical completeness.

Phase-3 slice order (contract §8): S1 per-turn efficiency -> S2 session
lifecycle plus usage/context/compaction visibility -> S3 private box gaps -> S4
fork -> S5 side -> S6 platform memory. The owner approved implementing S6
before S4/S5; the owner has now authorized a narrow phase-4 UI slice after close-out
acceptance (2026-10-02); S4/S5 remain deferred. Keep the console until its
working capabilities have product UI replacements (contract §8). Each slice: tests first, implementation, visible in the console,
commit and push to `evo`. After S1, measure against contract §6; if far from
target, stop and re-evaluate the architecture.

## TDD is mandatory

For every behavior change:

1. Add or change a test that describes the externally observable invariant.
2. Run it and confirm the intended failure.
3. Add the smallest implementation that makes it pass.
4. Refactor only while the complete suite stays green.

Bug fixes require a reproducing test. Do not weaken assertions to accept the implementation.
Unit and integration tests use fake clocks, temporary databases, and fake runtime adapters. Real paid CLIs are opt-in release gates, never the default test suite. Gates use only the approved models below.

### Authorized paid CLI gate models

The owner authorized exactly these combinations for the opt-in real-CLI gates
(efficiency and drift). `scripts/cli-efficiency/approved-models.mjs` is the
single machine-checked copy: both gates refuse any other combination at
configuration time, before any provider process starts, and every guard then
asserts the exact catalog binding id and reasoning level and fails rather than
silently substituting another model. Change the table and that module together,
and only with owner approval.

| CLI         | Model binding id               | Reasoning | Approved   |
| ----------- | ------------------------------ | --------- | ---------- |
| Claude Code | `sonnet`                       | `low`     | 2026-09-09 |
| Claude Code | `haiku`                        | none      | 2026-09-25 |
| Codex       | `gpt-5.6-luna`                 | `low`     | 2026-09-09 |
| Codex       | `gpt-6-luna`                   | `low`     | 2026-09-25 |
| Codex       | `gpt-6-sol`                    | `low`     | 2026-10-03 |
| Codex       | `gpt-6-astra`                  | `low`     | 2026-10-03 |
| OpenCode    | `deepseek/deepseek-v4-flash`   | `low`     | 2026-09-09 |
| OpenCode    | `deepseek/deepseek-flash`      | `low`     | 2026-09-25 |
| OpenCode    | `aihubmix/deepseek-v4.1-flash` | `low`     | 2026-09-30 |
| Kimi CLI    | `kimi-code/k3`                 | `high`    | 2026-09-09 |
| Kimi CLI    | `kimi-code/k3-256k`            | `low`     | 2026-09-25 |

The 2026-10-03 additions are owner-approved for the Loom advantage discussion test.

Binding ids are the ones the installed CLIs actually publish (verified with
`probeLocalModelCatalog`); do not invent version-suffixed ids. The Claude Code
catalog publishes unversioned `sonnet` and `haiku` bindings, so the concrete
release is whatever that install resolves; `haiku` publishes no effort levels
and runs with none. The installed OpenCode catalog no longer publishes
`deepseek/deepseek-v4-flash`; `deepseek/deepseek-flash` (DeepSeek V4.1 Flash)
replaces it, and the old row stays approved but fails the catalog check before
any paid call. Never run Fable, GPT-5.6 Ultra or any `max`/`ultra` level in a
gate.

This authorization covers the model matrix for gates only; each paid run batch
still needs explicit owner authorization. Commit/push rules are in "Verification
and evidence".

## Ownership rules

- `packages/protocol` owns public commands, events, schemas, identities, and validation.
- `packages/kernel` owns transactions, projections, Room sequencing, Inbox, Activation, cursors, leases, and Outbox.
- `packages/agent-host` owns runtime discovery, start/resume/cancel/reap, process groups, heartbeat, and orphan cleanup.
- `packages/core` composes the headless Core; `packages/daemon` composes startup,
  shutdown and local services, without duplicating domain handlers.
- `packages/application-service` and `packages/client-sdk` expose authenticated,
  typed facades; `packages/client-core` owns ordered client reconciliation,
  causal command barriers and bounded in-memory projections.
- `packages/ui-tokens` owns maintained Neo-Brutalist visual sources; `packages/ui-web` and
  `apps/web` own shared presentation and route composition, not Provider parsing.
- `packages/raft-ui-snapshot` is frozen reference evidence, not a generator input
  or production app dependency. Build, runtime and maintenance must not require
  a sibling `raft-ui` working tree.
- UI, the console and transports consume these owners; they do not recreate business state.
- Shared Web UI remains browser-safe. Desktop IPC/native bridges implement the same client contract and never create a second command handler.
- Room Kernel service and AgentHost daemon remain logically independent from every window or renderer lifecycle, even when packaged together.

Before adding state or behavior, name its single owner. Do not create a second queue, cursor, or task state in an adapter or client.

## Non-negotiable invariants

- Every accepted mutation atomically updates its projection, appends one Room event, and records any Outbox work.
- Room sequence numbers are monotonic within a Room.
- Actor identity comes from authenticated context, never an arbitrary tool argument.
- Idempotency keys prevent duplicate events and all derived Inbox/Activation effects.
- Business mutations carry `basedOnRoomSeq`; relevant newer facts trigger a stale-context hold instead of a silent stale write.
- A wake hint, process spawn, PTY write, RPC response, or exit code never proves that an agent read or completed work.
- Completing an Activation requires the assigned runtime consumer to acknowledge Room delivery through that Activation's `toSeq`; it still does not acknowledge Inbox or complete a Task. A never-started duplicate message notification may instead be cancelled with exact same-instance/Room/session-generation consumption proof from a successfully completed Run; this is not a synthetic completion or ACK. See `docs/evo/read-covered-activation-plan.zh-CN.md`.
- One Instance (participant) has at most one active execution lane. New events while busy produce or extend durable follow-up work.
- Task completion is explicit and independent from RunAttempt termination.
- RunAttempt records actual runtime execution and exit provenance; retrying or completing an Activation never rewrites a finished RunAttempt.
- Provider session IDs are opaque metadata and never reconstruct Room history.
- Provider adapters and runtime plugins may emit diagnostics, but must not own or infer business status, Task transitions, Inbox acknowledgement, or durable memory promotion.
- Private file memory is distinct from canonical Room history; a provider
  transcript or model summary never automatically becomes either one.
- Unknown provider output stays diagnostic; do not expand the canonical protocol merely to mirror it.

Task is explicit durable work, not a prerequisite for tools or code changes.
A Channel's Human-managed `allowInstanceTaskCreation` defaults to false:
instances suggest work in ordinary messages and Human creates/converts Tasks.
When enabled, instances may autonomously create/convert Tasks; this accepts
misclassification risk and does not expand work authorization. Existing open
Tasks may always be claimed under the usual single-owner and execution fences.
There is no proposal queue or semantic authorizer. Preserve existing Tasks and
exact successful idempotent replays when the switch changes. CLI exit or a
collaborator reply does not complete a Task. See target contract §3a.

## Native-CLI benchmark

The native CLI running the same session, model and effort is the efficiency
baseline. The budgets and their measurement rules live only in contract §6;
do not restate the numbers elsewhere. Per-turn usage, context-window occupancy
and compaction count are shown per instance; data a CLI does not provide is
shown as unknown, never estimated.

Raft source is reference only, not the default port source; keep the verified
ledger, authentication, idempotency and execution-fence foundations. Rules code
can enforce must not live in prompts; exception guidance appears only on error.
Never regress a verified safety property to match upstream behavior.

When upstream code is actually copied or structurally ported, record upstream
version/URL/hash, source location, license/provenance, adopted behavior, local
changes and tests. Distinguish byte-exact reuse, structural port, local glue and
unfinished work. Do not label a rewrite as copied source. Preserve upstream
notices. Legacy `rah` code is not a default dependency.

## UI and interaction contract

This section applies to `main`'s frozen frontend and to phase-4 integration.
evo does not change `apps/web` before phase 4.

Visual and functional parity are separate obligations. The behavior guide uses
`official trigger -> source component/parameters -> content/data source ->
close/keyboard/focus -> local frontend/backend owner -> bilateral result`. Each behavior needs a stable identity, source revision/location, conditions,
success/loading/empty/error/disabled states, async/stale-response rules and
explicit implementation/test status. An `onClick` count is not a function count;
neither an old reference fixture nor a visible tab proves product completeness.

- Extract CSS, icons, fonts, avatars and state parameters from authorized source
  evidence. Use the maintained internal tokens; label unavoidable approximations, never guess
  screenshot dimensions and call them extracted specifications.
- Agent choice-row colors follow component family and hover/current/selected states,
  not modal versus base-page placement. Follow the [UI color contract](docs/design/neo-brutalist-ui.md#agent-choice-row-colors):
  Raft's opaque soft-signal maps to local --yellow; local --soft-signal already has
  30% alpha. Do not add modal-wide hover overrides or apply opacity twice.
  New Agent choice surfaces must select the shared member-selection, member-browse,
  property-option or autocomplete profile; use ui-web ChoiceRow. check:ui-library
  rejects local row palette overrides and test:ui:choice verifies computed states.
- Web/PWA share components, intents and protocol. Responsive layout changes must
  not create a second business path. Native shells remain thin clients.
- Shell borders, splitters, overlay/focus and message measurement each have one
  owner; reconciliation preserves message identity, anchors, drafts, disclosure.
- Use shared tooltip/preview/popover/dialog/drawer primitives; verify hover,
  pointer exit, click, Escape, outside press, keyboard focus and focus return.
- Chat Agent name click inserts an `@` into the active composer; avatar hover
  shows a summary; avatar click opens the right inspector on Activity by default.
- Room/DM/Thread Enter sends, Shift+Enter inserts a newline, IME confirmation
  never sends. Pending/disabled/permission checks apply equally to keyboard and
  button submission. Do not impose this rule on unrelated form editors.
- Navigation unread dots, Computer connectivity, live presence and diagnostic
  event colors are different projections. Do not derive online state from PATH
  discovery or fabricate activity from chat text. Diagnostic tools/output remain
  separate from explicit Room messages.
- File browsing is authorized and root-scoped on AgentHost. A local browser/LAN
  client does not get arbitrary host filesystem access. A path is not a
  published Artifact, and listing a file does not prove attachment access.
- Long chat uses bounded pages, stable Message IDs and the existing virtual
  window/anchor owner. Do not load full history or persist transcripts in browser
  storage to disguise latency. API/business state is not a PWA shell cache.
- Missing backend capabilities stay explicitly unavailable with accurate labels;
  never connect an enabled production button to fixture success.

## Memory boundary

Target and decided semantics: contract §4 (owner-approved 2026-09-26/27).
Platform-managed long-term memory whose lifecycle is independent of instances
and sessions; Role/model/session/Channel/time are automatic provenance
metadata. Provenance proves authorship, not correctness.

Current S6 state (status table, history §48–§54 and §63): Role instances use
Kernel channel memory. Scope is the Channel; entries written from an instance's
private box also belong to the Channel's shared memory, not private memory.
Writes happen only through explicit Worker tools (`memory write/update`); the
platform never extracts memory from conversations or transcripts and never
materializes it as files. Mutations return receipts only; bodies,
descriptions and provenance come only through reads gated by the read switch.
Update/invalidate/restore/delete carry `expectedRevision`; instances and the
Human may invalidate/restore, only the Human (channel manager) deletes, and
deletion clears bodies, descriptions and earlier reasons from online reads but
does not scrub provider sessions, diagnostics, backups or SQLite residue. Read
and write switches default per Channel with per-member overrides, enforced by
the Kernel on the authenticated Worker path. New sessions receive a light index
(3 KiB, pinned first) plus per-turn deltas; bodies are read on demand. Side
sessions are read-only by design, but side credentials are not issued yet (S5).

The per-instance `MEMORY.md` plus `notes/` is no longer loaded or materialized
for Role instances; old directories stay read-only and can be imported only by
an explicit Human `memory.import.legacy`. That path remains only for the legacy
persona Agent, which is being removed; do not extend it. Not strong isolation:
CLIs run full-access under the same UID and could read the database directly.
Turning reading off does not recall an index already delivered into a session.
A materialization or delivery receipt proves transport, not that a model read
it. Prompt-only requests cannot be advertised as enforced isolation.
Reset/restart honors the existing fence and active-work checks.

## Verification and evidence

Design/compare first, then TDD. Preserve existing user changes; do not widen
source-size ratchets merely to add code. Follow
`docs/architecture/core-module-boundaries.zh-CN.md` where it still applies.

Separate these claims in reports: code implemented; automated checks passed;
console/API verification passed; real CLI work passed; efficiency gate met
budgets; local service deployment verified. None implies the next.

Use temporary state, ports and fake providers for deterministic tests; label
fixture URLs and Fake CLI replies unmistakably and never hand one to the user as
the product. Real-provider acceptance is opt-in, narrowly scoped and records
actual model/effort/results. Never use GPT-5.6 Ultra for tests.

Run the opt-in efficiency gate (`docs/design/cli-efficiency-gate.zh-CN.md`) at
the end of S1, S2 and S6 and after meaningful scheduling, prompt/context,
memory-transport or provider-session batches before accepting performance.
Failures and excess costs stay visible; successful replies alone are not
efficiency acceptance.

Before a code handoff run:

```bash
npm run check
npm run format:check
git diff --check
```

If `main`'s frontend is touched (emergency fix or phase 4), also run
`npm run build:web:workbench` and the relevant browser gates (same measured
viewport/DPR/zoom plus 390x844; real pointer hit targets). Never claim an unrun
gate passed. Documentation-only edits need link, format and diff checks only.

Do not commit, push, publish, or run paid-provider tests unless the user
explicitly requests it. Exception: the owner has authorized the lead agent to
commit and push completed evo slices to `evo` routinely. Paid gates still need
explicit authorization per run batch.

## User-requested repair handoff

Every completed repair batch includes a restart of the evo local service
(launchd label `com.loom.evo`, with its own data home) before handoff; the old
formal workbench is retired. After required checks, inspect active work, back up
persistent state, gracefully stop the exact service instance and start it
against the verified build. Verify the new process and a fresh real page; health
alone is not acceptance. Keep Room history, Role/instance configuration and
private memory intact. If active work cannot be safely drained, report that
blocker instead of force-killing it. Never substitute a Fake CLI fixture for the
user-review URL. Data homes are path-bound (mount receipts store absolute
paths): never relocate one. The daemon instance lock at
`/tmp/rah-os-daemon-<uid>` is shared, so two daemons with the same hostId cannot
run. This instruction does not authorize paid-provider tests.

## Documentation and handoff

Write back documentation only when it changes (owner ruling 2026-09-27): when
a capability's state changes, rewrite the affected rows of the status table
(implemented / fake-verified / real-CLI / paid-gate verdict / uncovered, with
evidence links); after a restart, update the current-deployment line; after a
paid or real-CLI run, append it to `docs/evo/paid-runs.zh-CN.md`. Batches that
change none of these need no status or ledger edit. Change the target contract
only with owner approval. The status page stays a current-state page; do not
append history sections to it. Update owner documents/ADRs
together with changes to protocol, lifecycle, authority, memory policy,
deployment or release gates. Keep this guide durable: no live PIDs, private
credentials, signed attachment URLs, temporary ports or volatile pass counts.

Never announce a completion percentage from source callback counts; coverage
needs a deduplicated inventory with per-row evidence. Report frontend, backend
and verification gaps separately. Verify commit, push, deployment and restart
claims at handoff; a local commit does not mean pushed or deployed.
