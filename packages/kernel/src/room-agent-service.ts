import type { DatabaseSync } from "node:sqlite";

import {
  AgentActivityRecordSchema,
  AgentCatalogEntrySchema,
  AgentDefinitionRevisionSchema,
  AgentDefinitionSchema,
  RoomAgentActivitySchema,
  type AgentCatalogEntry,
  type AgentActivityRecord,
  type ActivationReason,
  type ClientAgentActivityListResponse,
  type Room,
  type RoomAgentActivity,
} from "@rah-os/protocol";

import { roomProjectionFromRow } from "./collaboration-projection.ts";
import { ForbiddenError, NotFoundError } from "./errors.ts";
import { requireRoomMember } from "./collaboration-policy.ts";
import type {
  CollaborationService,
  MessageRecipient,
} from "./collaboration-service.ts";
import type { AuthenticatedActorContext } from "./auth.ts";
import type { RoomFiles } from "./room-files.ts";
import {
  jsonObject,
  nullableInteger,
  nullableText,
  text,
  type Row,
} from "./sqlite-row.ts";
import type { MessageMutationResult, Principal } from "./types.ts";

export type HumanRoomMessageInput = {
  attachmentIds?: string[] | undefined;
  basedOnRoomSeq?: number;
  body: string;
  idempotencyKey: string;
  recipients?: MessageRecipient[];
  roomId: string;
};

export type HumanThreadReplyInput = {
  attachmentIds?: string[] | undefined;
  basedOnRoomSeq: number;
  body: string;
  idempotencyKey: string;
  recipientIds: string[];
  roomId: string;
  threadId: string;
};

/** Runs inside the Kernel transaction: message, recipients and attachment consumption commit together. */
export function postHumanRoomMessage(options: {
  actor: AuthenticatedActorContext;
  collaboration: CollaborationService;
  database: DatabaseSync;
  files: RoomFiles;
  input: HumanRoomMessageInput;
  principal: Principal;
}): MessageMutationResult {
  const { actor, collaboration, database, files, input, principal } = options;
  const previous = database
    .prepare(
      "SELECT aggregate_id FROM room_events WHERE room_id = ? AND idempotency_key = ? AND type = 'message.posted'",
    )
    .get(input.roomId, input.idempotencyKey);
  const attachments = files.forMessage(
    actor,
    input.roomId,
    input.attachmentIds ?? [],
    previous ? text(previous, "aggregate_id") : undefined,
  );
  const result = collaboration.postMessage(principal, {
    ...input,
    attachments,
    recipients: humanRoomMessageRecipients(database, principal, input),
  });
  if (!result.deduplicated)
    files.consume(attachments, result.event.aggregateId);
  return result;
}

/** Runs inside the Kernel transaction: Thread Message and attachment consumption commit together. */
export function replyHumanThread(options: {
  actor: AuthenticatedActorContext;
  collaboration: CollaborationService;
  database: DatabaseSync;
  files: RoomFiles;
  input: HumanThreadReplyInput;
  principal: Principal;
}): MessageMutationResult {
  const { actor, collaboration, database, files, input, principal } = options;
  const previous = database
    .prepare(
      "SELECT aggregate_id FROM room_events WHERE room_id = ? AND idempotency_key = ? AND type = 'message.posted'",
    )
    .get(input.roomId, input.idempotencyKey);
  const attachments = files.forMessage(
    actor,
    input.roomId,
    input.attachmentIds ?? [],
    previous ? text(previous, "aggregate_id") : undefined,
  );
  const result = collaboration.replyThread(principal, {
    ...input,
    attachments,
  });
  if (!result.deduplicated)
    files.consume(attachments, result.event.aggregateId);
  return result;
}

export function listAgentCatalogRows(
  database: DatabaseSync,
  actorId: string,
  controlRoomId?: string,
  includeDeleted = false,
): Row[] {
  return database
    .prepare(
      `SELECT
         agent_definitions.*,
         agent_definition_revisions.definition_json,
         principals.handle,
         json_extract(execution_policy_revisions.policy_json, '$.modelIntent.exactBindingIds[0]') AS model_binding_id
       FROM agent_definitions
       JOIN agent_definition_revisions
         ON agent_definition_revisions.agent_definition_revision_id =
            agent_definitions.current_revision_id
       JOIN execution_policy_revisions
         ON execution_policy_revisions.execution_policy_revision_id =
            agent_definition_revisions.execution_policy_revision_id
       JOIN principals
         ON principals.principal_id = agent_definitions.participant_id
       JOIN memberships
         ON memberships.room_id = agent_definitions.control_room_id
        AND memberships.principal_id = ?
       WHERE (? = 1 OR agent_definitions.state <> 'tombstoned')
         AND (? IS NULL OR agent_definitions.control_room_id = ?)
       ORDER BY principals.handle, agent_definitions.agent_definition_id`,
    )
    .all(
      actorId,
      includeDeleted ? 1 : 0,
      controlRoomId ?? null,
      controlRoomId ?? null,
    );
}

export function listAgentCatalog(
  database: DatabaseSync,
  actorId: string,
  controlRoomId?: string,
  includeDeleted = false,
): AgentCatalogEntry[] {
  const principal = database
    .prepare("SELECT kind FROM principals WHERE principal_id = ?")
    .get(actorId);
  if (principal === undefined || text(principal, "kind") !== "human") {
    throw new ForbiddenError(
      "Agent catalog requires an authenticated Human principal",
    );
  }
  return listAgentCatalogRows(
    database,
    actorId,
    controlRoomId,
    includeDeleted,
  ).map((row) =>
    AgentCatalogEntrySchema.parse({
      ...(nullableText(row, "model_binding_id")
        ? { modelBindingId: text(row, "model_binding_id") }
        : {}),
      currentRevision: AgentDefinitionRevisionSchema.parse(
        jsonObject(row, "definition_json"),
      ),
      definition: AgentDefinitionSchema.parse({
        agentId: text(row, "agent_definition_id"),
        controlRoomId: text(row, "control_room_id"),
        createdAt: text(row, "created_at"),
        currentRevisionId: text(row, "current_revision_id"),
        participantId: text(row, "participant_id"),
        state: text(row, "state"),
        updatedAt: text(row, "updated_at"),
      }),
      handle: text(row, "handle"),
    }),
  );
}

export function listWorkspaceAgentRooms(
  database: DatabaseSync,
  actorId: string,
  agentId: string,
): Room[] {
  const definition = database
    .prepare(
      `SELECT agent_definitions.participant_id, rooms.workspace_id
       FROM agent_definitions
       JOIN rooms
         ON rooms.room_id = agent_definitions.control_room_id
       JOIN memberships AS actor_control_membership
         ON actor_control_membership.room_id =
              agent_definitions.control_room_id
        AND actor_control_membership.principal_id = ?
       JOIN principals AS actor
         ON actor.principal_id = actor_control_membership.principal_id
        AND actor.kind = 'human'
       WHERE agent_definitions.agent_definition_id = ?
         AND agent_definitions.state <> 'tombstoned'`,
    )
    .get(actorId, agentId);
  if (definition === undefined) {
    throw new NotFoundError(`AgentDefinition ${agentId} was not found`);
  }
  return database
    .prepare(
      `SELECT rooms.*
       FROM rooms
       JOIN memberships AS agent_membership
         ON agent_membership.room_id = rooms.room_id
        AND agent_membership.principal_id = ?
       JOIN memberships AS actor_membership
         ON actor_membership.room_id = rooms.room_id
        AND actor_membership.principal_id = ?
       WHERE rooms.workspace_id = ?
         AND rooms.kind <> 'control' AND rooms.system_hidden=0
       ORDER BY rooms.kind, rooms.slug, rooms.room_id`,
    )
    .all(
      text(definition, "participant_id"),
      actorId,
      text(definition, "workspace_id"),
    )
    .map((row) => roomProjectionFromRow(row));
}

export type AgentActivityListInput = {
  agentId: string;
  beforeActivityId?: string;
  limit?: number;
};

export function listAgentActivity(
  database: DatabaseSync,
  actorId: string,
  input: AgentActivityListInput,
): ClientAgentActivityListResponse {
  const scope = database
    .prepare(
      `SELECT agent_definitions.participant_id,
              agent_definitions.control_room_id,
              rooms.workspace_id
       FROM agent_definitions
       JOIN rooms
         ON rooms.room_id = agent_definitions.control_room_id
       JOIN memberships AS actor_control_membership
         ON actor_control_membership.room_id =
              agent_definitions.control_room_id
        AND actor_control_membership.principal_id = ?
       JOIN principals AS actor
         ON actor.principal_id = actor_control_membership.principal_id
        AND actor.kind = 'human'
       WHERE agent_definitions.agent_definition_id = ?
         AND agent_definitions.state <> 'tombstoned'`,
    )
    .get(actorId, input.agentId);
  if (scope === undefined) {
    throw new NotFoundError(`AgentDefinition ${input.agentId} was not found`);
  }
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Agent activity limit must be between 1 and 100");
  }
  const participantId = text(scope, "participant_id");
  const workspaceId = text(scope, "workspace_id");
  const relevanceSql = `
    rooms.workspace_id = ?
    AND actor_membership.principal_id = ?
    AND (
      event.actor_id = ?
      OR (
        event.aggregate_type = 'agent_definition'
        AND event.aggregate_id = ?
      )
      OR (
        event.aggregate_type = 'activation'
        AND EXISTS (
          SELECT 1 FROM activations
          WHERE activations.activation_id = event.aggregate_id
            AND activations.participant_id = ?
        )
      )
      OR (
        event.aggregate_type = 'run_attempt'
        AND EXISTS (
          SELECT 1 FROM run_attempts
          WHERE run_attempts.run_attempt_id = event.aggregate_id
            AND run_attempts.participant_id = ?
        )
      )
      OR EXISTS (
        SELECT 1 FROM inbox_items
        WHERE inbox_items.event_id = event.event_id
          AND inbox_items.participant_id = ?
      )
    )`;
  const relevanceParameters = [
    workspaceId,
    actorId,
    participantId,
    input.agentId,
    participantId,
    participantId,
    participantId,
  ];
  const activitySql = `
    SELECT 'room_event' AS source,
           event.event_id AS activity_id,
           event.created_at,
           NULL AS participant_id,
           event.room_id,
           rooms.kind AS room_kind,
           rooms.name AS room_name,
           rooms.slug AS room_slug,
           event.aggregate_id,
           event.aggregate_type,
           event.type AS event_type,
           event.room_seq,
           event.actor_id,
           activity_run.state AS run_state,
           EXISTS (
             SELECT 1 FROM inbox_items
             WHERE inbox_items.event_id = event.event_id
               AND inbox_items.participant_id = ?
           ) AS delivered_to_agent,
           EXISTS (
             SELECT 1 FROM activations
             WHERE activations.activation_id = event.aggregate_id
               AND activations.participant_id = ?
           ) AS agent_activation,
           EXISTS (
             SELECT 1 FROM run_attempts
             WHERE run_attempts.run_attempt_id = event.aggregate_id
               AND run_attempts.participant_id = ?
           ) AS agent_run,
           NULL AS managed_mcp_call_id,
           NULL AS mcp_server_id,
           NULL AS run_attempt_id,
           NULL AS server_name,
           NULL AS tool_name,
           NULL AS state,
           NULL AS completed_at,
           NULL AS failure_code,
           NULL AS is_error
    FROM room_events AS event
    JOIN rooms ON rooms.room_id = event.room_id AND rooms.system_hidden=0
    JOIN memberships AS actor_membership
      ON actor_membership.room_id = event.room_id
    LEFT JOIN run_attempts AS activity_run
      ON event.aggregate_type = 'run_attempt'
     AND activity_run.run_attempt_id = event.aggregate_id
    WHERE ${relevanceSql}
    UNION ALL
    SELECT 'managed_mcp_call' AS source,
           call.managed_mcp_call_id AS activity_id,
           call.created_at,
           call.participant_id,
           call.room_id,
           rooms.kind AS room_kind,
           rooms.name AS room_name,
           rooms.slug AS room_slug,
           NULL AS aggregate_id,
           NULL AS aggregate_type,
           NULL AS event_type,
           NULL AS room_seq,
           NULL AS actor_id,
           NULL AS run_state,
           0 AS delivered_to_agent,
           0 AS agent_activation,
           0 AS agent_run,
           call.managed_mcp_call_id,
           call.mcp_server_id,
           call.run_attempt_id,
           json_extract(revision.definition_json, '$.serverName') AS server_name,
           call.tool_name,
           call.state,
           call.completed_at,
           call.failure_code,
           call.is_error
    FROM managed_mcp_calls AS call
    JOIN rooms ON rooms.room_id = call.room_id AND rooms.system_hidden=0
    JOIN memberships AS actor_membership
      ON actor_membership.room_id = call.room_id
     AND actor_membership.principal_id = ?
    JOIN managed_mcp_server_revisions AS revision
      ON revision.mcp_server_id = call.mcp_server_id
     AND revision.config_version = call.config_version
    WHERE rooms.workspace_id = ?
      AND call.participant_id = ?`;
  const activityParameters: Array<number | string> = [
    participantId,
    participantId,
    participantId,
    ...relevanceParameters,
    actorId,
    workspaceId,
    participantId,
  ];
  let cursorClause = "";
  const pageParameters: Array<number | string> = [...activityParameters];
  if (input.beforeActivityId !== undefined) {
    const cursor = database
      .prepare(
        `WITH agent_activity AS (${activitySql})
         SELECT created_at, activity_id
         FROM agent_activity
         WHERE activity_id = ?`,
      )
      .get(...activityParameters, input.beforeActivityId);
    if (cursor === undefined) {
      throw new NotFoundError("Agent activity cursor was not found");
    }
    cursorClause = `AND (
      created_at < ? OR
      (created_at = ? AND activity_id < ?)
    )`;
    pageParameters.push(
      text(cursor, "created_at"),
      text(cursor, "created_at"),
      text(cursor, "activity_id"),
    );
  }
  pageParameters.push(limit + 1);
  const rows = database
    .prepare(
      `WITH agent_activity AS (${activitySql})
       SELECT * FROM agent_activity
       WHERE 1 = 1 ${cursorClause}
       ORDER BY created_at DESC, activity_id DESC
       LIMIT ?`,
    )
    .all(...pageParameters);
  const hasMore = rows.length > limit;
  const activities = rows
    .slice(0, limit)
    .map((row) => activityRecord(row, participantId, input.agentId));
  return {
    activities,
    ...(hasMore && activities.length > 0
      ? { nextCursor: activities.at(-1)!.activityId }
      : {}),
  };
}

function activityRecord(
  row: Row,
  participantId: string,
  agentId: string,
): AgentActivityRecord {
  if (text(row, "source") === "managed_mcp_call") {
    return managedMcpActivityRecord(row);
  }
  const eventType = text(row, "event_type");
  const relation =
    Number(row.agent_run) === 1 || Number(row.agent_activation) === 1
      ? "runtime"
      : text(row, "aggregate_type") === "agent_definition" &&
          text(row, "aggregate_id") === agentId
        ? "configuration"
        : text(row, "actor_id") === participantId
          ? "performed"
          : "received";
  return AgentActivityRecordSchema.parse({
    activityId: text(row, "activity_id"),
    aggregateId: text(row, "aggregate_id"),
    aggregateType: text(row, "aggregate_type"),
    createdAt: text(row, "created_at"),
    eventType,
    participantId,
    relation,
    roomId: text(row, "room_id"),
    roomKind: text(row, "room_kind"),
    roomName: text(row, "room_name"),
    roomSeq: Number(row.room_seq),
    roomSlug: text(row, "room_slug"),
    source: "room_event",
    tone: activityTone(eventType, nullableText(row, "run_state")),
  });
}

function managedMcpActivityRecord(row: Row): AgentActivityRecord {
  const state = text(row, "state") as "completed" | "failed" | "pending";
  const completedAt = nullableText(row, "completed_at");
  const failureCode = nullableText(row, "failure_code");
  const isError = nullableInteger(row, "is_error");
  return AgentActivityRecordSchema.parse({
    activityId: text(row, "activity_id"),
    ...(completedAt === null ? {} : { completedAt }),
    createdAt: text(row, "created_at"),
    ...(failureCode === null ? {} : { failureCode }),
    ...(isError === null ? {} : { isError: isError === 1 }),
    managedMcpCallId: text(row, "managed_mcp_call_id"),
    mcpServerId: text(row, "mcp_server_id"),
    participantId: text(row, "participant_id"),
    relation: "tool",
    roomId: text(row, "room_id"),
    roomKind: text(row, "room_kind"),
    roomName: text(row, "room_name"),
    roomSlug: text(row, "room_slug"),
    runAttemptId: text(row, "run_attempt_id"),
    serverName: text(row, "server_name"),
    source: "managed_mcp_call",
    state,
    tone:
      state === "pending"
        ? "active"
        : state === "completed" && isError === 0
          ? "success"
          : "error",
    toolName: text(row, "tool_name"),
  });
}

function activityTone(
  eventType: string,
  runState: string | null,
): AgentActivityRecord["tone"] {
  if (
    eventType === "activation.quarantined" ||
    eventType === "activation.retry_blocked" ||
    eventType === "run.orphaned"
  ) {
    return "error";
  }
  if (
    eventType === "activation.retry_scheduled" ||
    eventType === "task.blocked" ||
    eventType === "task.cancelled" ||
    eventType === "agent.disabled"
  ) {
    return "warning";
  }
  if (
    eventType === "activation.leased" ||
    eventType === "activation.retry_resumed" ||
    eventType === "run.created" ||
    eventType === "run.runtime_prepared" ||
    eventType === "run.started" ||
    eventType === "task.claimed" ||
    eventType === "task.started" ||
    eventType === "task.progressed"
  ) {
    return "active";
  }
  if (eventType === "run.finished") {
    if (runState === "exited") return "success";
    if (runState === "cancelled") return "warning";
    return "error";
  }
  if (
    eventType === "activation.finished" ||
    eventType === "task.submitted" ||
    eventType === "task.completed"
  ) {
    return "success";
  }
  return "neutral";
}

export function listRoomAgentRecipients(
  database: DatabaseSync,
  roomId: string,
  reason: ActivationReason,
  excludedParticipantId?: string,
): MessageRecipient[] {
  return database
    .prepare(
      `SELECT principals.principal_id
       FROM memberships
       JOIN principals ON principals.principal_id = memberships.principal_id
       LEFT JOIN agent_definitions
         ON agent_definitions.participant_id = principals.principal_id
       WHERE memberships.room_id = ? AND principals.kind = 'agent'
         AND (agent_definitions.state IS NULL OR agent_definitions.state = 'enabled')
       ORDER BY principals.principal_id`,
    )
    .all(roomId)
    .filter((row) => text(row, "principal_id") !== excludedParticipantId)
    .map((row) => ({
      participantId: text(row, "principal_id"),
      reason,
    }));
}

export function humanRoomMessageRecipients(
  database: DatabaseSync,
  principal: Principal,
  input: HumanRoomMessageInput,
): MessageRecipient[] {
  if (principal.kind !== "human") {
    throw new ForbiddenError(
      "Room membership delivery requires a Human principal",
    );
  }
  const recipients = new Map(
    listRoomAgentRecipients(database, input.roomId, "room_policy").map(
      (recipient) => [recipient.participantId, recipient] as const,
    ),
  );
  for (const recipient of input.recipients ?? []) {
    if (!recipients.has(recipient.participantId)) {
      throw new ForbiddenError(
        `Room attention recipient ${recipient.participantId} must be a joined Agent`,
      );
    }
    recipients.set(recipient.participantId, recipient);
  }
  return [...recipients.values()];
}

export function listRoomAgentActivity(
  database: DatabaseSync,
  actorId: string,
  roomId: string,
): RoomAgentActivity[] {
  requireRoomMember(database, roomId, actorId);
  return database
    .prepare(
      `SELECT principals.principal_id, memberships.joined_at
       FROM memberships
       JOIN principals ON principals.principal_id = memberships.principal_id
       WHERE memberships.room_id = ? AND principals.kind = 'agent'
       ORDER BY principals.principal_id`,
    )
    .all(roomId)
    .map((memberRow) =>
      agentActivity(
        database,
        roomId,
        text(memberRow, "principal_id"),
        memberRow,
      ),
    );
}

function agentActivity(
  database: DatabaseSync,
  roomId: string,
  participantId: string,
  memberRow: Row,
): RoomAgentActivity {
  const activationRow = database
    .prepare(
      `SELECT * FROM activations
       WHERE room_id = ? AND participant_id = ?
         AND state IN ('queued', 'leased', 'quarantined')
       ORDER BY CASE state
         WHEN 'quarantined' THEN 0
         WHEN 'leased' THEN 1
         ELSE 2
       END, created_at DESC, activation_id DESC
       LIMIT 1`,
    )
    .get(roomId, participantId);
  if (activationRow === undefined) {
    return RoomAgentActivitySchema.parse({
      participantId,
      roomId,
      state: "idle",
      updatedAt: text(memberRow, "joined_at"),
    });
  }
  const activationId = text(activationRow, "activation_id");
  const activationState = text(activationRow, "state");
  const runRow = database
    .prepare(
      `SELECT * FROM run_attempts
       WHERE activation_id = ?
       ORDER BY attempt_number DESC
       LIMIT 1`,
    )
    .get(activationId);
  const runState = runRow === undefined ? undefined : text(runRow, "state");
  const lastError =
    nullableText(activationRow, "last_error") ??
    (runRow === undefined
      ? undefined
      : (nullableText(runRow, "error") ?? undefined));
  const state =
    activationState === "quarantined" ||
    lastError !== undefined ||
    runState === "orphaned" ||
    runState === "failed" ||
    runState === "timed_out"
      ? "error"
      : activationState === "queued" || runState === "starting"
        ? "waking"
        : "working";
  return RoomAgentActivitySchema.parse({
    activationId,
    ...(lastError === undefined ? {} : { lastError }),
    participantId,
    roomId,
    ...(runRow === undefined
      ? {}
      : { runAttemptId: text(runRow, "run_attempt_id") }),
    state,
    updatedAt: text(activationRow, "updated_at"),
  });
}
