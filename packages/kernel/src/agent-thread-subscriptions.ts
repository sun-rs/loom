import type { DatabaseSync } from "node:sqlite";

import type {
  ActivationCredentialScope,
  ActivationReason,
  WorkerThreadUnfollowRequest,
  WorkerThreadUnfollowResponse,
} from "@rah-os/protocol";

import {
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
  StaleContextError,
} from "./errors.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { text } from "./sqlite-row.ts";

export type AgentThreadRecipient = {
  participantId: string;
  reason: ActivationReason;
};

export type AgentThreadFollowSource = "mention" | "participation";

export function followAgentThreadParticipants(
  database: DatabaseSync,
  input: {
    participantIds: readonly string[];
    source: AgentThreadFollowSource;
    threadId: string;
    updatedAt: string;
  },
): void {
  const update = database.prepare(
    `INSERT INTO agent_thread_follows(
       participant_id, thread_id, following, source, updated_at
     ) VALUES(?, ?, 1, ?, ?)
     ON CONFLICT(participant_id, thread_id) DO UPDATE SET
       following = 1,
       source = excluded.source,
       updated_at = excluded.updated_at`,
  );
  for (const participantId of [...new Set(input.participantIds)]) {
    const eligible = database
      .prepare(
        `SELECT 1
         FROM threads
         JOIN memberships ON memberships.room_id = threads.room_id
         JOIN principals ON principals.principal_id = memberships.principal_id
         LEFT JOIN agent_definitions
           ON agent_definitions.participant_id = principals.principal_id
         WHERE threads.thread_id = ?
           AND principals.principal_id = ?
           AND principals.kind = 'agent'
           AND (agent_definitions.state IS NULL OR agent_definitions.state = 'enabled')`,
      )
      .get(input.threadId, participantId);
    if (eligible !== undefined) {
      update.run(participantId, input.threadId, input.source, input.updatedAt);
    }
  }
}

export function listFollowingAgentThreadRecipients(
  database: DatabaseSync,
  input: {
    excludedParticipantId?: string;
    roomId: string;
    threadId: string;
  },
): AgentThreadRecipient[] {
  return database
    .prepare(
      `SELECT follows.participant_id
       FROM agent_thread_follows AS follows
       JOIN threads ON threads.thread_id = follows.thread_id
       JOIN memberships
         ON memberships.room_id = threads.room_id
        AND memberships.principal_id = follows.participant_id
       JOIN principals ON principals.principal_id = follows.participant_id
       LEFT JOIN agent_definitions
         ON agent_definitions.participant_id = follows.participant_id
       WHERE follows.thread_id = ?
         AND threads.room_id = ?
         AND follows.following = 1
         AND principals.kind = 'agent'
         AND (agent_definitions.state IS NULL OR agent_definitions.state = 'enabled')
       ORDER BY follows.participant_id`,
    )
    .all(input.threadId, input.roomId)
    .map((row) => text(row, "participant_id"))
    .filter((participantId) => participantId !== input.excludedParticipantId)
    .map((participantId) => ({
      participantId,
      reason: "thread_subscription" as const,
    }));
}

export function unfollowAgentThread(
  database: DatabaseSync,
  input: {
    participantId: string;
    roomId: string;
    threadId: string;
    updatedAt: string;
  },
): void {
  const thread = database
    .prepare("SELECT room_id FROM threads WHERE thread_id = ?")
    .get(input.threadId);
  if (thread === undefined) {
    throw new NotFoundError(`Thread ${input.threadId} was not found`);
  }
  if (text(thread, "room_id") !== input.roomId) {
    throw new ForbiddenError(
      `Thread ${input.threadId} does not belong to the active Room`,
    );
  }
  const participant = database
    .prepare(
      `SELECT 1
       FROM principals
       JOIN memberships ON memberships.principal_id = principals.principal_id
       WHERE principals.principal_id = ?
         AND principals.kind = 'agent'
         AND memberships.room_id = ?`,
    )
    .get(input.participantId, input.roomId);
  if (participant === undefined) {
    throw new ForbiddenError("only a joined Agent may unfollow a Thread");
  }
  database
    .prepare(
      `INSERT INTO agent_thread_follows(
         participant_id, thread_id, following, source, updated_at
       ) VALUES(?, ?, 0, 'explicit_unfollow', ?)
       ON CONFLICT(participant_id, thread_id) DO UPDATE SET
         following = 0,
         source = 'explicit_unfollow',
         updated_at = excluded.updated_at`,
    )
    .run(input.participantId, input.threadId, input.updatedAt);
}

export function unfollowWorkerThreadTransaction(input: {
  command: WorkerThreadUnfollowRequest;
  database: DatabaseSync;
  events: RoomEventWriter;
  scope: ActivationCredentialScope;
  updatedAt: string;
}): WorkerThreadUnfollowResponse {
  const previous = input.database
    .prepare(
      "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
    )
    .get(input.scope.roomId, input.command.idempotencyKey);
  if (previous !== undefined) {
    const event = input.events.eventFromRow(previous);
    if (
      event.type !== "thread.unfollowed" ||
      event.actorId !== input.scope.participantId ||
      event.payload.activationId !== input.scope.activationId ||
      event.payload.basedOnRoomSeq !== input.command.basedOnRoomSeq ||
      event.payload.threadId !== input.command.threadId
    ) {
      throw new IdempotencyConflictError(
        `idempotency key ${input.command.idempotencyKey} was already used for another mutation`,
      );
    }
    return {
      deduplicated: true,
      event,
      following: false,
      threadId: input.command.threadId,
    };
  }
  const causalEventRow = input.database
    .prepare("SELECT * FROM room_events WHERE room_id = ? AND room_seq = ?")
    .get(input.scope.roomId, input.command.basedOnRoomSeq);
  if (causalEventRow === undefined) {
    throw new NotFoundError(
      `causal event ${input.scope.roomId}:${String(input.command.basedOnRoomSeq)} was not found`,
    );
  }
  const causalEvent = input.events.eventFromRow(causalEventRow);
  const isActivationCursor = input.command.basedOnRoomSeq === input.scope.toSeq;
  const isOwnActivationOutput =
    causalEvent.actorId === input.scope.participantId &&
    causalEvent.type === "message.posted" &&
    causalEvent.payload.activationId === input.scope.activationId;
  if (!isActivationCursor && !isOwnActivationOutput) {
    throw new StaleContextError(
      input.command.basedOnRoomSeq,
      input.scope.toSeq,
    );
  }
  unfollowAgentThread(input.database, {
    participantId: input.scope.participantId,
    roomId: input.scope.roomId,
    threadId: input.command.threadId,
    updatedAt: input.updatedAt,
  });
  const event = input.events.append({
    actorId: input.scope.participantId,
    aggregateId: input.command.threadId,
    aggregateType: "thread",
    idempotencyKey: input.command.idempotencyKey,
    payload: {
      activationId: input.scope.activationId,
      basedOnRoomSeq: input.command.basedOnRoomSeq,
      following: false,
      threadId: input.command.threadId,
    },
    roomId: input.scope.roomId,
    type: "thread.unfollowed",
  });
  return {
    deduplicated: false,
    event,
    following: false,
    threadId: input.command.threadId,
  };
}

export function backfillAgentThreadFollows(
  database: DatabaseSync,
  updatedAt: string,
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO agent_thread_follows(
         participant_id, thread_id, following, source, updated_at
       )
       SELECT messages.actor_id, messages.thread_id, 1, 'participation',
              COALESCE(MAX(messages.created_at), ?)
       FROM messages
       JOIN principals ON principals.principal_id = messages.actor_id
       JOIN threads ON threads.thread_id = messages.thread_id
       JOIN memberships
         ON memberships.room_id = threads.room_id
        AND memberships.principal_id = messages.actor_id
       WHERE messages.thread_id IS NOT NULL AND principals.kind = 'agent'
       GROUP BY messages.actor_id, messages.thread_id`,
    )
    .run(updatedAt);

  database
    .prepare(
      `INSERT OR IGNORE INTO agent_thread_follows(
         participant_id, thread_id, following, source, updated_at
       )
       SELECT recipients.value,
              json_extract(events.payload_json, '$.threadId'),
              1,
              'mention',
              COALESCE(MAX(events.created_at), ?)
       FROM room_events AS events,
            json_each(events.payload_json, '$.recipientIds') AS recipients
       JOIN threads
         ON threads.thread_id = json_extract(events.payload_json, '$.threadId')
       JOIN principals ON principals.principal_id = recipients.value
       JOIN memberships
         ON memberships.room_id = threads.room_id
        AND memberships.principal_id = recipients.value
       WHERE json_type(events.payload_json, '$.recipientIds') = 'array'
         AND json_type(events.payload_json, '$.threadId') = 'text'
         AND principals.kind = 'agent'
       GROUP BY recipients.value, json_extract(events.payload_json, '$.threadId')`,
    )
    .run(updatedAt);
}
