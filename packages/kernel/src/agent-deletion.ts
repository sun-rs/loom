import {
  clearAgentDeletionBlock,
  findAgentDeletionBlocker,
} from "./agent-deletion-diagnostics.ts";
import { cancelDeletedAgentReminders } from "./reminder-agent-deletion.ts";
import { requireHumanControlRoomManager } from "./collaboration-policy.ts";
import type { ClientAgentManageRequest, RoomEvent } from "@rah-os/protocol";
import { canonicalDigest } from "./canonical-digest.ts";
import {
  ConflictError,
  IdempotencyConflictError,
  RuntimeTerminationProofError,
  StaleContextError,
} from "./errors.ts";
import { integer, text } from "./sqlite-row.ts";
import {
  readAgentDefinition,
  manageWorkspaceAgentTransaction,
  managementResultFromEvent,
  type WorkspaceAgentManagementOwner,
} from "./workspace-agent-management.ts";
import { releaseDeletedAgentTasks } from "./task-agent-deletion.ts";

export type AgentDeleteCommand = Extract<
  ClientAgentManageRequest,
  { action: "set_state" }
>;

/** Room events are the durable deletion request/receipt. No adapter-owned queue. */
export function requestAgentDeletion(
  owner: WorkspaceAgentManagementOwner,
  command: AgentDeleteCommand,
): RoomEvent {
  const { database: db, events } = owner;
  const agent = readAgentDefinition(db, command.agentId);
  const roomId = agent.definition.controlRoomId;
  requireHumanControlRoomManager(db, roomId, owner.actorId);
  const digest = canonicalDigest({
    domain: "rah/agent-deletion/v1",
    action: command.action,
    state: command.state,
    agentId: command.agentId,
    idempotencyKey: command.idempotencyKey,
  });
  const old = db
    .prepare("SELECT * FROM room_events WHERE room_id=? AND idempotency_key=?")
    .get(roomId, command.idempotencyKey);
  if (old) {
    const event = events.eventFromRow(old);
    if (
      event.type !== "agent.deletion_requested" ||
      event.actorId !== owner.actorId ||
      event.aggregateId !== command.agentId ||
      event.payload.requestDigest !== digest
    )
      throw new IdempotencyConflictError(
        "Agent deletion request identity changed",
      );
    return event;
  }
  if (agent.definition.state === "tombstoned")
    throw new ConflictError("a tombstoned Agent cannot be deleted again");
  const seq =
    integer(
      db.prepare("SELECT next_seq FROM rooms WHERE room_id=?").get(roomId)!,
      "next_seq",
    ) - 1;
  if (seq !== command.basedOnRoomSeq)
    throw new StaleContextError(command.basedOnRoomSeq, seq);
  const pending = db
    .prepare(
      "SELECT * FROM room_events WHERE aggregate_id=? AND type='agent.deletion_requested' LIMIT 1",
    )
    .get(command.agentId);
  if (pending) return events.eventFromRow(pending);
  if (agent.definition.state !== "disabled")
    manageWorkspaceAgentTransaction(owner, {
      ...command,
      state: "disabled",
      idempotencyKey: `${command.idempotencyKey}:disable`,
    });
  return events.append({
    actorId: owner.actorId,
    aggregateId: command.agentId,
    aggregateType: "agent_definition",
    idempotencyKey: command.idempotencyKey,
    roomId,
    type: "agent.deletion_requested",
    payload: {
      requestDigest: digest,
      participantId: agent.definition.participantId,
      basedOnRoomSeq: command.basedOnRoomSeq,
    },
  });
}

export function finishAgentDeletion(
  owner: WorkspaceAgentManagementOwner,
  request: RoomEvent,
) {
  const { database: db, events } = owner;
  const key = `${request.idempotencyKey}:complete`;
  const old = db
    .prepare("SELECT * FROM room_events WHERE room_id=? AND idempotency_key=?")
    .get(request.roomId, key);
  if (old) {
    const event = events.eventFromRow(old);
    if (
      event.type !== "agent.tombstoned" ||
      event.aggregateId !== request.aggregateId ||
      event.actorId !== request.actorId
    )
      throw new IdempotencyConflictError(
        "Agent deletion receipt identity changed",
      );
    return managementResultFromEvent(db, event, true);
  }
  const participantId = String(request.payload.participantId);
  // Timeouts, disabled state, and process signals are not terminal proof.
  // The blocking row is reported by identity so the operator knows which Host
  // must come back; there is no bypass.
  const blocker = findAgentDeletionBlocker(db, participantId);
  if (blocker)
    throw new RuntimeTerminationProofError(
      `Agent deletion is waiting for Host terminal proof from ${blocker.table} (${blocker.predicate})` +
        `${blocker.runAttemptId === undefined ? "" : `, run attempt ${blocker.runAttemptId}`}` +
        `${blocker.hostId === undefined ? "" : `, host ${blocker.hostId}`}` +
        `${blocker.recoveryDriver === undefined ? "" : `, recovery driver ${blocker.recoveryDriver}`}` +
        "; the durable request will resume automatically",
    );
  clearAgentDeletionBlock(db, request.aggregateId);
  const now = owner.now().toISOString();
  for (const activation of db
    .prepare(
      "SELECT * FROM activations WHERE participant_id=? AND state IN ('queued','quarantined')",
    )
    .all(participantId)) {
    const id = text(activation, "activation_id");
    db.prepare(
      "UPDATE activations SET state='cancelled',lease_owner=NULL,lease_until=NULL,lease_until_ms=NULL,last_error='Agent deleted',updated_at=? WHERE activation_id=?",
    ).run(now, id);
    events.append(
      {
        actorId: request.actorId,
        aggregateId: id,
        aggregateType: "activation",
        roomId: text(activation, "room_id"),
        idempotencyKey: `${request.eventId}:cancel:${id}`,
        type: "activation.cancelled",
        payload: {
          activationId: id,
          reason: "agent_deleted",
          agentId: request.aggregateId,
        },
      },
      request,
    );
  }
  releaseDeletedAgentTasks(owner, participantId, request);
  cancelDeletedAgentReminders(owner, request);
  return manageWorkspaceAgentTransaction(
    { ...owner, actorId: request.actorId, deletionRequest: request },
    {
      action: "set_state",
      state: "tombstoned",
      agentId: request.aggregateId,
      basedOnRoomSeq:
        integer(
          db
            .prepare("SELECT next_seq FROM rooms WHERE room_id=?")
            .get(request.roomId)!,
          "next_seq",
        ) - 1,
      idempotencyKey: key,
    },
  );
}
