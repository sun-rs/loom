# RAH OS

The maintained frontend standard is [RAH Neo-Brutalist UI](./docs/design/neo-brutalist-ui.md):
internal assets, shared components, executable templates and linked behavior contracts.
No external `raft-ui` checkout is needed for build, runtime or library maintenance.

RAH OS is a room-first collaboration kernel for humans and heterogeneous coding agents.

Users install and authenticate their own Agent CLIs. RAH OS discovers, invokes and manages those runtimes; it does not install provider CLIs or configure their accounts. This is distinct from installing the RAH OS Computer service itself.

Its purpose is not to normalize every provider transcript. Codex, Claude Code, Kimi, OpenCode, and future CLIs are replaceable runtime slots. RAH OS owns durable collaboration state: rooms, membership, messages, tasks, inboxes, activations, runs, artifacts, and reviews.

```text
Room event
  -> durable Inbox
  -> durable Activation
  -> AgentHost lease
  -> start/resume a CLI
  -> agent pulls Room state
  -> explicit progress/result/review action
```

An agent does not remain in a token-consuming MCP listen loop while a human reads. It exits or becomes idle; a later reply creates a new Activation. Notification transports accelerate delivery but never become the source of truth.

The Room Kernel service and Mac AgentHost daemon are logically independent of every UI. Browser, PWA, desktop, and future native clients share one versioned Room protocol; closing a window never owns or completes durable work.

## Repository status

Current release: **one Human, multiple Agents, local Mac**. Multi-Human onboarding,
collaboration and differentiated Human Room access are a deferred optional project,
not first-release blockers. [Scope decision and mainline order](./docs/product/single-human-mainline-and-multi-human-backlog.zh-CN.md)
supersede earlier public-Channel closure priorities; existing authentication and
Agent execution/memory boundaries remain required.

Current remaining work and evidence limits: [2026-09-06 source audit and construction order](./docs/audits/2026-09-06-current-alignment-and-construction-order.zh-CN.md). Historical capability notes below are not current missing-feature lists; use the dated delivery evidence in [docs/README.md](./docs/README.md).

Agent memory follows the [Raft-baseline-first contract](./docs/product/agent-memory-raft-baseline.zh-CN.md): one persistent Agent-owned `MEMORY.md + notes/`, complete original-index reads, and no automatic text splitting or selection. Optional enhancements must be independently testable and reversible; source reuse, host adaptation and unfinished integration are recorded separately.

Current Runs have a Computer-local App Inbox CLI: `check` only lists notifications, `ack` acknowledges an observed item/version, and explicit `recheck` measures the source. These capabilities expire with the Run and do not carry Room credentials or prove memory quality. A seven-turn real OpenCode/DeepSeek and Kimi experiment now verifies formation, fresh-session recall, file-withholding and different-Agent controls, correction and cross-provider continuity. Autonomous idle maintenance remains unconnected. See the [current real-memory and product audit](./docs/audits/2026-08-30-real-memory-acceptance-and-product-audit.zh-CN.md) for evidence and limits.

Current-status correction: Human Inbox/InputRequest and ordinary Agent file-memory injection are implemented; older roadmap descriptions below must not be read as saying they are absent. The [global discovery batch](./docs/audits/2026-08-30-global-discovery-closure.zh-CN.md) now implements Workspace channel Tasks, ACL-filtered Search with exact message/thread context, and Human Activity with persistent read/done frontiers. Search, Notifications/typed deep links, execution restart/full reset, Files and Task/Review now have implementation; their complete page-family, device and release acceptance remains bounded by current evidence. The audits do not certify deployment, all Providers, or complete Raft parity.

The next [Raft gap-repair plan](./docs/product/raft-gap-repair-plan.zh-CN.md) passed a separate pre-construction [second review](./docs/audits/2026-08-30-raft-gap-plan-second-review.zh-CN.md). Its first batch adds revision-fenced persistent cleaner configuration through the Human memory pane and Run-scoped `rah app config --app system.cleaner`. Disabling this reminder does not disable memory. This work does not enable autonomous maintenance or deploy changes to the user's running service.

This repository starts from a clean architecture. Nothing from the legacy RAH workbench is imported by default. An independent local Phase 1 experiment first showed that Codex, Kimi, OpenCode, and Claude Code can follow one Room task protocol without parsing stdout or JSONL. The current TypeScript implementation now includes a standalone `@rah-os/core`, a deterministic fake multi-Agent business-flow gate, and opt-in real CLI gates; this remains local E2 evidence, not production completeness.

Current scope:

- protocol schemas;
- a headless `@rah-os/core` lifecycle/composition SDK whose frozen `core.human` port is directly usable without a server and whose dependency boundary excludes daemon, HTTP transport, and UI shells;
- SQLite Room ledger;
- Kernel schema v9 canonical Workspace container, managed Workspace control Room, RoomKind, Human-owned Room membership roles, and Thread/root/reply foreign-key boundaries, including fail-closed legacy owner migration; every Task now owns a Room-sequential number, top-level source Message and unique Thread, while progress/submission are canonical Thread replies;
- transactional Inbox/Activation/Outbox derivation;
- canonical Task Coordination v1 with assigned/open `todo`, Room-Agent broadcast plus atomic single-winner claim, `claimed -> in_progress -> waiting_input/blocked/submitted -> completed|cancelled`, explicit release/assign/unblock/cancel, immutable older-Task dependencies, dependency-ready wake, independent claim lease, stable command idempotency, and proof-gated Activation completion;
- canonical InputRequest `pending -> resolved`, atomic Task suspension/claim release, human Inbox attention, authenticated designated-responder resolution, and `input.resolved -> Inbox/Activation/Outbox` wake without keeping a model session alive;
- resumable Room cursors with explicit receipt acknowledgement;
- Activation coalescing and leases;
- principal access-token authentication and coarse Agent message freshness;
- hashed, revocable Host credentials whose authenticated contexts are fixed to one Host ID and an explicit Agent participant scope;
- recoverable Outbox delivery state;
- recoverable Activation renew/retry and follow-up merging;
- a polling AgentHost with durable heartbeat, in-run lease/timeout supervision, and RunAttempt provenance;
- an atomic Placement launch claim and bounded `MultiLaneAgentHost`: different Agent identities can run concurrently, one identity remains serial, restart recovery precedes retry, and one quarantined lane does not block another Agent;
- an AgentHost daemon lifecycle wrapper with owner-private Unix-socket single-instance coordination, stale-artifact recovery, `SIGINT`/`SIGTERM` bridging, and explicit `online -> draining -> offline` state;
- a deterministic Fake Runtime;
- an L0 generic OS-process adapter with executable probing, shell-free spawn, byte- and run-count-bounded opaque diagnostics, dedicated process groups, and `SIGTERM`→`SIGKILL` cleanup of members that remain in the POSIX process group;
- a loopback-only Worker Application Service with per-Activation hashed bearer credentials, server-owned Room/consumer scope, delivered-cursor acknowledgement, activation-scoped canonical Room reply, canonical Task query, redacted InputRequest status recovery, strict causal Task `claim/start/progress/request-input/submit`, token-free sidecar claim heartbeat, expiry, and process-lifetime revocation;
- a separate versioned loopback Human HTTP adapter over the same `HumanApplicationPort`, with v1/v2 compatibility and v3 managed Workspace/Room creation, per-request principal PAT authentication, server-owned actor identity, Room ACL, member/Message/Thread commands, delivery-proven `sync/ack`, canonical Task/InputRequest list, designated-responder causal resolution, and content-free health/capabilities;
- Host-derived Worker execution grants that require no Agent PAT and are re-fenced on every request by the active daemon generation, Activation lease, RunAttempt, and RuntimeProcess;
- an executable `@rah-os/daemon` composition root with strict compatibility config v2, single-profile config v3, and placement-managed multi-participant/multi-profile config v4, explicit loopback Client binding, owner-private file-secret loading, startup rollback, independent Client/Worker/Kernel cleanup, build/protocol/schema capability metadata, and newer-schema refusal;
- durable `activation.requested` Outbox dispatch into a content-free local wake signal, with fixed polling retained as the loss-recovery backstop;
- per-daemon instance generations with stale takeover fencing, plus bounded start/recover/cancel and total drain deadlines;
- an end-to-end fixture path from AgentHost through a real child process to Room `sync/ack`, Task submit, and Activation delivery proof, without reading process output for business state;
- fail-closed runtime termination: unproven cancellation or an expired lease with an active RunAttempt durably orphans/quarantines the lane instead of starting duplicate work;
- persistent RuntimeProcess records, a durable `prepared -> active` runtime transition before `run.started`, execution-fenced Worker credentials, renewable attempt-fenced orphan recovery leases, terminal-proof-gated Activation completion, and proof-gated quarantine resolution;
- a POSIX per-run process supervisor with owner-private directories, an authenticated control socket, and a run-bound signed terminal result, so a replacement AgentHost can clean up the original Generic process group without trusting a persisted PID/PGID or declaring success while that group still exists.
- a separate durable Computer resident-service slice: Raft-conformant ready/backoff/degraded policy, atomic owner-private runner state, a prepared-before-launch wrapper, authenticated Unix control socket, signed terminal replay, replacement-process adoption after parent `SIGKILL`, owner-private multi-attachment credentials, short-session/heartbeat/RuntimeOffer reconciliation, and a generation-fenced remote execution protocol for Placement claim, runtime prepare/start, lease renew, terminal proof, RunAttempt finish, and Activation complete/retry/quarantine. Local and remote execution reuse the same AgentHost control owner. `RemoteComputerAgentHostService` is the single lifecycle composition for one connected resident plus bounded AgentHost workers: it publishes identity/Offers before work and drains runtimes before reporting offline. An HTTP gate proves that a real child process receives only an Activation-scoped Worker credential, syncs canonical Room work, survives short-session renewal after durable prepare, then waits for credential revocation before terminal reap. Kernel schema v10 additionally owns single-flight restart/upgrade operations; capability-gated short sessions pull assignments and acknowledge typed phases only, with no shell/log payload. Restart freezes the incumbent build, upgrade freezes the target build, and completion requires a different Host generation with exact heartbeat attestation. The Computer keeps an atomic owner-private two-phase delivery receipt so ambiguous Server acknowledgement can resume without inventing local transaction state. A pinned-Ed25519 release source verifies strict semver, complete platform metadata, signed size and SHA-256 before an owner-private, exact-length, idempotent artifact download; metadata, total artifact, and stream-stall deadlines are independent. Whole-service replacement freezes every attachment identity, requires the candidate to own the actual singleton Unix socket and answer an HMAC challenge with exact process/source/build/generation identity, then either commits or kills the candidate and restores the incumbent; real child-process gates cover both paths. The Apache-2.0 `@botiverse/k-carrier@0.1.6` core is frozen as `@rah-os/k-carrier` with exact tag/hash/source record because the official npm TypeScript export cannot run directly under native Node. `KCarrierComputerUpgradeCoordinator` now makes K's WAL and stable/experiment slots the sole local upgrade transaction owner; the RAH receipt only projects already-proven phases to the Server. A durable single-flight request, empty-environment detached launcher primitive, process-body recovery runner, production HostAdapter, authenticated PID/generation-fenced hold/release/stop control, and slot-only FD-config launcher now form one composition factory. A real detached-process black-box gate replaces an independent incumbent process, promotes the signed target slot, verifies exact attachment resumption, and requires the successor process itself to prove live singleton ownership before clearing K, Server, and launch-request receipts. Service-start recovery now distinguishes idle/source-recovery/target-ready/fail-closed identity drift; a coordinator `SIGKILL` during handoff is proven to roll back stable and clear parked/Server receipts. A launchd-owned constant supervisor, authenticated supervisor socket, FD3 private config, FD4 parent-lifetime lease, `plutil`-valid LaunchAgent plan, typed provisioning closure, verified staging installer, and shell-free `bootstrap|kickstart|bootout` controller are implemented and tested. A darwin-arm64 release gate pins upstream Node v26.8.1 by exact archive size/SHA-256, bundles the unified CLI and process-group supervisor into one 144 MB SEA, ad-hoc codesigns it, and proves the same bytes pass the offline Ed25519 publisher/consumer round trip and install as both constant supervisor and K stable service. `npm run publish:computer-release` reads an owner-private Ed25519 key, publishes immutable targets and signed manifests before atomically advancing a monotonic latest pointer, and never prints or copies the key. This is not yet a remotely published or remote LAN product: Developer ID/notarization, production key custody and HTTPS upload, a real login/reboot/power-loss gate, content-free operation hint, cross-machine HTTPS Worker endpoint, pairing/TLS, and attachment/supervisor Keychain management remain absent; Runtime Provider Keychain loading is implemented;
- the production upgrade-process schema now requires that launchd-owned supervisor and has no direct-slot fallback. Both normal promotion and coordinator-`SIGKILL` rollback run through the complete supervisor composition. The supervisor exposes authenticated status/stop/start, fences a hung or late replacement launch, and the shell-free launchctl controller distinguishes loaded, exact `113` missing, and ambiguous failures. Explicit restart uses only `kickstart -k` and requires service-level readiness; deactivation is idempotent and proves removal. The unified internal command dispatches supervisor, service, detached upgrade, and the SEA-embedded process-group supervisor. Unit gates do not load the user's real service; optional readiness binds the supervisor child PID to singleton HMAC attestation. Real login/reboot/power-loss evidence remains open;
- `runNodeKCarrierComputerServiceProcess` is now the single replaceable-service process owner for the live workload, singleton HMAC attestation, attachment-set compare-and-hold/release, startup recovery, OS signals, and supervisor lease shutdown. Its explicit readiness barrier prevents singleton attestation or startup recovery from treating an uninitialized successor as healthy. `ComputerServiceAttachmentWorkload` consumes K's durable parked snapshot, fails closed on catalog drift, and drains/recreates the existing catalog manager around hold/release; `createRemoteComputerServiceAttachmentWorkload` composes every attachment into its own bounded `RemoteComputerAgentHostService` while sharing one service incarnation. `RemoteRuntimeProfileSet` reuses the same active-revision/model/Offer/recovery resolver rules as the local daemon, combines file- or macOS-Keychain-backed Provider secret leases with activation-scoped remote Worker credentials, and never exposes the long-lived attachment/session credential to a child; remote orphan-recovery control remains deliberately unsupported until the Computer protocol owns it. The production service entry now reads owner-private strict schema v1 only from FD3, opens and probes active immutable Runtime Profiles, binds strict file/Keychain secret references and Workspace evidence, constructs the attachment workload, runs K startup recovery, exits on the FD4 supervisor lease, and rejects a mutable configured buildVersion that differs from the SEA-frozen version. Its Keychain adapter uses fixed-path, shell-free, empty-environment `/usr/bin/security` with bounded time/output and never falls back between stores. It accepts no inline command or environment. `npm run install:computer:macos -- --request /absolute/request.json` accepts a strict owner-private data-only request and defaults to staging; activation and loaded-service replacement require separate explicit flags, artifact preflight precedes bootout, and an exact staged capability closure is resumable. The remaining release gap is Developer ID/notarization and remote publication, operator uninstall/purge, real login/reboot evidence, and Keychain provisioning/rotation for attachment and supervisor credentials—not another service, attachment, or Runtime execution implementation;
- a Host-bound, owner-private Runtime Profile Registry with strict v1/v2/v3 manifests, domain-separated canonical digests, immutable semantic revisions and versioned probe reports, idempotent object/file import, explicit activate/deprecate projections, and database-enforced append-only local audit;
- a versioned built-in adapter/recovery implementation registry, immutable executable-content probes with spawn-time identity revalidation, bounded redact-before-truncate diagnostics, spawn-time credential-slot binding, old-revision recovery provenance/routing, and live-probed redacted profile-to-Offer publishers for daemon configs v3/v4.

Current status is a **v0.1 local Core and Web workbench candidate with tested remote-Computer infrastructure**, not a signed production product or published SDK. The Core has fake E2 coverage for concurrent Room Tasks, atomic competition for one open Task, per-Agent serialization, Host restart recovery, quarantine isolation, active-run Agent pause/resume, and causal/idempotent collaboration commands. The P3 local gate drives managed Workspace/Room creation, persistent Agent provision/manage/lifecycle, Message/Thread context, two activation-scoped canonical Agent replies, one open Task, placement-managed dual lanes, one winner, Human completion, daemon restart, and durable client-cursor recovery entirely through canonical APIs; no transcript/JSONL is parsed. Compatibility configs v2/v3 retain delivery, Task resume, InputRequest, `SIGTERM`, and restart coverage. Runtime Profile v3 now probes machine-readable Claude/Codex/Kimi/OpenCode model catalogs without making a model request, freezes redacted bindings in the probe digest, and converts a Placement-selected model/reasoning intent into shell-free child launch controls. Kimi 0.38.0 effort is executable through its native per-process `KIMI_MODEL_THINKING_EFFORT` override; no user config is mutated. Opt-in delivery gates passed Codex CLI 0.149.1 (`gpt-5.6-sol`, low), Kimi CLI 0.38.0 (`kimi-code/k3`, runtime effort default), OpenCode 1.18.22 (`deepseek/deepseek-v4-flash`, max), and Claude Code 2.1.234. Kernel schema v12 now freezes a digest-verified ContextManifest for each new RunAttempt and owns versioned managed-MCP Server/Agent-assignment state. Local and remote launches inject the ContextManifest; a version-fenced Worker catalog/call path, Provider-specific local proxy and real Streamable HTTP executor keep credentials in daemon-owned SecretProvider references. The Web Settings slice can discover tools, create/revise/disable Servers and manage Agent tool allowlists entirely through the typed Human API and control Room causal barrier. It does not yet create executor URLs, request-header secrets or OAuth connections. The Raft-conformant Workspace instruction-pack protocol and rollback-capable installer are implemented. Each Activation also receives a token-free PATH-first `rah` wrapper whose fixed `rah worker` commands map to the scoped Worker application service, so default prompts and fake process gates no longer handcraft bearer HTTP. Task discussion anchors and Message-to-Task conversion are implemented; Human Inbox, Workspace/Room archive, explicit execution restart/session reset, canonical Artifact/Skill content resolution and pack assignment/materialization proof, Artifact/Review, stronger process containment, signed/notarized packaging, automatic LAN certificate trust/rotation, actual memory injection and memory governance remain roadmap work. The HTTPS Human LAN pairing edge, Raft-shaped paired-device administration and installable PWA shell are implemented; the external Computer HTTPS/pairing edge is not. See the [Raft official tutorial supervision baseline](./docs/product/raft-official-tutorial-supervision.zh-CN.md), [managed MCP supervision baseline](./docs/product/raft-managed-mcp-supervision.zh-CN.md), [Provider catalog audit](./docs/audits/2026-08-28-provider-model-effort-catalog-audit.zh-CN.md), [Core SDK boundary](./docs/architecture/core-sdk-boundary.zh-CN.md), and [Daemon Core architecture](./docs/architecture/daemon-core.zh-CN.md).

A persistent loopback local workbench is available with `npm run start:local-workbench`. A separate formal HTTPS LAN/PWA edge is available with `npm run start:lan-workbench`: the daemon remains loopback-only, the edge validates an explicit certificate/hostname/key, devices use expiring one-time pairing and revocable Secure/HttpOnly sessions, and the Human PAT stays server-side. Both paths serve the same production Web bundle and preserve Workspace/Room/Agent/Runtime state across restart. Their automated gates use fake CLIs and real Chrome; installed real CLIs are only invoked after the user explicitly adds an Agent to a Room and sends work. A source-independent, ad-hoc-signed Mac SEA product and LaunchAgent path now exist, but Developer ID/notarization, automatic local-CA trust and the external Computer pairing endpoint remain release gaps; see [ADR-0017](./docs/adr/0017-persistent-loopback-local-workbench.md) and [ADR-0019](./docs/adr/0019-local-core-secure-lan-edge-and-direct-computers.md).

Phase 4B anchored Task slice is now active without modifying the original `raft-ui` repository: an immutable 80-file reference snapshot with per-file SHA-256 feeds a narrow generated `ui-tokens` package rather than the product bundle directly. The typed `RahClient` now includes server-owned `principal.me`; `client-core` has cold-reload-safe snapshot replay, resumable bounded Room/Message catch-up, and a stable non-secret browser consumer identity. The Web recovery slice connects all accessible product Rooms, durable sync/ack, Message list/post, Thread list/create/reply, Task list/create/creator-only complete, winner/progress/result display, visibility wake, bounded polling/backoff, reconnect, and capability-aware degradation. Workspace-scoped Agent definitions cannot be implicitly onboarded across Workspace boundaries, and owner/admin role is combined with daemon capability before management controls become available. It also exposes daemon-owned local CLI inventory without letting that inventory mutate Room membership. Matching Raft channel behavior, canonical Room membership is the default Message delivery scope while `@mention` only raises attention; Room Chat keeps only the compact transient Activation/RunAttempt state while Agents → 动态 uses a separate bounded, paginated, ACL-filtered cross-Room canonical activity read model that merges Room events with version-fenced Managed MCP call metadata. Its copy action exports at most 200 typed records/64 KiB and never serializes arguments, credentials or result bodies. Neither surface reads Provider transcript/stdout/ANSI as business truth. Its Raft-shaped dialogs share keyboard/focus behavior, selected Room survives reload in `?room=`, and the 390px shell has a Room drawer and bottom Chat/Task/Agent navigation. A repeatable config v4 Fake CLI fixture has been exercised in a real browser through Message → Agent reply, Room creation, Agent membership, dialog keyboard, reload-safe deep link, and 390x844 recovery; the fixture start command is not itself an automated browser assertion. Unsupported Provider-native tool/file diagnostics and Files capabilities remain explicit rather than fixture-backed. See the [Raft UI product integration boundary](./docs/architecture/raft-ui-product-integration.zh-CN.md).

ADR-0009 now includes strict Agent/Policy/Offer/Model/Placement schemas, deterministic planning, immutable Offer/Placement provenance, atomic launch claims, a trusted startup capacity policy, MultiLane execution/recovery, the Host-local immutable Runtime Profile Registry, config v4 placement-managed routing, and probe-backed shell-free model execution binding. An opt-in real config v4 gate has now certified one canonical Room reply from each of Codex Sol/low, Kimi K3, and OpenCode DeepSeek V4 Flash/max with exact Placement/RunAttempt provenance. Fresh-Activation Kimi ACP and Codex app-server native adapters are registered and fake-protocol gated; all built-in local runtimes use Raft-compatible unattended `full_access` by default, while restricted modes remain explicit. RuntimeOffers publish exact supported tool-access modes; provision/manage, Placement and Web all fail closed instead of silently escalating an unsupported restricted policy. Kimi ACP currently advertises only `full_access`. R1/R4 remain provisional because native resume/live input, OpenCode serve, durable PlacementHold, complete Workspace mount/capacity control objects, and mixed-adapter crash recovery are still absent. Configs v2/v3 remain compatibility single-participant lanes. See [ADR-0009](./docs/adr/0009-immutable-runtime-placement-and-multi-lane-host.md), the [Runtime Registry and multi-lane architecture](./docs/architecture/runtime-registry-and-multi-lane-scheduling.zh-CN.md), and the [Provider execution transport audit](./docs/audits/2026-08-28-provider-execution-transport-audit.zh-CN.md) for implemented versus design-only boundaries.

Current exclusions and release limits:

- complete production Web/PWA parity is not yet certified;
- Provider diagnostics never become canonical business truth;
- migration of legacy Council or Session data is not a requirement;
- remote Computer product delivery is deferred;
- Artifact rendering and local/LAN authentication have implementations; current evidence determines their supported scope.

## Development

Requirements: Node.js 24 or newer.

```bash
npm install
npm run check
npm run format:check
```

Run the persistent local production Web workbench from the workspace you want Agents to use:

```bash
RAH_WORKSPACE_CWD=/absolute/workspace/path npm run start:local-workbench
```

Open the printed `http://127.0.0.1:4173` URL. Durable state defaults to `~/.rah`; set `RAH_DATA_HOME` only when a separate state root is required. `RAH_OS_HOME` remains a compatibility alias. Do not use the development `:lan` fixture as a production remote-access endpoint.

## Durable data and uninstall contract

The source checkout, SEA product, Web bundle, and current application name are replaceable. User
state is not. The stable default data root is `~/.rah`, intentionally independent of the `RAH OS`
display name so a future rename, upgrade, reinstall, or checkout deletion does not relocate data.

- `RAH_DATA_HOME` is the canonical override. `RAH_OS_HOME` remains a direct-root compatibility
  alias; startup fails if both resolve to different directories.
- RAH OS owns `state/`, `logs/`, `tls/`, `backups/`, and `.local-core-data-v1.json` below the shared
  root. The older RAH workbench owns `runtime-daemon/`, `auth/`, `council/`, and `attachments/`.
  Neither product may delete or repurpose the other product's children.
- Room, Agent, Task, memory, runtime-registry, token, device-pairing, notification, workspace, and TLS
  identity state must remain below the durable root, never in the repository, application bundle,
  build output, or LaunchAgent plist.
- The legacy default `~/Library/Application Support/RAH OS` is migrated only when no explicit root is
  set. Migration is no-overwrite, rejects links and special files before moving data, records a
  receipt, and can resume from its staging directory after interruption.
- Uninstall removes only the LaunchAgent registration and plist. There is no purge flag, and no
  installer or uninstaller may recursively delete the shared `~/.rah` root. Any future reset command
  must enumerate only RAH OS-owned paths, preview the deletion, fence active work, and require a
  separate explicit confirmation.

The normative rules are in
[`docs/product/2026-09-02-install-data-lifecycle-contract.zh-CN.md`](docs/product/2026-09-02-install-data-lifecycle-contract.zh-CN.md).
Any change to storage, installation, migration, service management, reset, or product naming must
update that contract and this README together.

Prepare the same persistent Core for paired LAN browsers and PWA clients. Choose the exact stable IP/hostname first; RAH OS creates one owner-private local CA and a hostname-bound leaf certificate:

```bash
RAH_LAN_ORIGIN=https://rah-core.example.test:7443 \
npm run provision:lan-tls
```

Trust the printed CA certificate once on each intended macOS/iOS device, then start the Core:

```bash
RAH_WORKSPACE_CWD=/absolute/workspace/path \
RAH_LAN_ORIGIN=https://rah-core.example.test:7443 \
npm run start:lan-workbench
```

The start command reuses the managed certificate and renews a valid leaf before its final 30 days. To supply an externally managed certificate instead, set both `RAH_LAN_CERT_PATH` and `RAH_LAN_KEY_PATH`; a partial override is rejected. Open the printed `/_rah/pair` URL and enter the 10-minute one-time code. After pairing, Settings → 局域网设备 lists active/revoked devices, issues additional one-time codes and revokes a device with immediate session invalidation. Trusting the CA explicitly is the formal model; bypassing a browser certificate warning is not. Never copy the printed CA private-key path to a client device. No central RAH server is required.

On macOS, build a source-independent Local Core product with the pinned official Node SEA carrier also used by the Computer release pipeline. The default signing identity is ad-hoc and is only for development verification; customer distribution still requires Developer ID and notarization:

```bash
mkdir -m 700 /absolute/carrier-directory
npm run fetch:core:sea-carrier -- \
  --output-directory /absolute/carrier-directory

npm run build:core:macos-product -- \
  --output /absolute/RAH-OS-Core-0.1.0 \
  --version 0.1.0 \
  --carrier /absolute/carrier-directory/node
```

The product contains one SEA executable, the production Web/PWA bundle, and a strict SHA-256 manifest. It imports no TypeScript, `node_modules`, repository script, or source checkout at runtime. The installer and uninstaller are embedded in that same executable. Install it as a per-user LaunchAgent; staging is the default and does not touch launchd, while `--activate` is an explicit second authority boundary:

```bash
/absolute/RAH-OS-Core-0.1.0/bin/rah-os-core install --quick-start
```

Quick start is the customer trial path: it requires at least one supported signed-in Agent CLI, creates an owner-private `~/RAH OS Workspace`, configures loopback Web at `http://127.0.0.1:4173`, and activates the per-user LaunchAgent in one explicitly requested operation. It never exposes the daemon to the LAN. For a custom workspace, staged installation, or LAN/PWA access, use the advanced path:

```bash
/absolute/RAH-OS-Core-0.1.0/bin/rah-os-core install \
  --mode lan \
  --workspace /absolute/workspace/path \
  --origin https://rah-core.example.test:7443

/absolute/RAH-OS-Core-0.1.0/bin/rah-os-core install \
  --mode lan \
  --workspace /absolute/workspace/path \
  --origin https://rah-core.example.test:7443 \
  --activate
```

The embedded installer verifies its product manifest, executable, and every Web asset before forming the launchd plan; it then freezes a non-secret environment and exact SEA digest, atomically publishes the plist, and requires `/_rah/health` after registration. It reports `sourceBound: false`; the repository-level `npm run install:core:macos` command remains only as a development operator. Replacing a loaded Core requires `--activate --replace-loaded`; replacing a different staged plist requires `--replace-staged`. A failed health proof automatically unloads the newly bootstrapped service instead of leaving a `KeepAlive` restart loop. In LAN mode, the initial one-time pairing code is written to the owner-private `core.stdout.log` path printed by the installer.

Uninstalling stops the LaunchAgent and removes its plist while preserving Rooms, Agents, TLS identity and all other persistent state:

```bash
/absolute/RAH-OS-Core-0.1.0/bin/rah-os-core uninstall
```

The uninstall command has no data-deletion flag. Any future reset product must use an independently reviewed, product-owned data inventory; it cannot delete the shared `~/.rah` tree.

The daemon executable accepts a strict config:

```bash
node packages/daemon/src/cli.ts --config /absolute/path/daemon.json
```

See the [config v2 compatibility example](./docs/examples/daemon.config.example.json) and [config v4 multi-Agent example](./docs/examples/daemon.config.v4.example.json). Host/principal/profile provisioning is still a development API; a production management command and local-daemon Keychain configuration are not yet included.

Managed MCP call history is a bounded Kernel-owned Agent projection: the browser receives tool/Room/Run/terminal metadata but never call arguments, credentials, or result bodies.

Read [the documentation index](./docs/README.md) and [AGENTS.md](./AGENTS.md) before making changes.
