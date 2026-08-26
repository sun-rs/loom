# RAH OS

RAH OS is a room-first collaboration kernel for humans and heterogeneous coding agents.

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

This repository starts from a clean architecture. Nothing from the legacy RAH workbench is imported by default. An independent local Phase 1 experiment first showed that Codex, Kimi, OpenCode, and Claude Code can follow one Room task protocol without parsing stdout or JSONL. The current TypeScript implementation now reproduces the minimum Task slice with a deterministic fake CLI and an opt-in Codex Luna gate; this remains local E2 evidence, not production completeness.

Current scope:

- protocol schemas;
- SQLite Room ledger;
- transactional Inbox/Activation/Outbox derivation;
- canonical Task projection with `todo -> claimed -> in_progress -> waiting_input/submitted -> completed`, an independent claim lease, daemon-side heartbeat, activation-scoped query/resume, explicit reclaim, stable command idempotency, and proof-gated Activation completion that durably retries unfinished assigned work;
- canonical InputRequest `pending -> resolved`, atomic Task suspension/claim release, human Inbox attention, authenticated designated-responder resolution, and `input.resolved -> Inbox/Activation/Outbox` wake without keeping a model session alive;
- resumable Room cursors with explicit receipt acknowledgement;
- Activation coalescing and leases;
- principal access-token authentication and coarse Agent message freshness;
- hashed, revocable Host credentials whose authenticated contexts are fixed to one Host ID and an explicit Agent participant scope;
- recoverable Outbox delivery state;
- recoverable Activation renew/retry and follow-up merging;
- a polling AgentHost with durable heartbeat, in-run lease/timeout supervision, and RunAttempt provenance;
- an AgentHost daemon lifecycle wrapper with owner-private Unix-socket single-instance coordination, stale-artifact recovery, `SIGINT`/`SIGTERM` bridging, and explicit `online -> draining -> offline` state;
- a deterministic Fake Runtime;
- an L0 generic OS-process adapter with executable probing, shell-free spawn, byte- and run-count-bounded opaque diagnostics, dedicated process groups, and `SIGTERM`→`SIGKILL` cleanup of members that remain in the POSIX process group;
- a loopback-only Worker Application Service with per-Activation hashed bearer credentials, server-owned Room/consumer scope, delivered-cursor acknowledgement, canonical Task query, redacted InputRequest status recovery, strict causal Task `claim/start/progress/request-input/submit`, token-free sidecar claim heartbeat, expiry, and process-lifetime revocation;
- a separate versioned loopback Human Client Application Service with per-request principal PAT authentication, server-owned actor identity, Room ACL, delivery-proven `sync/ack`, canonical Task/InputRequest list, designated-responder causal resolution, and content-free health/capabilities;
- Host-derived Worker execution grants that require no Agent PAT and are re-fenced on every request by the active daemon generation, Activation lease, RunAttempt, and RuntimeProcess;
- an executable `@rah-os/daemon` composition root with strict compatibility config v2 and registry-backed config v3, explicit loopback Client binding, owner-private file-secret loading, startup rollback, independent Client/Worker/Kernel cleanup, build/protocol/schema capability metadata, and newer-schema refusal;
- durable `activation.requested` Outbox dispatch into a content-free local wake signal, with fixed polling retained as the loss-recovery backstop;
- per-daemon instance generations with stale takeover fencing, plus bounded start/recover/cancel and total drain deadlines;
- an end-to-end fixture path from AgentHost through a real child process to Room `sync/ack`, Task submit, and Activation delivery proof, without reading process output for business state;
- fail-closed runtime termination: unproven cancellation or an expired lease with an active RunAttempt durably orphans/quarantines the lane instead of starting duplicate work;
- persistent RuntimeProcess records, a durable `prepared -> active` runtime transition before `run.started`, execution-fenced Worker credentials, renewable attempt-fenced orphan recovery leases, terminal-proof-gated Activation completion, and proof-gated quarantine resolution;
- a POSIX per-run process supervisor with owner-private directories, an authenticated control socket, and a run-bound signed terminal result, so a replacement AgentHost can clean up the original Generic process group without trusting a persisted PID/PGID or declaring success while that group still exists.
- a Host-bound, owner-private Runtime Profile Registry with strict v1/v2 manifests, domain-separated canonical digests, immutable semantic revisions and probe reports, idempotent object/file import, explicit activate/deprecate projections, and database-enforced append-only local audit;
- a versioned built-in adapter/recovery implementation registry, immutable executable-content probes with spawn-time identity revalidation, bounded redact-before-truncate diagnostics, spawn-time credential-slot binding, old-revision recovery provenance/routing, and a live-probed redacted profile-to-Offer publisher for daemon config v3.

Current status is provisional but the local daemon core now has E2 coverage: an independent `rah-os-daemon` process can receive durable Outbox wake, lease an Activation, start an external worker, verify Worker delivery and Task commands, heartbeat a long claim without model polling, resume a partially progressed Task in a new RunAttempt, exit while a Task waits for human input, accept the Human response through the separate Client API, and wake a new CLI session after durable resolution. It can also handle `SIGTERM`, clean up, and restart without any UI. Opt-in delivery gates passed Codex CLI 0.149.1 (`gpt-5.6-luna`), Kimi CLI 0.38.0, OpenCode 1.18.22, and Claude Code 2.1.234 (`claude-sonnet-5`, low); Codex Luna has additionally passed the current Task gate. All verdicts avoid transcript/JSONL parsing. Kimi/OpenCode/Claude have not yet been rerun against the new Task gate, and no real Provider has run the InputRequest gate. Task dependency, richer block/reassign/cancel, Artifact/Review, escaped `setsid` descendants, PGID reuse under extreme churn, Windows process-tree recovery, supervisor-artifact lifecycle management, launchd/Keychain/signing/install, complete Client/control/hint surfaces, CORS/LAN/browser integration, and memory governance remain roadmap work. See [ADR-0005](./docs/adr/0005-daemon-composition-worker-delegation-and-wake.md), [ADR-0006](./docs/adr/0006-task-business-protocol-and-causal-worker-commands.md), [ADR-0007](./docs/adr/0007-durable-input-request-and-no-listen-waiting.md), [ADR-0008](./docs/adr/0008-versioned-human-client-application-service.md), and the [Daemon Core architecture](./docs/architecture/daemon-core.zh-CN.md) for the implemented boundary.

The next multi-Agent daemon step is being implemented behind explicit gates. ADR-0009 R0 provides strict Agent/Policy/Offer/Model/Placement schemas and a deterministic pure placement planner. The R1/R1.1 Kernel now has schema v5, control-Room-accounted immutable Agent/Policy revisions, server-bounded monotonic RuntimeOffer heads, content-addressed trusted certification, append-only Offer observations, atomic durable Placement reservations, directed Host pull, terminal-proof and Host-generation fencing, crash-window recovery, and frozen candidate/RunAttempt provenance while preserving the legacy single-runtime lease path. Narrow R2a/R2b now provides a Host-local immutable Runtime Profile Registry, versioned implementation resolution, probe-bound v2 activation, spawn-time credential slots, config v3 integration, redacted Offer publication, and compatibility-lane recovery routed by frozen old-revision provenance. Package-local lifecycle calls still rely on the OS-user/owner-private boundary and are not authenticated control-Room admin commands. R1 remains provisional: the certification catalog is startup-owned rather than a full admin control object; admin CapacityPool membership/caps, PlacementHold, canonical workspace mounts, model binding execution, placement-managed launch claim, recovery routing across multiple lanes, and `MultiLaneAgentHost` are not implemented. Config v3 still drives the compatibility single-participant lane; publishing an Offer does not make it a production multi-Agent scheduler. The [2026-08-26 independent audit](./docs/audits/2026-08-26-runtime-placement-independent-audit.zh-CN.md) records the staged audit boundary and R2b follow-up. See [ADR-0009](./docs/adr/0009-immutable-runtime-placement-and-multi-lane-host.md) and the [Runtime Registry and multi-lane architecture](./docs/architecture/runtime-registry-and-multi-lane-scheduling.zh-CN.md) for implemented versus design-only boundaries.

Not yet in scope:

- Web UI;
- transcript/thinking/tool normalization;
- migration of legacy Council or Session data;
- remote runners;
- artifact rendering;
- production authentication.

## Development

Requirements: Node.js 24 or newer.

```bash
npm install
npm run check
npm run format:check
```

The daemon executable accepts a strict config:

```bash
node packages/daemon/src/cli.ts --config /absolute/path/daemon.json
```

See the [configuration example](./docs/examples/daemon.config.example.json). Host/principal provisioning is still a development API; a production management command and Keychain provider are not yet included.

Read [the documentation index](./docs/README.md) and [AGENTS.md](./AGENTS.md) before making changes.
