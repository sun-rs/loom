# ADR 0032: Instance session binding contract

Date: 2026-09-22

Status: Contract foundation implemented; production adoption pending.

Implementation sequencing and migration are governed by the user-approved
[refactor execution plan](../design/role-instance-refactor-execution-plan.zh-CN.md).
The existing foundation does not bypass the P0–P8 adoption and migration gates.

## Context

The user approved separating reusable Role configuration from channel member
instances. Each instance continues one native CLI session; changing model or
effort must not silently create a different conversation. Private box work uses
the original instance lane. A durable fork creates a new member, while recovery
replaces a native binding under the same member identity.

The current Agent session store includes runtime profile revision and standing
prompt digest in its key. Its existing guarantees remain valid for the current
product. Reinterpreting that key as the new instance identity would silently
change continuity and migration semantics.

See [v0.2 design](../design/role-instance-session-v0.2.zh-CN.md) and
[source and characterization evidence](../audits/2026-09-22-role-session-validation.zh-CN.md).

## Decision

`protocol/instance-session-binding.ts` owns a strict, versioned binding shape:
instance, channel, frozen Role provenance, host, CLI runtime, opaque native
session ID and positive safe-integer epoch. Model, effort, profile revisions,
credentials and task ownership are not binding fields.

`kernel/instance-session-binding-policy.ts` owns pure continuation, replacement
and fork rules. Continuation requires the complete expected binding to match.
Replacement retains identity/provenance and advances the epoch with a different
native ID. Fork retains channel and Role provenance but creates a different
instance/native ID at epoch one. Unknown properties are rejected, not copied.

These functions do not store state, schedule work, launch providers or authorize
commands. There is no second queue, lease store or session database. They are
not called by production handlers yet.

## Required integration boundaries

The eventual Kernel transaction must obtain the authoritative current binding,
authenticate commands, check membership and active execution, reject duplicate
native bindings in the host/runtime namespace, append the event and commit the
projection atomically. It must handle idempotency before applying a transition.
Runtime credentials and late writes must be checked against that committed
epoch and the existing execution lease. A caller-provided expected binding is
an optimistic concurrency precondition, never authority.

AgentHost executes native operations and returns opaque diagnostics/results;
it cannot grant itself a new epoch. Native fork result verification, checkpoint
semantics, failure cleanup and privilege isolation remain separate gates.

This stage deliberately adds no migration, HTTP/CLI command or default runtime
change. It does not supersede existing Agent identity, memory ownership or
session store behavior. Production adoption requires the remaining Role/member
aggregate, transactional binding owner and reviewed migration path.

## Evidence and limitations

Tests were added first and failed because the new modules did not exist; after
implementation eight schema/policy tests passed. They cover identity conflicts,
stale transitions, epoch exhaustion, separate fork identity, epoch reset and
unknown authority fields. They do not prove real native continuity, a durable
compare-and-swap, old-process fencing, or memory isolation. Those claims must
wait for integration tests and the authorized real-CLI gates.

## MVP execution fence (2026-09-23)

The [continuity repair](../audits/2026-09-23-instance-continuity-mainline.zh-CN.md)
uses existing durable execution records to reject missing Host bindings after a
prior prepared launch. It does not implement the epoch/replacement/fork aggregate
above. ProviderSessionStore remains the native-ID owner; evidence persistence
failure stops execution and prevents successful Activation completion even if
the child exited zero. Automatic reconstruction remains deferred.
