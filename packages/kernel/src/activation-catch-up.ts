import {
  conversationFloor,
  conversationPredicate,
  type ConversationDelivery,
} from "./conversation-delivery.ts";
import type { DatabaseSync } from "node:sqlite";

import type { RoomEvent } from "@rah-os/protocol";

import { integer, text, type Row } from "./sqlite-row.ts";
import {
  executionAuditEventTypes,
  isExecutionAuditEvent,
} from "./worker-message-projection.ts";

/**
 * Owner ruling 2026-09-27 (contract §3): an instance that was not woken for a
 * Channel message still reads it later. The wake rendering prepends the Room
 * events after this consumer's cursor and before the Activation range — the
 * catch-up — so the implicit acknowledgement, which advances through the
 * presented prefix, no longer crosses events the model was never shown.
 *
 * - The Activation range keeps budget priority; the catch-up takes only what
 *   is left of the shared message/byte budget, newest first, so it is a
 *   contiguous suffix of the gap. An older part that does not fit is stated as
 *   a count and a seq range, never listed (it stays readable through
 *   `message-check`/`room-read`).
 * - Execution-audit events and this participant's own posts are covered but
 *   neither rendered nor charged, exactly as the range treats audit events.
 * - Without a cursor, a Role instance starts after its atomic creation/join
 *   event in its own Channel. Already being a member is distinct from having
 *   run before. Private boxes and legacy consumers keep their existing path;
 *   no pre-membership history is injected.
 * - The Activation's `from_seq` is untouched: it is the latency anchor and the
 *   obligation interval. Only the rendering's stored start moves, and a
 *   re-present in the same RunAttempt reuses that stored start, so a cursor
 *   that moved meanwhile cannot change the digest.
 */
export type CatchUp = {
  /** Frozen cursor + 1 or instance creation + 1; null = no catch-up. */
  floor: number | null;
  renderFromSeq: number;
  events: RoomEvent[];
  presentedSeqs: number[];
  usedBytes: number;
  omittedCount: number;
  omittedFromSeq: number | undefined;
  omittedToSeq: number | undefined;
};

export function renderCatchUp(
  database: DatabaseSync,
  input: {
    roomId: string;
    participantId: string;
    consumerId: string;
    conversations?: ConversationDelivery | undefined;
    fromSeq: number;
    /**
     * Review P2-1: the bound frozen by this RunAttempt's first rendering
     * (`catch_up_json`); undefined on the first rendering. A re-present uses it
     * so neither the shown suffix nor the omitted summary depends on a cursor
     * that moved meanwhile.
     */
    frozenFloor: number | null | undefined;
    budget: { messages: number; bytes: number; scanRows: number };
    eventFromRow: (row: Row) => RoomEvent;
  },
): CatchUp {
  const none = (floor: number | null): CatchUp => ({
    floor,
    renderFromSeq: input.fromSeq,
    events: [],
    presentedSeqs: [],
    usedBytes: 0,
    omittedCount: 0,
    omittedFromSeq: undefined,
    omittedToSeq: undefined,
  });
  let floor = input.frozenFloor;
  if (floor === undefined) {
    const cursor = database
      .prepare(
        "SELECT last_seq FROM subscription_cursors WHERE room_id=? AND participant_id=? AND consumer_id=?",
      )
      .get(input.roomId, input.participantId, input.consumerId);
    floor =
      cursor === undefined
        ? firstInstanceChannelFloor(database, input)
        : integer(cursor, "last_seq") + 1;
  }
  if (floor === null) return none(null);
  floor = conversationFloor(input.conversations, floor);
  const selection = conversationPredicate(input.conversations);
  if (floor >= input.fromSeq) return none(floor);
  const rows = database
    .prepare(
      `SELECT * FROM room_events
        WHERE room_id=? AND room_seq >= ? AND room_seq < ?
        ORDER BY room_seq DESC
        LIMIT ?`,
    )
    .all(input.roomId, floor, input.fromSeq, input.budget.scanRows) as Row[];
  const covered: Array<{ seq: number; event?: RoomEvent }> = [];
  let usedBytes = 0;
  let rendered = 0;
  let renderFromSeq = rows.length < input.budget.scanRows ? floor : undefined;
  for (const row of rows) {
    const seq = integer(row, "room_seq");
    const type = text(row, "type");
    const relevant =
      !input.conversations ||
      database
        .prepare(
          `SELECT 1 FROM room_events WHERE room_id=? AND room_seq=? AND ${selection.sql}`,
        )
        .get(input.roomId, seq, ...selection.params);
    if (
      !relevant ||
      isExecutionAuditEvent(type) ||
      (type === "message.posted" &&
        text(row, "actor_id") === input.participantId)
    ) {
      covered.push({ seq });
      continue;
    }
    const size = Buffer.byteLength(text(row, "payload_json"), "utf8");
    if (
      rendered >= input.budget.messages ||
      usedBytes + size > input.budget.bytes
    ) {
      renderFromSeq = seq + 1;
      break;
    }
    usedBytes += size;
    rendered += 1;
    covered.push({ seq, event: input.eventFromRow(row) });
  }
  renderFromSeq ??= covered.at(-1)?.seq ?? input.fromSeq;
  const shown = covered.filter(({ seq }) => seq >= renderFromSeq!).reverse();
  const omitted =
    renderFromSeq > floor
      ? omittedSummary(database, input, floor, renderFromSeq - 1)
      : { count: 0, fromSeq: undefined, toSeq: undefined };
  return {
    floor,
    renderFromSeq,
    events: shown.flatMap(({ event }) => (event ? [event] : [])),
    presentedSeqs: shown.map(({ seq }) => seq),
    usedBytes,
    omittedCount: omitted.count,
    omittedFromSeq: omitted.fromSeq,
    omittedToSeq: omitted.toSeq,
  };
}

/** The ledger owns the subscription origin; never fabricate a read cursor. */
function firstInstanceChannelFloor(
  database: DatabaseSync,
  input: { roomId: string; participantId: string },
): number | null {
  const created = database
    .prepare(
      `SELECT e.room_seq FROM room_events e
       JOIN role_instances i ON i.instance_id=e.aggregate_id AND i.channel_id=e.room_id
       JOIN memberships m ON m.room_id=i.channel_id AND m.principal_id=i.instance_id
       WHERE e.room_id=? AND e.type='instance.created' AND e.aggregate_id=?
       LIMIT 1`,
    )
    .get(input.roomId, input.participantId);
  return created === undefined ? null : integer(created, "room_seq") + 1;
}

/** Bounded aggregate over what the catch-up would have rendered. */
function omittedSummary(
  database: DatabaseSync,
  input: {
    roomId: string;
    participantId: string;
    conversations?: ConversationDelivery | undefined;
  },
  fromSeq: number,
  toSeq: number,
): { count: number; fromSeq: number | undefined; toSeq: number | undefined } {
  const audit = executionAuditEventTypes();
  const selection = conversationPredicate(input.conversations);
  const row = database
    .prepare(
      `SELECT COUNT(*) AS n, MIN(room_seq) AS first_seq, MAX(room_seq) AS last_seq
         FROM room_events
        WHERE room_id=? AND room_seq BETWEEN ? AND ?
          AND type NOT IN (${audit.map(() => "?").join(",")})
          AND NOT (type='message.posted' AND actor_id=?) AND ${selection.sql}`,
    )
    .get(
      input.roomId,
      fromSeq,
      toSeq,
      ...audit,
      input.participantId,
      ...selection.params,
    ) as Row;
  const count = integer(row, "n");
  return count === 0
    ? { count: 0, fromSeq: undefined, toSeq: undefined }
    : {
        count,
        fromSeq: integer(row, "first_seq"),
        toSeq: integer(row, "last_seq"),
      };
}

/** Schema 77: the per-rendering frozen catch-up bound (review P2-1). */
export function migrateCatchUpV77(database: DatabaseSync): void {
  const columns = new Set(
    database
      .prepare("PRAGMA table_info(activation_presented_windows)")
      .all()
      .map((row) => text(row, "name")),
  );
  if (!columns.has("catch_up_json"))
    database.exec(
      "ALTER TABLE activation_presented_windows ADD COLUMN catch_up_json TEXT",
    );
}

/**
 * The bound a stored rendering froze. A window written before schema 77 has
 * none; its stored start stands in for it (the pre-77 behaviour).
 */
export function storedCatchUpFloor(
  database: DatabaseSync,
  key: { activationId: string; consumerId: string; runAttemptId: string },
  legacy: { storedFromSeq: number; fromSeq: number },
): number | null {
  const row = database
    .prepare(
      `SELECT catch_up_json FROM activation_presented_windows
        WHERE activation_id=? AND consumer_id=? AND run_attempt_id=?`,
    )
    .get(key.activationId, key.consumerId, key.runAttemptId);
  const raw = row?.["catch_up_json"];
  if (typeof raw === "string") {
    const floor = (JSON.parse(raw) as { floor?: unknown }).floor;
    return typeof floor === "number" ? floor : null;
  }
  return legacy.storedFromSeq < legacy.fromSeq ? legacy.storedFromSeq : null;
}
