import type { DatabaseSync } from "node:sqlite";
import { messageHasBroadcastMention } from "@rah-os/protocol";
import { bindMessageMentions } from "./identity-accounts.ts";
import { text, jsonObject } from "./sqlite-row.ts";
import { instanceSessionState } from "./instance-session.ts";

/** Kernel-owned, single-hop return of a final to one authenticated requester.
 * Evidence lives in the existing Room event; this is not a second queue. */
export function peerReplyReturn(
  database: DatabaseSync,
  input: {
    runAttemptId: string | undefined;
    activationId: string;
    participantId: string;
    roomId: string;
    messageId: string;
  },
): { sourceEventId: string; participantId: string } | undefined {
  if (!input.runAttemptId) return;
  const run = database
    .prepare(
      `SELECT a.from_seq,a.to_seq
    FROM run_attempts r JOIN activations a ON a.activation_id=r.activation_id
    JOIN role_instances i ON i.instance_id=r.participant_id
    JOIN rooms room ON room.room_id=r.room_id
    WHERE r.run_attempt_id=? AND r.activation_id=? AND r.participant_id=?
      AND r.room_id=? AND room.kind='channel' AND i.channel_id=r.room_id
      AND r.state IN ('starting','running')`,
    )
    .get(
      input.runAttemptId,
      input.activationId,
      input.participantId,
      input.roomId,
    );
  if (!run) return;
  bindMessageMentions(database, input.messageId);
  const message = database
    .prepare("SELECT * FROM messages WHERE message_id=?")
    .get(input.messageId)!;
  if (
    message.thread_id !== null ||
    message.attachments_json !== "[]" ||
    JSON.parse(String(message.mentions_json ?? "[]")).length ||
    messageHasBroadcastMention(text(message, "body"))
  )
    return;
  // Do not infer a requester from catch-up history, or choose between wakes.
  const sources = database
    .prepare(
      `SELECT e.* FROM inbox_items n
    JOIN room_events e ON e.event_id=n.event_id
    WHERE n.room_id=? AND n.participant_id=? AND n.event_seq BETWEEN ? AND ?
    ORDER BY n.event_seq LIMIT 2`,
    )
    .all(input.roomId, input.participantId, run.from_seq!, run.to_seq!);
  if (sources.length !== 1) return;
  const source = sources[0]!,
    payload = jsonObject(source, "payload_json");
  if (
    source.type !== "message.posted" ||
    payload.replyReturn ||
    payload.threadId ||
    payload.attachmentComment ||
    (Array.isArray(payload.attachments) && payload.attachments.length) ||
    typeof payload.body !== "string" ||
    messageHasBroadcastMention(payload.body)
  )
    return;
  const mentions = payload.mentions as { principalId: string }[] | undefined;
  if (
    mentions?.length !== 1 ||
    mentions[0]?.principalId !== input.participantId
  )
    return;
  const requester = text(source, "actor_id");
  const provenance = database
    .prepare(
      `SELECT w.session_generation FROM worker_run_message_writes w
    JOIN run_attempts r ON r.run_attempt_id=w.run_attempt_id
    WHERE w.event_id=? AND r.participant_id=? AND r.room_id=?`,
    )
    .get(text(source, "event_id"), requester, input.roomId);
  if (
    provenance?.session_generation !==
    instanceSessionState(database, requester).generation
  )
    return;
  if (
    requester === input.participantId ||
    !database
      .prepare(
        `SELECT 1 FROM role_instances i
    JOIN memberships m ON m.principal_id=i.instance_id AND m.room_id=i.channel_id
    JOIN agent_definitions a ON a.participant_id=i.instance_id
    WHERE i.instance_id=? AND i.channel_id=? AND a.state='enabled'`,
      )
      .get(requester, input.roomId)
  )
    return;
  // Exact current-run transport evidence; neither a high-water cursor nor a
  // notification alone proves the request was delivered to this execution.
  if (
    !database
      .prepare(
        `SELECT 1 FROM activation_presented_windows w,
      json_each(w.presented_seqs_json) s
    WHERE w.activation_id=? AND w.run_attempt_id=? AND w.sent_at IS NOT NULL
      AND s.value=?`,
      )
      .get(input.activationId, input.runAttemptId, source.room_seq!)
  )
    return;
  // At most one return for the request, including explicit earlier replies.
  if (
    database
      .prepare(
        `SELECT 1 FROM room_events e WHERE e.room_id=?
      AND e.type='message.posted' AND e.actor_id=? AND (
        json_extract(e.payload_json,'$.replyReturn.sourceEventId')=? OR (
          json_extract(e.payload_json,'$.activationId')=? AND EXISTS (
            SELECT 1 FROM json_each(e.payload_json,'$.mentions') m
            WHERE json_extract(m.value,'$.principalId')=?))) LIMIT 1`,
      )
      .get(
        input.roomId,
        input.participantId,
        text(source, "event_id"),
        input.activationId,
        requester,
      )
  )
    return;
  return { sourceEventId: text(source, "event_id"), participantId: requester };
}
