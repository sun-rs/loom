import type { DatabaseSync } from "node:sqlite";

import {
  RoomAgentActivitySchema,
  type ActivationReason,
  type RoomAgentActivity,
} from "@rah-os/protocol";

import { ForbiddenError } from "./errors.ts";
import { requireRoomMember } from "./collaboration-policy.ts";
import type { MessageRecipient } from "./collaboration-service.ts";
import { nullableText, text, type Row } from "./sqlite-row.ts";
import type { Principal } from "./types.ts";

export type HumanRoomMessageInput = {
  basedOnRoomSeq?: number;
  body: string;
  idempotencyKey: string;
  recipients: MessageRecipient[];
  roomId: string;
};

export function listAgentCatalogRows(
  database: DatabaseSync,
  actorId: string,
  controlRoomId?: string,
): Row[] {
  return database
    .prepare(
      `SELECT
         agent_definitions.*,
         agent_definition_revisions.definition_json,
         principals.handle
       FROM agent_definitions
       JOIN agent_definition_revisions
         ON agent_definition_revisions.agent_definition_revision_id =
            agent_definitions.current_revision_id
       JOIN principals
         ON principals.principal_id = agent_definitions.participant_id
       JOIN memberships
         ON memberships.room_id = agent_definitions.control_room_id
        AND memberships.principal_id = ?
       WHERE agent_definitions.state <> 'tombstoned'
         AND (? IS NULL OR agent_definitions.control_room_id = ?)
       ORDER BY principals.handle, agent_definitions.agent_definition_id`,
    )
    .all(actorId, controlRoomId ?? null, controlRoomId ?? null);
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
       WHERE memberships.room_id = ? AND principals.kind = 'agent'
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
  for (const recipient of input.recipients) {
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
