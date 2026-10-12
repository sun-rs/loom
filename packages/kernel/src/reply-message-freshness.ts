import type { DatabaseSync } from "node:sqlite";
import { NOT_SYSTEM_NOTICE_SQL } from "./freshness-hold-context.ts";

/** Kernel-owned ordinary reply policy, shared by Worker and Host publication.
 * Excluding a peer append never advances the caller's read floor.
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
  // must not hide an earlier Human correction or attachment.
  const rows = database
    .prepare(
      `SELECT messages.actor_id,
        messages.attachments_json, room_events.room_seq, room_events.event_id, room_events.payload_json,
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
      row.actor_id === input.actorId &&
      row.attachments_json === "[]" &&
      JSON.parse(String(row.payload_json)).attachmentComment === undefined &&
      database
        .prepare(
          `SELECT 1 FROM worker_run_message_writes w
        JOIN run_attempts r ON r.run_attempt_id=w.run_attempt_id
        JOIN activations a ON a.activation_id=r.activation_id
        LEFT JOIN role_instance_sessions ss ON ss.instance_id=r.participant_id
        WHERE w.event_id=? AND r.participant_id=? AND r.room_id=?
          AND r.state='exited' AND (r.exit_code=0 OR r.exit_code IS NULL)
          AND a.state='completed'
          AND w.session_generation=COALESCE(ss.generation,0)
        LIMIT 1`,
        )
        .get(String(row.event_id), input.actorId, input.roomId)
    )
      continue;
    if (
      allowPeerAppend &&
      row.peer_instance_id !== null &&
      row.actor_id !== input.actorId &&
      row.attachments_json === "[]"
    ) {
      const payload = JSON.parse(String(row.payload_json)) as {
        attachmentComment?: unknown;
      };
      // Peer addressing still owns delivery, never synthetic read progress.
      // Ordinary chat may finish before a queued peer correction is read.
      if (payload.attachmentComment === undefined) continue;
    }
    return Number(row.room_seq);
  }
  return 0;
}
