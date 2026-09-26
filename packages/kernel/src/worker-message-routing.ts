import type { DatabaseSync } from "node:sqlite";

import {
  messageMentionCandidates,
  unresolvedMentionHandles,
  type ActivationCredentialScope,
  type WorkerMessagePostRequest,
} from "@rah-os/protocol";

import type { MessageRecipient } from "./collaboration-service.ts";
import { integer, nullableText, text } from "./sqlite-row.ts";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  StaleContextError,
} from "./errors.ts";
import {
  requireWorkerRoomVisibility,
  wasTaskCreatedByWorkerRun,
} from "./worker-task-scope.ts";

/**
 * The Agents an Agent author may address by `@handle`. The membership and
 * enablement predicate mirrors `listRoomAgentRecipients`: a mention never
 * reaches outside the Room and never wakes a disabled Agent. Humans are not
 * Activation recipients, so only Agent members are mentionable.
 */
function mentionableRoomAgentHandles(
  database: DatabaseSync,
  roomId: string,
  excludedParticipantId: string,
): Map<string, string> {
  const byHandle = new Map<string, string>();
  for (const row of database
    .prepare(
      `SELECT principals.principal_id, principals.handle
       FROM memberships
       JOIN principals ON principals.principal_id = memberships.principal_id
       LEFT JOIN agent_definitions
         ON agent_definitions.participant_id = principals.principal_id
       WHERE memberships.room_id = ? AND principals.kind = 'agent'
         AND (agent_definitions.state IS NULL OR agent_definitions.state = 'enabled')
       ORDER BY principals.principal_id`,
    )
    .all(roomId)) {
    const participantId = text(row, "principal_id");
    if (participantId === excludedParticipantId) continue;
    byHandle.set(text(row, "handle"), participantId);
  }
  return byHandle;
}

/** Server-side resolution of `@handle` prose written by an Agent author. */
export function workerMentionRecipients(input: {
  body?: string | undefined;
  database: DatabaseSync;
  participantId: string;
  roomId: string;
}): MessageRecipient[] {
  if (input.body === undefined || input.body.trim().length === 0) return [];
  const byHandle = mentionableRoomAgentHandles(
    input.database,
    input.roomId,
    input.participantId,
  );
  if (byHandle.size === 0) return [];
  const mentioned = new Set<string>();
  for (const candidate of messageMentionCandidates(input.body, [
    ...byHandle.keys(),
  ])) {
    const participantId = byHandle.get(candidate.handle);
    if (participantId !== undefined) mentioned.add(participantId);
  }
  return [...mentioned].map((participantId) => ({
    participantId,
    reason: "mention" as const,
  }));
}

/**
 * The `@tokens` an author wrote that woke nobody in this Room: no member handle
 * matched, or the only matches were case/NFKC-equivalent and failed closed. The
 * author's own handle stays in the directory, so a self-mention — which the
 * standing prompt already states is ignored — is not reported here.
 *
 * Raft reports the same condition as `unresolvedMentionHandles` on the send
 * response and then raises MENTION_DELIVERY_FAILED, keeping the message queued.
 */
export function workerUnresolvedMentionHandles(input: {
  body?: string | undefined;
  database: DatabaseSync;
  roomId: string;
}): string[] {
  if (input.body === undefined || input.body.trim().length === 0) return [];
  return unresolvedMentionHandles(input.body, [
    ...mentionableRoomAgentHandles(input.database, input.roomId, "").keys(),
  ]);
}

/**
 * evo §37 A: an instance author wakes other instances only by an explicit
 * `@handle`. Room policy, Thread followers, the reply chain and the Thread
 * root never route an instance's message (Multica `comment.go:2685`: agent
 * authors skip implicit routing). The Kernel attention derivation enforces the
 * same rule for every facade (`instance-wake-guard.ts`).
 */
export function workerReplyRecipients(input: {
  body?: string | undefined;
  database: DatabaseSync;
  participantId: string;
  roomId: string;
}): MessageRecipient[] {
  return workerMentionRecipients(input).sort((left, right) =>
    left.participantId.localeCompare(right.participantId),
  );
}

/** Resolve an explicit Raft-style target inside the authenticated Room. The
 * HTTP facade separately proves the complete sync cursor before mutations. */
export function resolveWorkerReplyRoute(context: {
  database: DatabaseSync;
  scope: ActivationCredentialScope;
  input: WorkerMessagePostRequest;
}): {
  recipients: MessageRecipient[];
  threadId?: string;
  unresolvedMentionHandles: string[];
} {
  const { database, scope, input } = context;
  requireWorkerRoomVisibility(database, scope);
  if (input.basedOnRoomSeq !== scope.toSeq)
    throw new StaleContextError(input.basedOnRoomSeq, scope.toSeq);
  const causalRow = database
    .prepare("SELECT * FROM room_events WHERE room_id = ? AND room_seq = ?")
    .get(scope.roomId, scope.toSeq);
  if (causalRow === undefined)
    throw new NotFoundError("Activation causal event was not found");
  let threadId: string | undefined;
  const held =
    input.heldDraftId === undefined
      ? undefined
      : database
          .prepare("SELECT * FROM held_message_drafts WHERE held_draft_id = ?")
          .get(input.heldDraftId);
  if (held !== undefined) {
    if (
      text(held, "room_id") !== scope.roomId ||
      text(held, "participant_id") !== scope.participantId
    )
      throw new ForbiddenError(
        "Held draft is outside this Worker execution scope",
      );
    threadId = nullableText(held, "thread_id") ?? undefined;
    if (
      input.threadId !== undefined &&
      (input.threadId ?? undefined) !== threadId
    )
      throw new ForbiddenError("Held draft target cannot be changed");
  } else if (input.threadId !== undefined) {
    threadId = input.threadId ?? undefined;
  } else {
    const targets = database
      .prepare(
        `SELECT
        COALESCE(tasks.thread_id, json_extract(room_events.payload_json, '$.threadId')) AS reply_thread_id,
        MAX(room_events.room_seq) AS latest_seq
      FROM room_events
      JOIN inbox_items ON inbox_items.event_id=room_events.event_id AND inbox_items.participant_id=?
      JOIN activations ON activations.activation_id=?
      LEFT JOIN tasks ON room_events.aggregate_type='task' AND tasks.task_id=room_events.aggregate_id
      WHERE room_events.room_id=? AND room_events.room_seq BETWEEN activations.from_seq AND activations.to_seq
      GROUP BY reply_thread_id ORDER BY reply_thread_id`,
      )
      .all(scope.participantId, scope.activationId, scope.roomId);
    if (targets.length > 1) {
      // A coalesced Activation spanning several Threads has no defensible
      // default: guessing the last one is crosstalk. Name the candidates so the
      // Agent can retry with an explicit `threadId` (or null for the Room).
      const candidates = targets
        .map(
          (target) =>
            nullableText(target, "reply_thread_id") ?? "null (the Room)",
        )
        .join(", ");
      throw new ConflictError(
        `Coalesced messages require an explicit reply target: threadId or null for the Room. This Activation delivered ${targets.length} candidates: ${candidates}`,
      );
    }
    if (targets.length === 1)
      threadId = nullableText(targets[0]!, "reply_thread_id") ?? undefined;
  }
  if (threadId !== undefined) {
    const thread = database
      .prepare(
        `SELECT threads.*, room_events.room_seq, room_events.aggregate_id AS creation_task_id,
        room_events.type AS creation_type FROM threads
      JOIN room_events ON room_events.room_id=threads.room_id AND room_events.type IN ('thread.created','task.created') AND json_extract(room_events.payload_json, '$.threadId')=threads.thread_id
      WHERE threads.thread_id=? AND threads.room_id=? ORDER BY room_events.room_seq LIMIT 1`,
      )
      .get(threadId, scope.roomId);
    if (thread === undefined)
      throw new ForbiddenError("Thread is outside this Worker execution scope");
    const creationSeq = integer(thread, "room_seq");
    const ownTaskThread =
      text(thread, "creation_type") === "task.created" &&
      wasTaskCreatedByWorkerRun(
        database,
        scope,
        text(thread, "creation_task_id"),
      );
    if (creationSeq > scope.toSeq && !ownTaskThread)
      throw new StaleContextError(scope.toSeq, integer(thread, "room_seq"));
  }
  const body =
    input.body ?? (held === undefined ? undefined : text(held, "body"));
  return {
    recipients: workerReplyRecipients({
      database,
      participantId: scope.participantId,
      roomId: scope.roomId,
      ...(body === undefined ? {} : { body }),
    }),
    ...(threadId === undefined ? {} : { threadId }),
    unresolvedMentionHandles: workerUnresolvedMentionHandles({
      database,
      roomId: scope.roomId,
      ...(body === undefined ? {} : { body }),
    }),
  };
}
