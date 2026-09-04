# RAH OS engineering contract

This guide applies to `rah_os`, not the legacy sibling `rah` repository. Read
`README.md` and `docs/README.md`, then the owner documents relevant to the task.
There is no `HANDOVER.md` in this repository. Do not import the legacy project's
Session-first rules or obsolete roadmap restrictions as current requirements.

## Reading map

- Product/ownership: `docs/architecture/room-first-core.zh-CN.md`,
  `docs/architecture/core-sdk-boundary.zh-CN.md`.
- Delivery/execution: `docs/architecture/delivery-and-activation.zh-CN.md`,
  `docs/architecture/runtime-adapter-and-observation.zh-CN.md`.
- Client/deployment: `docs/architecture/client-daemon-and-deployment.zh-CN.md`,
  `docs/architecture/frontend-platform.zh-CN.md`.
- UI integration: `docs/architecture/raft-ui-product-integration.zh-CN.md`,
  `docs/product/raft-frontend-local-contract.zh-CN.md`.
- UI library: `docs/design/neo-brutalist-ui.md` and
  `docs/adr/0028-owned-neo-brutalist-ui-library.md` (current adoption policy).
- Upstream reuse: `docs/audits/2026-08-29-raft-multica-reuse-ledger.zh-CN.md`.
- Memory: `docs/product/agent-memory-raft-baseline.zh-CN.md`; follow the current
  policy-retraction and index-only rollout audits linked from `docs/README.md`.
- Task intent/ownership: `docs/adr/0020-task-intent-single-owner-and-secondary-roles.md`.

Architecture/ADRs specify invariants; dated audits specify evidence and limits
at that revision. Old implemented/missing lists are not current completion
reports. Resolve contradictions against code and recent evidence explicitly.

## Product boundary

RAH OS is room-first. The durable Room ledger, Inbox, Task, Activation, Artifact, Review, and RunAttempt state are authoritative. Provider sessions, transcripts, JSONL, PTY screens, stdout, thinking, and tool streams are diagnostics only.

The permanent causal chain is:

```text
Room event -> Inbox item -> Activation -> AgentHost lease -> RunAttempt -> explicit Room action
```

WebSocket/SSE notifications are hints. They may be duplicated or lost. Reconnection must recover from durable state.

MCP and CLI are facades over the same application service. They are used after an agent is activated; an LLM tool-call loop must never own notification delivery or long-term waiting.

The product is a local-first multi-Agent work platform: close the single-Mac
Core/daemon/runtime/Web/PWA workflow first, with secure LAN access and a future
direct remote-Computer extension. Raft's central account, billing and relay
topology are not requirements. Local deployment does not remove authentication,
ACL, causal barriers or execution fencing.

Users install and authenticate their own Codex/Claude/Kimi/OpenCode CLIs. RAH OS
discovers their existing capabilities, invokes them and manages execution; it
does not install provider CLIs or configure their accounts. Installing the RAH OS
Computer service is a separate concern.

An Agent is a durable Workspace-level identity, not a model or provider session.
Role instructions and private memory survive model/effort/runtime changes.
Room membership owns participation and delivery. DM open-or-create uses the
canonical direct-Room policy, not an invented client-only conversation. A Room
is not a filesystem project; runtime cwd and Agent memory home are separate.

## TDD is mandatory

For every behavior change:

1. Add or change a test that describes the externally observable invariant.
2. Run it and confirm the intended failure.
3. Add the smallest implementation that makes it pass.
4. Refactor only while the complete suite stays green.

Bug fixes require a reproducing test. Do not weaken assertions to accept the implementation.

Unit and integration tests use fake clocks, temporary databases, and fake runtime adapters. Real paid CLIs are opt-in release gates, never the default test suite. Claude gates use Sonnet unless the user explicitly approves another model.

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
  a sibling `raft-ui` working tree. Use the internal English library catalog.
- UI and transports consume these owners; they do not recreate business state.
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
- Completing an Activation requires the assigned runtime consumer to acknowledge Room delivery through that Activation's `toSeq`; it still does not acknowledge Inbox or complete a Task.
- One AgentParticipant has at most one active execution lane. New events while busy produce or extend durable follow-up work.
- Task completion is explicit and independent from RunAttempt termination.
- RunAttempt records actual runtime execution and exit provenance; retrying or completing an Activation never rewrites a finished RunAttempt.
- Provider session IDs are opaque metadata and never reconstruct Room history.
- Provider adapters and runtime plugins may emit diagnostics, but must not own or infer business status, Task transitions, Inbox acknowledgement, or durable memory promotion.
- Agent private file memory is distinct from canonical Room history; a provider
  transcript or model summary never automatically becomes either one.
- Unknown provider output stays diagnostic; do not expand the canonical protocol merely to mirror it.

## Raft-first reuse and product parity

Before implementing a gap, inspect the existing Raft source/behavior contract,
then Multica's concrete implementation. Prefer a source-backed port over a new
algorithm. Use another project only with a documented advantage in completeness,
reliability or integration cost. Legacy `rah` code is not a default dependency:
port a bounded invariant only with a named owner and a new test, never its
Session-centered state model.

Record upstream version/URL/hash, source location, license/provenance, adopted
behavior, local changes and tests. Distinguish byte-exact reuse, structural port,
RAH glue and unfinished work. Do not label a rewrite as copied source. Preserve
upstream notices. Raw published bundles stay analysis-only; extracted reusable
pieces enter the correct owner through explicit, versioned boundaries.

Do not regress a verified safety property merely to copy an upstream bug.
Explain and test intentional differences before changing the product contract.
No automatic rewrite of memory, CLI transport, scrolling or state machines when
an existing owner and mature implementation already cover the requirement.

## UI and interaction contract

Visual and functional parity are separate obligations. The behavior guide uses:

`official trigger -> source component/parameters -> content/data source ->
close/keyboard/focus -> local frontend/backend owner -> bilateral result`.

Each behavior needs a stable identity, source revision/location, conditions,
success/loading/empty/error/disabled states, async/stale-response rules and
explicit implementation/test status. An `onClick` count is not a function count;
neither an old reference fixture nor a visible tab proves product completeness.

- Extract CSS, icons, fonts, avatars and state parameters from authorized source
  evidence. Use the maintained internal tokens; label unavoidable approximations, never guess
  screenshot dimensions and call them extracted specifications.
- Web/PWA share components, intents and protocol. Responsive layout changes must
  not create a second business path. Native shells remain thin clients.
- Shell borders, splitters, overlay/focus behavior and message measurement each
  have one shared owner. Reconciliation must preserve stable message/media
  component identity, scroll anchors, drafts and disclosure state.
- Use shared tooltip/preview/popover/dialog/drawer primitives. Verify hover,
  pointer exit, click, Escape, outside press, keyboard focus and focus return;
  matching a static screenshot is insufficient.
- Chat Agent name click inserts an `@` into the active composer; avatar hover
  shows a summary; avatar click opens the right inspector on Activity by default.
- Room/DM/Thread Enter sends, Shift+Enter inserts a newline, IME confirmation
  never sends. Pending/disabled/permission checks apply equally to keyboard and
  button submission. Do not impose this rule on unrelated form editors.
- Navigation unread dots, Computer connectivity, Agent live presence and
  diagnostic event colors are different projections. Do not derive online state
  from PATH discovery or fabricate activity from chat text. Diagnostic tools/
  output remain separate from explicit Agent Room messages.
- File browsing is authorized and root-scoped on AgentHost. A local browser/LAN
  client does not get arbitrary host filesystem access. A path is not a
  published Artifact, and listing a file does not prove Agent attachment access.
- Long chat uses bounded pages, stable Message IDs and the existing virtual
  window/anchor owner. Do not load full history or persist transcripts in browser
  storage to disguise latency. API/business state is not a PWA shell cache.
- Missing backend capabilities stay explicitly unavailable with accurate labels;
  never connect an enabled production button to fixture success.

Task is explicit durable work, not a synonym for tool use. Human can mark a Task;
otherwise brief discussion/search/file reading must not automatically claim one.
Retain atomic single-winner ownership while allowing explicit helper/reviewer
roles. CLI exit or a collaborator reply does not complete the Task.

## Agent memory boundary

Keep the Raft baseline: one Agent-owned `MEMORY.md` small index plus organized
`notes/`, complete original-index reads, body reads on demand, Agent-authored
maintenance. Isolation between Agents is a requirement. Room, cwd, model and
effort do not create new memory owners; cwd is not a reliable project identity.

Do not add default text splitting, fragment stores, layered classification,
selection/truncation, extra memorization rules or full-note hashing on every
run. Do not silently re-enable custom idle maintenance. Enhancements require
upstream comparison, an explicit reversible option, failure/rollback tests and
real-model evidence before changing defaults. A materialization receipt proves
file preparation, not that a model read or remembered it. Prompt-only requests
cannot be advertised as enforced no-memory isolation. Reset/restart must honor
the existing per-Agent fence, active-work checks and recovery semantics.

## Verification and evidence

For behavioral changes, design/compare first, review the intended differences,
then follow TDD and real browser verification. Preserve existing user changes;
do not widen source-size ratchets merely to add code. Follow the owner-aligned
boundaries in `docs/architecture/core-module-boundaries.zh-CN.md`.

Separate these claims in reports: code implemented; automated checks passed;
isolated real browser passed; real CLI work passed; same-precondition Raft
bilateral comparison passed; formal deployment verified. None implies the next.

Browser checks prioritize desktop at the same measured viewport, DPR and zoom;
also test 390x844 for responsive changes. Inspect screenshots and real pointer
hit targets, not only DOM/programmatic clicks. Include reload, repeated polling,
late responses, denied permissions and failure recovery where relevant. If
official Computer is offline, mark nonempty file-tree comparison blocked; local
source-backed testing can proceed, but is not bilateral acceptance.

Use temporary state, workspaces, ports and fake providers for deterministic
tests. Label fixture URLs and Fake CLI replies unmistakably; never hand a
fixture URL to the user as the formal product. Real-provider acceptance is
opt-in, narrowly scoped and records actual model/effort/results. Never use
GPT-5.6 Ultra for tests; Claude defaults to Sonnet unless explicitly approved.

Before a code handoff run:

```bash
npm run check
npm run format:check
git diff --check
```

For Web changes also build the formal bundle with `npm run build:web:workbench`.
Select the relevant browser gates in `package.json` (business flow, long history,
persistent workbench, LAN or Firefox) and inspect their output. Never claim an
unrun gate passed. Documentation-only edits require link/evidence consistency,
format and diff checks; they do not require restarting an unchanged runtime.

Do not commit, push, publish, or run paid-provider tests unless the user explicitly requests it.

## User-requested repair handoff

The user has explicitly requested that every completed repair batch include a
restart of the formal local workbench before handoff. After required checks,
inspect active work, back up persistent state, gracefully stop the exact formal
instance, and start it against the verified frozen product assets. Verify the
new process and a fresh real browser page; health alone is not acceptance. Keep
Room history, Agent configuration and private memory intact. If active work
cannot be safely drained, report that blocker instead of force-killing it. Never
substitute a Fake CLI fixture for the formal user-review URL. This standing
restart instruction does not authorize commits, pushes or paid-provider tests.

## Documentation and handoff

Update owner documents/ADRs together with changes to protocol, lifecycle,
authority, memory policy, deployment or release gates. Link current evidence
from `docs/README.md`. Keep this guide durable: no live PIDs, private credentials,
signed attachment URLs, temporary ports or volatile pass counts here.

Behavior coverage needs a deduplicated applicable inventory and per-row evidence;
never announce 100% or a completion percentage from source callback counts.
Report remaining frontend, backend and verification gaps separately, including
intentional non-Raft scope. Verify commit, deployment and restart claims at the
time of handoff. A local commit does not mean pushed or deployed.
