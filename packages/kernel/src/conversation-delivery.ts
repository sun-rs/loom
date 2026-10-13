import type { DatabaseSync } from "node:sqlite";
import type { ActivationCredentialScope, RoomEvent } from "@rah-os/protocol";
import { instanceSessionState } from "./instance-session.ts";
import { integer, text } from "./sqlite-row.ts";

/** Frozen automatic-delivery selection, not an ACL or another cursor. */
export type ConversationDelivery = {
  floors: Record<string, number>;
  directed: number[];
  eventFloor?: number;
  /** One bounded restore per Room after an explicit Human session reset. */
  recoveryGeneration?: number;
};

export function conversationDelivery(
  db: DatabaseSync,
  scope: ActivationCredentialScope,
): ConversationDelivery | undefined {
  const stored = db
    .prepare(
      `SELECT catch_up_json FROM activation_presented_windows
    WHERE activation_id=? AND consumer_id=? AND run_attempt_id=?`,
    )
    .get(scope.activationId, scope.consumerId, scope.runAttemptId);
  if (stored)
    return JSON.parse(String(stored.catch_up_json ?? "{}")).conversations;
  const joined = db
    .prepare(
      `SELECT e.room_seq, e.payload_json FROM role_instances i
    JOIN room_events e ON e.aggregate_id=i.instance_id AND e.type='instance.created'
    JOIN memberships m ON m.room_id=i.channel_id AND m.principal_id=i.instance_id
    WHERE i.instance_id=? AND i.channel_id=? AND e.room_id=i.channel_id`,
    )
    .get(scope.participantId, scope.roomId);
  const session = instanceSessionState(db, scope.participantId);
  const restore =
    session.generation > 0 &&
    !(
      session.required &&
      db
        .prepare(
          `SELECT 1 FROM activation_presented_windows w
    JOIN activations a ON a.activation_id=w.activation_id WHERE a.participant_id=? AND a.room_id=?
    AND w.sent_at IS NOT NULL AND json_extract(w.catch_up_json,'$.conversations.recoveryGeneration')=? LIMIT 1`,
        )
        .get(scope.participantId, scope.roomId, session.generation)
    ) &&
    Boolean(
      db
        .prepare(
          `SELECT 1 FROM room_events WHERE aggregate_id=? AND type='instance.session_reset'
      AND json_extract(payload_json,'$.sessionGeneration')=?
      AND json_extract(payload_json,'$.historyRecovery')='bounded_current_room' LIMIT 1`,
        )
        .get(scope.participantId, session.generation),
    );
  if (!joined) {
    // The execution scope was authenticated by the caller. Never look across
    // Rooms: private-box context cannot leak into Channel work.
    if (
      !restore ||
      !db
        .prepare(
          `SELECT 1 FROM role_instances i JOIN rooms r ON r.room_id=? WHERE i.instance_id=? AND r.kind='direct'`,
        )
        .get(scope.roomId, scope.participantId)
    )
      return undefined;
    const floors: Record<string, number> = { "": 0 };
    for (const row of db
      .prepare("SELECT thread_id FROM threads WHERE room_id=?")
      .all(scope.roomId))
      floors[text(row, "thread_id")] = 0;
    return {
      floors,
      directed: [],
      eventFloor: Math.min(
        Number(
          db
            .prepare(
              "SELECT last_seq FROM subscription_cursors WHERE participant_id=? AND room_id=? AND consumer_id=?",
            )
            .get(scope.participantId, scope.roomId, scope.consumerId)
            ?.last_seq ?? 0,
        ),
        Number(
          db
            .prepare("SELECT from_seq FROM activations WHERE activation_id=?")
            .get(scope.activationId)!.from_seq,
        ) - 1,
      ),
      recoveryGeneration: session.generation,
    };
  }
  const origin = integer(joined, "room_seq");
  const floors: Record<string, number> = { "": origin };
  for (const row of db
    .prepare(
      `SELECT f.thread_id FROM agent_thread_follows f
    JOIN threads t ON t.thread_id=f.thread_id WHERE f.participant_id=? AND f.following=1 AND t.room_id=?`,
    )
    .all(scope.participantId, scope.roomId))
    floors[text(row, "thread_id")] = origin;
  const directed: number[] = [];
  for (const row of db
    .prepare(
      `SELECT e.room_seq,COALESCE(m.thread_id,t.thread_id) AS thread_id FROM inbox_items i
    JOIN room_events e ON e.event_id=i.event_id LEFT JOIN messages m ON m.message_id=e.aggregate_id LEFT JOIN tasks t ON t.task_id=e.aggregate_id
    WHERE i.participant_id=? AND i.room_id=? AND e.room_seq BETWEEN
    (SELECT from_seq FROM activations WHERE activation_id=?) AND ?`,
    )
    .all(scope.participantId, scope.roomId, scope.activationId, scope.toSeq)) {
    directed.push(integer(row, "room_seq"));
    if (typeof row.thread_id === "string") floors[row.thread_id] ??= origin;
  }
  for (const row of db
    .prepare(
      `SELECT thread_key,through_room_seq FROM worker_target_read_positions
    WHERE participant_id=? AND room_id=?`,
    )
    .all(scope.participantId, scope.roomId)) {
    const key = text(row, "thread_key");
    if (Object.hasOwn(floors, key))
      floors[key] = Math.max(origin, integer(row, "through_room_seq"));
  }
  const cursor = db
    .prepare(
      "SELECT last_seq FROM subscription_cursors WHERE participant_id=? AND room_id=? AND consumer_id=?",
    )
    .get(scope.participantId, scope.roomId, scope.consumerId);
  const activation = db
    .prepare("SELECT from_seq FROM activations WHERE activation_id=?")
    .get(scope.activationId)!;
  if (restore) for (const key of Object.keys(floors)) floors[key] = origin;
  // First ordinary Channel delivery only. Private-box sessions do not consume
  // this opportunity; Fork already carries native history. Existing transport
  // receipts prevent repeating bootstrap, but are never promoted to read ACKs.
  if (
    session.generation === 0 &&
    !JSON.parse(text(joined, "payload_json")).sourceInstanceId &&
    !cursor &&
    !(
      session.required &&
      db
        .prepare(
          `SELECT 1 FROM activation_presented_windows w
      JOIN activations a ON a.activation_id=w.activation_id
      WHERE a.participant_id=? AND a.room_id=? AND w.sent_at IS NOT NULL LIMIT 1`,
        )
        .get(scope.participantId, scope.roomId)
    )
  )
    floors[""] = 0;
  return {
    ...(restore ? { recoveryGeneration: session.generation } : {}),
    floors,
    directed,
    eventFloor: Math.min(
      cursor ? integer(cursor, "last_seq") : origin,
      integer(activation, "from_seq") - 1,
    ),
  };
}

/** SQL uses immutable message identity; membership is already frozen above. */
export function conversationPredicate(
  policy: ConversationDelivery | undefined,
): { sql: string; params: string[] } {
  if (!policy) return { sql: "1", params: [] };
  return {
    sql: `(room_seq IN (SELECT value FROM json_each(?)) OR
      (type='message.posted' AND (NOT EXISTS (SELECT 1 FROM messages m WHERE m.message_id=room_events.aggregate_id AND m.room_id=room_events.room_id) OR EXISTS (SELECT 1 FROM messages m JOIN json_each(?) p ON p.key=COALESCE(m.thread_id,'') WHERE m.message_id=room_events.aggregate_id AND m.room_id=room_events.room_id AND room_events.room_seq>p.value))) OR
      (type<>'message.posted' AND room_seq>CAST(? AS INTEGER) AND (aggregate_type<>'task' OR type='task.created' OR NOT EXISTS (SELECT 1 FROM tasks t WHERE t.task_id=room_events.aggregate_id AND t.room_id=room_events.room_id) OR EXISTS (SELECT 1 FROM tasks t JOIN json_each(?) p ON p.key=t.thread_id WHERE t.task_id=room_events.aggregate_id AND t.room_id=room_events.room_id))))`,
    params: [
      JSON.stringify(policy.directed),
      JSON.stringify(policy.floors),
      String(policy.eventFloor ?? 0),
      JSON.stringify(policy.floors),
    ],
  };
}

export function selectConversationEvents(
  db: DatabaseSync,
  policy: ConversationDelivery | undefined,
  events: readonly RoomEvent[],
): RoomEvent[] {
  if (!policy) return [...events];
  return events.filter((e) => {
    if (policy.directed.includes(e.roomSeq)) return true;
    if (e.type !== "message.posted") {
      if (e.roomSeq <= (policy.eventFloor ?? 0)) return false;
      if (e.aggregateType !== "task" || e.type === "task.created") return true;
      const task = db
        .prepare("SELECT thread_id FROM tasks WHERE task_id=? AND room_id=?")
        .get(e.aggregateId, e.roomId);
      return !task || Object.hasOwn(policy.floors, String(task.thread_id));
    }
    const m = db
      .prepare(
        "SELECT thread_id FROM messages WHERE message_id=? AND room_id=?",
      )
      .get(e.aggregateId, e.roomId);
    if (!m) return true; // unknown business fact is not silently discarded
    const floor = policy.floors[String(m.thread_id ?? "")];
    return floor !== undefined && e.roomSeq > floor;
  });
}

export function conversationFloor(
  policy: ConversationDelivery | undefined,
  fallback: number,
): number {
  return policy
    ? Math.min(fallback, ...Object.values(policy.floors).map((n) => n + 1))
    : fallback;
}

/** Transport coverage may include irrelevant messages; reading receipts may not. */
export function storedBodySeqs(
  db: DatabaseSync,
  scope: ActivationCredentialScope,
): number[] | undefined {
  const row = db
    .prepare(
      `SELECT catch_up_json FROM activation_presented_windows
    WHERE activation_id=? AND consumer_id=? AND run_attempt_id=?`,
    )
    .get(scope.activationId, scope.consumerId, scope.runAttemptId);
  return row
    ? (JSON.parse(String(row.catch_up_json ?? "{}")) as { bodySeqs?: number[] })
        .bodySeqs
    : undefined;
}
