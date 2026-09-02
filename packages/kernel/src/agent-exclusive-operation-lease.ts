import type { DatabaseSync } from "node:sqlite";

import {
  AgentExclusiveOperationAcquireInputSchema,
  AgentExclusiveOperationLeaseSchema,
  AgentExclusiveOperationReleaseInputSchema,
  AgentExclusiveOperationRenewInputSchema,
  type AgentExclusiveOperationAcquireInput,
  type AgentExclusiveOperationKind,
  type AgentExclusiveOperationLease,
  type AgentExclusiveOperationReleaseInput,
  type AgentExclusiveOperationRenewInput,
} from "@rah-os/protocol";

import type { AuthenticatedHostContext } from "./auth.ts";
import { assertAgentMemoryHome } from "./agent-memory-home.ts";
import {
  ConflictError,
  ForbiddenError,
  LeaseConflictError,
  NotFoundError,
} from "./errors.ts";
import { nullableText, text, type Row } from "./sqlite-row.ts";

export class AgentExclusiveOperationService {
  readonly #createId: (prefix: string) => string;
  readonly #database: DatabaseSync;
  readonly #now: () => Date;
  readonly #requireHost: (
    host: AuthenticatedHostContext,
  ) => AuthenticatedHostContext;
  readonly #requireHostParticipant: (
    host: AuthenticatedHostContext,
    participantId: string,
  ) => void;
  readonly #transaction: <T>(operation: () => T) => T;

  constructor(options: {
    createId: (prefix: string) => string;
    database: DatabaseSync;
    now: () => Date;
    requireHost: (host: AuthenticatedHostContext) => AuthenticatedHostContext;
    requireHostParticipant: (
      host: AuthenticatedHostContext,
      participantId: string,
    ) => void;
    transaction: <T>(operation: () => T) => T;
  }) {
    this.#createId = options.createId;
    this.#database = options.database;
    this.#now = options.now;
    this.#requireHost = options.requireHost;
    this.#requireHostParticipant = options.requireHostParticipant;
    this.#transaction = options.transaction;
  }

  acquire(
    host: AuthenticatedHostContext,
    input: AgentExclusiveOperationAcquireInput,
  ): AgentExclusiveOperationLease {
    const command = AgentExclusiveOperationAcquireInputSchema.parse(input);
    return this.#transaction(() => {
      const authenticatedHost = this.#requireHost(host);
      this.#requireHostParticipant(authenticatedHost, command.participantId);
      assertAgentParticipant(this.#database, command.participantId);
      if (
        command.kind === "memory_reset" ||
        command.kind === "memory_maintenance"
      ) {
        assertAgentMemoryHome(
          this.#database,
          command.participantId,
          authenticatedHost.hostId,
        );
      }
      return acquireAgentExclusiveOperationLease({
        command,
        createId: this.#createId,
        database: this.#database,
        hostId: authenticatedHost.hostId,
        hostInstanceId: authenticatedHost.instanceId,
        now: this.#now(),
      });
    });
  }

  renew(
    host: AuthenticatedHostContext,
    input: AgentExclusiveOperationRenewInput,
  ): AgentExclusiveOperationLease {
    const command = AgentExclusiveOperationRenewInputSchema.parse(input);
    return this.#transaction(() => {
      const authenticatedHost = this.#requireHost(host);
      const existing = getAgentExclusiveOperationLease(
        this.#database,
        command.operationId,
      );
      this.#requireHostParticipant(authenticatedHost, existing.participantId);
      return renewAgentExclusiveOperationLease({
        command,
        database: this.#database,
        hostId: authenticatedHost.hostId,
        hostInstanceId: authenticatedHost.instanceId,
        now: this.#now(),
      });
    });
  }

  release(
    host: AuthenticatedHostContext,
    input: AgentExclusiveOperationReleaseInput,
  ): AgentExclusiveOperationLease {
    const command = AgentExclusiveOperationReleaseInputSchema.parse(input);
    return this.#transaction(() => {
      const authenticatedHost = this.#requireHost(host);
      const existing = getAgentExclusiveOperationLease(
        this.#database,
        command.operationId,
      );
      this.#requireHostParticipant(authenticatedHost, existing.participantId);
      return releaseAgentExclusiveOperationLease({
        command,
        database: this.#database,
        hostId: authenticatedHost.hostId,
        hostInstanceId: authenticatedHost.instanceId,
        now: this.#now(),
      });
    });
  }

  get(operationId: string): AgentExclusiveOperationLease {
    return getAgentExclusiveOperationLease(this.#database, operationId);
  }
}

function assertAgentParticipant(
  database: DatabaseSync,
  participantId: string,
): void {
  const row = database
    .prepare("SELECT kind FROM principals WHERE principal_id = ?")
    .get(participantId);
  if (row === undefined) {
    throw new NotFoundError(`principal ${participantId} was not found`);
  }
  const kind = text(row, "kind");
  if (kind !== "agent") {
    throw new ForbiddenError(
      `exclusive operations require an Agent participant, not ${kind}`,
    );
  }
}

export function nextUnfencedReservedPlacement(
  database: DatabaseSync,
  hostId: string,
  hostInstanceId: string,
  nowMs: number,
): Row | undefined {
  return database
    .prepare(
      `SELECT candidate.*
       FROM placements AS candidate
       WHERE candidate.host_id = ?
         AND candidate.host_instance_id = ?
         AND candidate.state = 'reserved'
         AND candidate.lease_until_ms > ?
         AND NOT EXISTS (
           SELECT 1
           FROM agent_exclusive_operation_leases AS operation
           WHERE operation.participant_id = candidate.participant_id
             AND operation.state = 'active'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM task_reassignment_operations AS reassignment
           WHERE reassignment.previous_assignee_id = candidate.participant_id
             AND reassignment.state NOT IN ('assigned', 'failed_closed')
         )
       ORDER BY candidate.created_at, candidate.placement_id
       LIMIT 1`,
    )
    .get(hostId, hostInstanceId, nowMs);
}

export function nextUnfencedActivation(
  database: DatabaseSync,
  participantIds: string[],
  nowMs: number,
): Row | undefined {
  const placeholders = participantIds.map(() => "?").join(", ");
  return database
    .prepare(
      `SELECT candidate.*
       FROM activations AS candidate
       WHERE candidate.participant_id IN (${placeholders})
         AND NOT EXISTS (
           SELECT 1 FROM agent_definitions AS managed_agent
           WHERE managed_agent.participant_id = candidate.participant_id
             AND managed_agent.state <> 'enabled'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM agent_exclusive_operation_leases AS operation
           WHERE operation.participant_id = candidate.participant_id
             AND operation.state = 'active'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM task_reassignment_operations AS reassignment
           WHERE reassignment.previous_assignee_id = candidate.participant_id
             AND reassignment.state NOT IN ('assigned', 'failed_closed')
         )
         AND (
         candidate.state = 'queued'
           AND candidate.available_at_ms <= ?
           OR (candidate.state = 'leased' AND candidate.lease_until_ms <= ?)
         )
         AND NOT EXISTS (
           SELECT 1 FROM activations AS active
           WHERE active.participant_id = candidate.participant_id
             AND (
               active.state = 'quarantined'
               OR (active.state = 'leased' AND active.lease_until_ms > ?)
             )
         )
       ORDER BY candidate.created_at, candidate.activation_id
       LIMIT 1`,
    )
    .get(...participantIds, nowMs, nowMs, nowMs);
}

export function acquireAgentExclusiveOperationLease(input: {
  command: AgentExclusiveOperationAcquireInput;
  createId: (prefix: string) => string;
  database: DatabaseSync;
  hostId: string;
  hostInstanceId: string;
  now: Date;
}): AgentExclusiveOperationLease {
  const existingOperation = input.database
    .prepare(
      "SELECT * FROM agent_exclusive_operation_leases WHERE operation_id = ?",
    )
    .get(input.command.operationId);
  if (existingOperation !== undefined) {
    const existing = leaseFromRow(existingOperation);
    if (
      existing.state !== "active" ||
      existing.kind !== input.command.kind ||
      existing.participantId !== input.command.participantId ||
      existing.ownerHostId !== input.hostId ||
      existing.ownerHostInstanceId !== input.hostInstanceId
    ) {
      throw new ConflictError(
        `Agent operation ${input.command.operationId} already has different immutable ownership`,
      );
    }
    return existing;
  }

  assertAgentHasNoActiveLane(input.database, input.command.participantId);
  const competing = input.database
    .prepare(
      "SELECT operation_id FROM agent_exclusive_operation_leases WHERE participant_id = ? AND state = 'active' LIMIT 1",
    )
    .get(input.command.participantId);
  if (competing !== undefined) {
    throw new ConflictError(
      `Agent ${input.command.participantId} is fenced by operation ${text(competing, "operation_id")}`,
    );
  }
  const reassignment = input.database
    .prepare(
      `SELECT operation_id
       FROM task_reassignment_operations
       WHERE previous_assignee_id = ?
         AND state NOT IN ('assigned', 'failed_closed')
       LIMIT 1`,
    )
    .get(input.command.participantId);
  if (reassignment !== undefined) {
    throw new ConflictError(
      `Agent ${input.command.participantId} is fenced by Task reassignment ${text(reassignment, "operation_id")}`,
    );
  }

  const leaseId = input.createId("agent_exclusive_lease");
  const timestamp = input.now.toISOString();
  const leaseUntil = new Date(
    input.now.getTime() + input.command.leaseMs,
  ).toISOString();
  input.database
    .prepare(
      `INSERT INTO agent_exclusive_operation_leases(
        lease_id, operation_id, participant_id, kind, owner_host_id,
        owner_host_instance_id, state, acquired_at, renewed_at, lease_until,
        lease_until_ms, released_at
      ) VALUES(?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL)`,
    )
    .run(
      leaseId,
      input.command.operationId,
      input.command.participantId,
      input.command.kind,
      input.hostId,
      input.hostInstanceId,
      timestamp,
      timestamp,
      leaseUntil,
      Date.parse(leaseUntil),
    );
  return leaseFromRow(requireLeaseRow(input.database, leaseId));
}

export function renewAgentExclusiveOperationLease(input: {
  command: AgentExclusiveOperationRenewInput;
  database: DatabaseSync;
  hostId: string;
  hostInstanceId: string;
  now: Date;
}): AgentExclusiveOperationLease {
  const row = requireLeaseRow(input.database, input.command.leaseId);
  assertLeaseOwnerIdentity(row, input);
  assertLeaseIsActive(row);
  const renewedAt = input.now.toISOString();
  const leaseUntil = new Date(
    input.now.getTime() + input.command.leaseMs,
  ).toISOString();
  input.database
    .prepare(
      "UPDATE agent_exclusive_operation_leases SET renewed_at = ?, lease_until = ?, lease_until_ms = ? WHERE lease_id = ?",
    )
    .run(renewedAt, leaseUntil, Date.parse(leaseUntil), input.command.leaseId);
  return leaseFromRow(requireLeaseRow(input.database, input.command.leaseId));
}

export function releaseAgentExclusiveOperationLease(input: {
  command: AgentExclusiveOperationReleaseInput;
  database: DatabaseSync;
  hostId: string;
  hostInstanceId: string;
  now: Date;
}): AgentExclusiveOperationLease {
  const row = requireLeaseRow(input.database, input.command.leaseId);
  assertLeaseOwnerIdentity(row, input);
  if (text(row, "state") === "released") return leaseFromRow(row);
  assertLeaseIsActive(row);
  const releasedAt = input.now.toISOString();
  input.database
    .prepare(
      "UPDATE agent_exclusive_operation_leases SET state = 'released', released_at = ? WHERE lease_id = ?",
    )
    .run(releasedAt, input.command.leaseId);
  return leaseFromRow(requireLeaseRow(input.database, input.command.leaseId));
}

export function getAgentExclusiveOperationLease(
  database: DatabaseSync,
  operationId: string,
): AgentExclusiveOperationLease {
  const row = database
    .prepare(
      "SELECT * FROM agent_exclusive_operation_leases WHERE operation_id = ?",
    )
    .get(operationId);
  if (row === undefined) {
    throw new NotFoundError(`Agent operation ${operationId} was not found`);
  }
  return leaseFromRow(row);
}

export function activeAgentExclusiveOperationParticipantIds(
  database: DatabaseSync,
): string[] {
  return database
    .prepare(
      `SELECT participant_id FROM agent_exclusive_operation_leases
       WHERE state = 'active'
       UNION
       SELECT previous_assignee_id AS participant_id
       FROM task_reassignment_operations
       WHERE state NOT IN ('assigned', 'failed_closed')
       ORDER BY participant_id`,
    )
    .all()
    .map((row) => text(row, "participant_id"));
}

export function assertAgentHasNoExclusiveOperation(
  database: DatabaseSync,
  participantId: string,
): void {
  const row = database
    .prepare(
      "SELECT operation_id FROM agent_exclusive_operation_leases WHERE participant_id = ? AND state = 'active' LIMIT 1",
    )
    .get(participantId);
  if (row !== undefined) {
    throw new LeaseConflictError(
      `Agent ${participantId} is fenced by operation ${text(row, "operation_id")}`,
    );
  }
  const reassignment = database
    .prepare(
      `SELECT operation_id
       FROM task_reassignment_operations
       WHERE previous_assignee_id = ?
         AND state NOT IN ('assigned', 'failed_closed')
       LIMIT 1`,
    )
    .get(participantId);
  if (reassignment !== undefined) {
    throw new LeaseConflictError(
      `Agent ${participantId} is fenced by Task reassignment ${text(reassignment, "operation_id")}`,
    );
  }
}

function assertAgentHasNoActiveLane(
  database: DatabaseSync,
  participantId: string,
): void {
  const checks: ReadonlyArray<readonly [string, string]> = [
    [
      "Activation",
      "SELECT activation_id AS identity FROM activations WHERE participant_id = ? AND state IN ('leased', 'quarantined') LIMIT 1",
    ],
    [
      "Placement",
      "SELECT placement_id AS identity FROM placements WHERE participant_id = ? AND state IN ('reserved', 'consumed') LIMIT 1",
    ],
    [
      "RunAttempt",
      "SELECT run_attempt_id AS identity FROM run_attempts WHERE participant_id = ? AND state IN ('starting', 'running', 'orphaned') LIMIT 1",
    ],
    [
      "RuntimeProcess",
      "SELECT runtime_process_id AS identity FROM runtime_processes WHERE participant_id = ? AND state <> 'terminated' LIMIT 1",
    ],
  ];
  for (const [label, query] of checks) {
    const row = database.prepare(query).get(participantId);
    if (row !== undefined) {
      throw new ConflictError(
        `Agent ${participantId} still has active ${label} ${text(row, "identity")}`,
      );
    }
  }
}

function assertLeaseOwnerIdentity(
  row: Row,
  input: {
    command: { operationId: string };
    hostId: string;
    hostInstanceId: string;
  },
): void {
  if (
    text(row, "operation_id") !== input.command.operationId ||
    text(row, "owner_host_id") !== input.hostId ||
    text(row, "owner_host_instance_id") !== input.hostInstanceId
  ) {
    throw new LeaseConflictError(
      `Agent exclusive lease ${text(row, "lease_id")} is not owned by this Host generation`,
    );
  }
}

function assertLeaseIsActive(row: Row): void {
  if (text(row, "state") !== "active") {
    throw new LeaseConflictError(
      `Agent exclusive lease ${text(row, "lease_id")} is not active`,
    );
  }
}

function requireLeaseRow(database: DatabaseSync, leaseId: string): Row {
  const row = database
    .prepare(
      "SELECT * FROM agent_exclusive_operation_leases WHERE lease_id = ?",
    )
    .get(leaseId);
  if (row === undefined) {
    throw new NotFoundError(`Agent exclusive lease ${leaseId} was not found`);
  }
  return row;
}

function leaseFromRow(row: Row): AgentExclusiveOperationLease {
  return AgentExclusiveOperationLeaseSchema.parse({
    acquiredAt: text(row, "acquired_at"),
    kind: text(row, "kind") as AgentExclusiveOperationKind,
    leaseId: text(row, "lease_id"),
    leaseUntil: text(row, "lease_until"),
    operationId: text(row, "operation_id"),
    ownerHostId: text(row, "owner_host_id"),
    ownerHostInstanceId: text(row, "owner_host_instance_id"),
    participantId: text(row, "participant_id"),
    ...(nullableText(row, "released_at") === null
      ? {}
      : { releasedAt: text(row, "released_at") }),
    renewedAt: text(row, "renewed_at"),
    schemaVersion: 1,
    state: text(row, "state"),
  });
}
