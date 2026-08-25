# RAH OS engineering contract

Read `README.md`, `docs/README.md`, and the relevant ADR before changing code.

## Product boundary

RAH OS is room-first. The durable Room ledger, Inbox, Task, Activation, Artifact, Review, and RunAttempt state are authoritative. Provider sessions, transcripts, JSONL, PTY screens, stdout, thinking, and tool streams are diagnostics only.

The permanent causal chain is:

```text
Room event -> Inbox item -> Activation -> AgentHost lease -> RunAttempt -> explicit Room action
```

WebSocket/SSE notifications are hints. They may be duplicated or lost. Reconnection must recover from durable state.

MCP and CLI are facades over the same application service. They are used after an agent is activated; an LLM tool-call loop must never own notification delivery or long-term waiting.

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
- Shared long-term memory requires explicit scope, provenance, version and promotion/retraction rules; a transcript or model summary is only a candidate.
- Unknown provider output stays diagnostic; do not expand the canonical protocol merely to mirror it.

## Scope discipline

Do not copy code from the legacy `rah` repository. Port only an invariant with a new test and a named owner. Avoid UI, provider transcript adapters, remote execution, and generalized plugin systems until the current roadmap gate is green.

Before handoff run:

```bash
npm run check
npm run format:check
git diff --check
```

Do not commit, push, publish, or run paid-provider tests unless the user explicitly requests it.
