import type { DatabaseSync } from "node:sqlite";
import { messageHasBroadcastMention } from "@rah-os/protocol";
import { NOT_SYSTEM_NOTICE_SQL } from "./freshness-hold-context.ts";

/** Kernel-owned ordinary reply policy, shared by Worker and Host publication.
 * Excluding an unrelated peer append never advances the caller's read floor.
 * Task/Review/state mutations keep their existing freshness owners. */
export function latestBlockingReplyMessageSeq(
  database: DatabaseSync,
  input: {
    roomId: string;
    threadId?: string | undefined;
    actorId: string;
    afterSeq: number;
    finalOutputRunAttemptId?: string | undefined;
    ordinaryReply: boolean;
  },
): number {
  const allowPeerAppend =
    input.ordinaryReply &&
    database
      .prepare(
        "SELECT 1 FROM role_instances WHERE instance_id=? AND channel_id=?",
      )
      .get(input.actorId, input.roomId) !== undefined;
  // Inspect only new target messages, newest first. A later ordinary peer post
  // must not hide an earlier Human correction or explicit request.
  const rows = database
    .prepare(
      `SELECT messages.actor_id, messages.body, messages.mentions_json,
        messages.attachments_json, room_events.room_seq, room_events.payload_json,
        peer.instance_id AS peer_instance_id
      FROM messages JOIN room_events
        ON room_events.room_id=messages.room_id
          AND room_events.aggregate_id=messages.message_id
          AND room_events.type='message.posted'
      LEFT JOIN role_instances peer
        ON peer.instance_id=messages.actor_id AND peer.channel_id=messages.room_id
      WHERE messages.room_id=? AND messages.thread_id IS ?
        AND room_events.room_seq>? AND ${NOT_SYSTEM_NOTICE_SQL}
        AND NOT (messages.actor_id=? AND EXISTS (
          SELECT 1 FROM worker_run_message_writes w
          JOIN run_attempts r ON r.run_attempt_id=w.run_attempt_id
          WHERE w.event_id=room_events.event_id AND w.run_attempt_id=?
            AND r.participant_id=messages.actor_id AND r.room_id=messages.room_id))
      ORDER BY room_events.room_seq DESC`,
    )
    .iterate(
      input.roomId,
      input.threadId ?? null,
      input.afterSeq,
      input.actorId,
      input.finalOutputRunAttemptId ?? null,
    );
  for (const row of rows) {
    if (
      allowPeerAppend &&
      row.peer_instance_id !== null &&
      row.actor_id !== input.actorId &&
      row.attachments_json === "[]" &&
      !messageHasBroadcastMention(String(row.body))
    ) {
      const payload = JSON.parse(String(row.payload_json)) as {
        attachmentComment?: unknown;
        recipients?: { participantId?: string; reason?: string }[];
      };
      const mentions: unknown = JSON.parse(String(row.mentions_json ?? "null"));
      // Bindings are immutable Principal IDs, not a rematch against today's
      // handle. Unknown historical addressing stays blocking.
      if (
        payload.attachmentComment === undefined &&
        Array.isArray(mentions) &&
        !mentions.some((mention) => mention?.principalId === input.actorId) &&
        Array.isArray(payload.recipients) &&
        !payload.recipients.some(
          (recipient) =>
            recipient.participantId === input.actorId &&
            recipient.reason === "mention",
        )
      )
        continue;
    }
    return Number(row.room_seq);
  }
  return 0;
}
