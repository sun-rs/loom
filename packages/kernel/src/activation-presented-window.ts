import type { DatabaseSync } from "node:sqlite";
import type {
  ActivationCredentialScope,
  RoomEvent,
  WorkerAddressing,
} from "@rah-os/protocol";
import { canonicalDigest } from "./canonical-digest.ts";
import { integer, nullableText, text, type Row } from "./sqlite-row.ts";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors.ts";
import { isExecutionAuditEvent } from "./worker-message-projection.ts";
import { workerAddressing } from "./worker-addressing.ts";
import { retryReminder } from "./activation-retry-reminder.ts";

/**
 * A "presented" window records that the Kernel itself rendered a concrete range
 * of Room message bodies for this RunAttempt's wake input, and that the Host
 * afterwards reported sending that rendering to the runtime. It is deliberately
 * weaker than the delivery ACK:
 *
 * - it advances no cursor and no read position;
 * - it appends no Room event;
 * - it never, by itself, satisfies an Activation.
 *
 * Evidence boundary (narrowed 2026-09-18 after review): on the Raft delivery
 * paths this batch actually read — `deliverMessagesToRuntime` and the busy
 * stdin notice path (`RAFT_CHUNK:36484-36514`, i.e. `main.js:848267-848297`) —
 * the recorded endpoint is the daemon-side `sendResult.ok` plus
 * `recordNoticeWritten`, and `grep -rn "agent:delivered"` is empty in the
 * readable daemon slice. That is *not* a proof that no Raft driver and no Raft
 * server component carries an acceptance signal; the other eleven driver
 * descriptors and the server side were not decompiled. What is load-bearing
 * here is RAH's own invariant — "a wake hint, process spawn, PTY write, RPC
 * response, or exit code never proves that an agent read work" — so a
 * daemon-side write is never recorded as an ACK regardless of upstream.
 *
 * Trust boundary, in three parts:
 *
 * (a) the *content* of a record is produced by the server, never accepted from
 *     a request body: {@link renderPresentedWindow} selects the sequences,
 *     applies the page bound and computes the digest inside the Kernel
 *     transaction that reads the bodies;
 * (b) the *sent* fact is registered under the Host's own credential
 *     ({@link markPresentedWindowSent}), which is a different identity from the
 *     worker execution credential the model holds — a Worker credential has no
 *     entry point that can create or alter a presented record;
 * (c) the implicit acknowledgement in {@link presentedWindowAcknowledgement}
 *     applies only to a record whose `sent_at` is set.
 */
export const ACTIVATION_PRESENTED_WINDOW_SCHEMA = `
CREATE TABLE IF NOT EXISTS activation_presented_windows (
  activation_id TEXT NOT NULL REFERENCES activations(activation_id) ON DELETE CASCADE,
  consumer_id TEXT NOT NULL,
  run_attempt_id TEXT NOT NULL,
  from_seq INTEGER NOT NULL CHECK (from_seq > 0),
  to_seq INTEGER NOT NULL CHECK (to_seq >= from_seq),
  presented_seqs_json TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  rendered_at TEXT NOT NULL,
  sent_at TEXT,
  sent_by_host_id TEXT,
  pending_ack_seq INTEGER,
  PRIMARY KEY (activation_id, consumer_id, run_attempt_id)
) STRICT;
`;

export function migrateActivationPresentedWindows(
  database: DatabaseSync,
): void {
  database.exec(ACTIVATION_PRESENTED_WINDOW_SCHEMA);
  const columns = database
    .prepare("PRAGMA table_info(activation_presented_windows)")
    .all();
  if (columns.some((column) => column.name === "message_seqs_json")) {
    // Historical rendering is not evidence of delivery or acknowledgement.
    database.exec(`
      ALTER TABLE activation_presented_windows RENAME COLUMN message_seqs_json TO presented_seqs_json;
      ALTER TABLE activation_presented_windows RENAME COLUMN presented_at TO rendered_at;
      ALTER TABLE activation_presented_windows ADD COLUMN sent_at TEXT;
      ALTER TABLE activation_presented_windows ADD COLUMN sent_by_host_id TEXT;
      ALTER TABLE activation_presented_windows ADD COLUMN pending_ack_seq INTEGER;
    `);
  }
}

/**
 * RAH glue, explicitly not a Raft port: `formatConcreteMessagesRuntimeInput`
 * (`RAFT_CHUNK:24357`) has no upper bound because a Raft wake carries one
 * message, while an RAH Activation range `[from_seq, to_seq]` is an arbitrary
 * ledger interval. An event that does not fit the budget degrades to a
 * content-free notice and stays unacknowledged; later, smaller events are
 * still eligible, so the presented set may have gaps — which is exactly why the
 * acknowledgement below advances only through the presented *prefix*.
 *
 * The budget covers EVERY Room event in the range, not only `message.posted`.
 * The set of facts presented to an Agent is defined by what the existing
 * `message-check` page already returns, and that page filters no type at all:
 * `syncRoomEventWindow` selects `SELECT * FROM room_events WHERE room_id=? AND
 * room_seq>? AND room_seq<=?` with no type predicate
 * (`packages/kernel/src/room-sync.ts:123-127`), and the Host renderer prints
 * `message.posted` as a body line and every other type as a
 * `seq= time= actor= type=` line plus its payload
 * (`packages/agent-host/src/worker-read-render.ts:465-497`). A Task
 * cancellation, assignment or status change is therefore a fact the Agent is
 * shown today, and the presented window must not silently cross it. (S1-d:
 * `message-check` now omits enumerated execution-audit events; see below.)
 */
export const WAKE_BODY_MAX_MESSAGES = 20;
export const WAKE_BODY_MAX_BYTES = 64 * 1024;
/**
 * S1-d: `message-check` omits the enumerated execution-audit events
 * (`worker-message-projection.ts`) while its acknowledgement still crosses
 * them, because they need no model action. The wake rendering applies the same
 * projection: such an event is covered by the window (it joins
 * `presentedSeqs`, so the prefix may pass it) but is neither rendered nor
 * charged to the message/byte budget. Every other type — Task, membership,
 * unknown — is still rendered or stops the prefix. The scan itself stays
 * bounded by this row cap; anything past it is reported as notice.
 */
export const WAKE_SCAN_MAX_ROWS = 256;

export type PresentedWindow = {
  runAttemptId: string;
  fromSeq: number;
  toSeq: number;
  /**
   * Every Room event sequence the rendering covers: each rendered event, plus
   * each execution-audit event the projection omits (see WAKE_SCAN_MAX_ROWS).
   */
  presentedSeqs: readonly number[];
  contentDigest: string;
  renderedAt: string;
  sentAt: string | undefined;
  sentByHostId: string | undefined;
  /**
   * A causal marker the model already submitted on a successful post that
   * passed every gate except `sent_at`. See {@link deferPresentedAcknowledgement}.
   */
  pendingAckSeq: number | undefined;
};

export type RenderedPresentedWindow = PresentedWindow & {
  /** The events whose content the server rendered for this wake input. */
  events: readonly RoomEvent[];
  /**
   * The unrendered tail, reported as a bounded summary rather than a list: a
   * range can hold an unbounded number of degraded sequences, and enumerating
   * them would make the response size track the ledger.
   */
  noticeCount: number;
  noticeFromSeq: number | undefined;
  noticeToSeq: number | undefined;
  /**
   * The head of the presented prefix — the sequence through which this
   * rendering is continuous evidence. Zero when the very first event in the
   * range degraded. This, not `toSeq`, is the only number a later causal marker
   * or freshness floor may be built on.
   */
  presentedThroughSeq: number;
  /** Canonical `#room`/`@handle` names, exactly as `message-check` renders. */
  addressing: WorkerAddressing;
  /** See `activation-retry-reminder.ts`. */
  previousAttemptUnconfirmed?: true;
  /** See `activation-retry-reminder.ts`. */
  previousAttemptReplyMessageId?: string;
};

const TERMINAL_RUN_ATTEMPT_STATES = new Set([
  "exited",
  "failed",
  "cancelled",
  "timed_out",
  "orphaned",
]);

function requireLiveRunAttempt(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): void {
  const attempt = database
    .prepare(
      `SELECT state FROM run_attempts WHERE run_attempt_id=? AND activation_id=? AND participant_id=?`,
    )
    .get(scope.runAttemptId, scope.activationId, scope.participantId);
  if (!attempt)
    throw new ForbiddenError("presented range has no RunAttempt of record");
  if (TERMINAL_RUN_ATTEMPT_STATES.has(text(attempt, "state")))
    throw new ForbiddenError("presented range refers to a finished RunAttempt");
}

function activationRange(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): { fromSeq: number; toSeq: number } {
  const activation = database
    .prepare(
      `SELECT from_seq, to_seq FROM activations WHERE activation_id=? AND room_id=? AND participant_id=?`,
    )
    .get(scope.activationId, scope.roomId, scope.participantId);
  if (!activation)
    throw new NotFoundError("presented range has no Activation of record");
  const fromSeq = integer(activation, "from_seq");
  // The credential's frozen head, never the Activation row's live `to_seq`: a
  // range the credential does not cover must never be renderable under it.
  const toSeq = Math.min(integer(activation, "to_seq"), scope.toSeq);
  if (toSeq < fromSeq)
    throw new ForbiddenError("presented range is outside the credential");
  return { fromSeq, toSeq };
}

function rowToWindow(row: Row): PresentedWindow {
  return {
    runAttemptId: text(row, "run_attempt_id"),
    fromSeq: integer(row, "from_seq"),
    toSeq: integer(row, "to_seq"),
    presentedSeqs: JSON.parse(text(row, "presented_seqs_json")) as number[],
    contentDigest: text(row, "content_digest"),
    renderedAt: text(row, "rendered_at"),
    sentAt: nullableText(row, "sent_at") ?? undefined,
    sentByHostId: nullableText(row, "sent_by_host_id") ?? undefined,
    pendingAckSeq:
      row["pending_ack_seq"] == null
        ? undefined
        : integer(row, "pending_ack_seq"),
  };
}

export function readPresentedWindow(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): PresentedWindow | undefined {
  const row = database
    .prepare(
      `SELECT run_attempt_id, from_seq, to_seq, presented_seqs_json, content_digest, rendered_at, sent_at, sent_by_host_id, pending_ack_seq
         FROM activation_presented_windows
        WHERE activation_id=? AND consumer_id=? AND run_attempt_id=?`,
    )
    .get(scope.activationId, scope.consumerId, scope.runAttemptId);
  return row === undefined ? undefined : rowToWindow(row as Row);
}

/**
 * (a) of the trust boundary. Called inside the Kernel's authenticated worker
 * transaction: the range comes from the Activation and the credential, the page
 * selection and the digest are computed here, and nothing in the request body
 * can influence any stored column. Re-rendering is idempotent — the range and
 * the Room events in it are immutable, so a second call returns the first
 * record and never resets `sent_at`.
 */
export function renderPresentedWindow(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  renderedAt: string,
  eventFromRow: (row: Row) => RoomEvent,
): RenderedPresentedWindow {
  requireLiveRunAttempt(database, scope);
  const { fromSeq, toSeq } = activationRange(database, scope);
  // Bounded read: at most one row past the message budget ever leaves SQLite,
  // so neither the scan nor the response tracks the size of the range. What
  // lies beyond is summarised by two aggregates, never enumerated.
  const rows = database
    .prepare(
      `SELECT * FROM room_events
        WHERE room_id=? AND room_seq BETWEEN ? AND ?
        ORDER BY room_seq
        LIMIT ?`,
    )
    .all(scope.roomId, fromSeq, toSeq, WAKE_SCAN_MAX_ROWS) as Row[];
  const total = database
    .prepare(
      `SELECT COUNT(*) AS n, MAX(room_seq) AS last_seq FROM room_events
        WHERE room_id=? AND room_seq BETWEEN ? AND ?`,
    )
    .get(scope.roomId, fromSeq, toSeq) as Row;
  const totalCount = integer(total, "n");
  const events: RoomEvent[] = [];
  const presentedSeqs: number[] = [];
  let usedBytes = 0;
  let firstNoticeSeq: number | undefined;
  let lastScannedSeq = fromSeq - 1;
  for (const row of rows) {
    const roomSeq = integer(row, "room_seq");
    lastScannedSeq = roomSeq;
    if (isExecutionAuditEvent(text(row, "type"))) {
      presentedSeqs.push(roomSeq);
      continue;
    }
    const size = Buffer.byteLength(text(row, "payload_json"), "utf8");
    if (
      events.length >= WAKE_BODY_MAX_MESSAGES ||
      usedBytes + size > WAKE_BODY_MAX_BYTES
    ) {
      if (firstNoticeSeq === undefined) firstNoticeSeq = roomSeq;
      continue;
    }
    usedBytes += size;
    presentedSeqs.push(roomSeq);
    events.push(eventFromRow(row));
  }
  const noticeCount = totalCount - presentedSeqs.length;
  if (noticeCount > 0 && firstNoticeSeq === undefined) {
    // Everything read fit, but the range holds more rows than were read.
    firstNoticeSeq = lastScannedSeq + 1;
  }
  const contentDigest = canonicalDigest({
    fromSeq,
    toSeq,
    events: events.map((event) => ({
      eventId: event.eventId,
      roomSeq: event.roomSeq,
      type: event.type,
      payload: event.payload,
    })),
  });
  const existing = readPresentedWindow(database, scope);
  const notice = {
    noticeCount,
    noticeFromSeq: noticeCount > 0 ? firstNoticeSeq : undefined,
    noticeToSeq:
      noticeCount > 0 ? (integer(total, "last_seq") ?? toSeq) : undefined,
  };
  if (existing !== undefined) {
    if (
      existing.fromSeq !== fromSeq ||
      existing.toSeq !== toSeq ||
      existing.contentDigest !== contentDigest
    )
      throw new ConflictError(
        "presented range conflicts with the recorded one",
      );
    return {
      ...existing,
      events,
      addressing: workerAddressing(database, scope, events),
      ...notice,
      presentedThroughSeq:
        presentedPrefix(database, scope, existing)?.throughSeq ?? 0,
      ...retryReminder(database, scope),
    };
  }
  database
    .prepare(
      `INSERT INTO activation_presented_windows(activation_id, consumer_id, run_attempt_id, from_seq, to_seq, presented_seqs_json, content_digest, rendered_at, sent_at, sent_by_host_id, pending_ack_seq)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
    )
    .run(
      scope.activationId,
      scope.consumerId,
      scope.runAttemptId,
      fromSeq,
      toSeq,
      JSON.stringify(presentedSeqs),
      contentDigest,
      renderedAt,
    );
  const window: PresentedWindow = {
    runAttemptId: scope.runAttemptId,
    fromSeq,
    toSeq,
    presentedSeqs,
    contentDigest,
    renderedAt,
    sentAt: undefined,
    sentByHostId: undefined,
    pendingAckSeq: undefined,
  };
  return {
    ...window,
    events,
    addressing: workerAddressing(database, scope, events),
    ...notice,
    presentedThroughSeq:
      presentedPrefix(database, scope, window)?.throughSeq ?? 0,
    ...retryReminder(database, scope),
  };
}

/**
 * The phase table's readable fields for one RunAttempt's wake delivery. No
 * measurement is taken here and no new column exists: every value is already
 * on the ledger, and this only states where each phase is read from, so a later
 * batch can report 落库 → present → 注入 → 接受 → 首帖 without inventing storage.
 *
 * | Phase   | Field                                                     |
 * | ------- | --------------------------------------------------------- |
 * | 落库    | `room_events.created_at` at `activations.from_seq`         |
 * | present | `activation_presented_windows.rendered_at`                 |
 * | 注入    | `run_attempts.started_at` (the turn carrying the rendering) |
 * | 接受    | `activation_presented_windows.sent_at`                     |
 * | 首帖    | `room_events.created_at` of this participant's first post   |
 */
export type PresentedDeliveryPhases = {
  activationId: string;
  runAttemptId: string;
  postedAt: string | undefined;
  renderedAt: string | undefined;
  injectedAt: string | undefined;
  acceptedAt: string | undefined;
  firstReplyAt: string | undefined;
};

export function readPresentedDeliveryPhases(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
): PresentedDeliveryPhases {
  const window = readPresentedWindow(database, scope);
  const activation = database
    .prepare(
      `SELECT e.created_at AS posted_at
         FROM activations a
         JOIN room_events e ON e.room_id=a.room_id AND e.room_seq=a.from_seq
        WHERE a.activation_id=?`,
    )
    .get(scope.activationId);
  const attempt = database
    .prepare(`SELECT started_at FROM run_attempts WHERE run_attempt_id=?`)
    .get(scope.runAttemptId);
  const reply = database
    .prepare(
      `SELECT MIN(created_at) AS first_at FROM room_events
        WHERE room_id=? AND actor_id=? AND type='message.posted'
          AND room_seq > ?`,
    )
    .get(scope.roomId, scope.participantId, scope.toSeq);
  return {
    activationId: scope.activationId,
    runAttemptId: scope.runAttemptId,
    postedAt: activation ? text(activation as Row, "posted_at") : undefined,
    renderedAt: window?.renderedAt,
    injectedAt: attempt ? text(attempt as Row, "started_at") : undefined,
    acceptedAt: window?.sentAt,
    firstReplyAt:
      reply && (reply as Row)["first_at"] != null
        ? text(reply as Row, "first_at")
        : undefined,
  };
}

export type PresentedWindowKey = {
  activationId: string;
  consumerId: string;
  runAttemptId: string;
};

/**
 * (b) of the trust boundary. The caller must already have proven a Host
 * identity (`requireAuthenticatedHost`) and that this Host owns the RunAttempt;
 * this function only registers "handed to the runtime" on a record the server
 * itself wrote. It can change no range, no page and no digest.
 */
export function markPresentedWindowSent(
  database: DatabaseSync,
  key: PresentedWindowKey,
  hostId: string,
  sentAt: string,
): { pendingAckSeq: number | undefined } {
  const row = database
    .prepare(
      `SELECT sent_at, sent_by_host_id, pending_ack_seq FROM activation_presented_windows
        WHERE activation_id=? AND consumer_id=? AND run_attempt_id=?`,
    )
    .get(key.activationId, key.consumerId, key.runAttemptId);
  if (row === undefined)
    throw new NotFoundError("no presented rendering to register as sent");
  // S1-d: the Host registers a live run's acceptance before it reports the
  // run's exit. A receipt arriving once the RunAttempt is terminal is a late
  // frame from an old run: evidence of nothing current, so it neither marks
  // the rendering sent nor replays a parked marker into the cursor.
  const attempt = database
    .prepare("SELECT state FROM run_attempts WHERE run_attempt_id=?")
    .get(key.runAttemptId);
  if (
    attempt === undefined ||
    TERMINAL_RUN_ATTEMPT_STATES.has(text(attempt as Row, "state"))
  )
    return { pendingAckSeq: undefined };
  const already = nullableText(row as Row, "sent_at");
  if (already !== null && already !== undefined) {
    if (nullableText(row as Row, "sent_by_host_id") !== hostId)
      throw new ConflictError("presented rendering was sent by another Host");
    return { pendingAckSeq: undefined };
  }
  database
    .prepare(
      `UPDATE activation_presented_windows SET sent_at=?, sent_by_host_id=?
        WHERE activation_id=? AND consumer_id=? AND run_attempt_id=?`,
    )
    .run(sentAt, hostId, key.activationId, key.consumerId, key.runAttemptId);
  const pending = (row as Row)["pending_ack_seq"];
  return {
    pendingAckSeq:
      pending == null ? undefined : integer(row as Row, "pending_ack_seq"),
  };
}

/**
 * Race closure, required by review: the model can finish a Worker post before
 * the Host's acceptance signal has come back and `sent_at` has landed. A first
 * reply that succeeds and then never acknowledges is not acceptable, and
 * acknowledging on the post itself would defeat the `sent_at` gate.
 *
 * So the post records its own evidence instead of acting on it. Everything the
 * post alone can prove — the Room matched, the model submitted this causal
 * marker — is checked at post time and stored; everything only the Host can
 * prove is still checked later. `markPresentedWindowSent` then replays the
 * acknowledgement through the very same four gates. If the signal never
 * arrives, `sent_at` stays null, this column is never read, and no cursor moves.
 */
export function deferPresentedAcknowledgement(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  basedOnRoomSeq: number,
): void {
  database
    .prepare(
      `UPDATE activation_presented_windows
          SET pending_ack_seq = MAX(COALESCE(pending_ack_seq, 0), ?)
        WHERE activation_id=? AND consumer_id=? AND run_attempt_id=?
          AND sent_at IS NULL`,
    )
    .run(
      basedOnRoomSeq,
      scope.activationId,
      scope.consumerId,
      scope.runAttemptId,
    );
}

/**
 * The presented *prefix*: the acknowledgement may only reach the sequence
 * before the first Room event in the window that was not presented — of ANY
 * type. An earlier version scanned only `message.posted`, so a Task
 * cancellation, assignment or status change inside the range was crossed in
 * silence even though `message-check` would have shown it
 * (`room-sync.ts:123-127`, `worker-read-render.ts:465-497`).
 *
 * Bounded: the presented set holds at most `WAKE_BODY_MAX_MESSAGES` entries, so
 * the first unpresented row is at worst one past them; `LIMIT n + 1` is exact.
 */
function presentedPrefix(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  window: PresentedWindow,
):
  | {
      throughSeq: number;
      presentedSeqs: readonly number[];
      messageSeqs: readonly number[];
    }
  | undefined {
  const presented = new Set(window.presentedSeqs);
  const rows = database
    .prepare(
      `SELECT room_seq, type FROM room_events
        WHERE room_id=? AND room_seq BETWEEN ? AND ?
        ORDER BY room_seq
        LIMIT ?`,
    )
    .all(
      scope.roomId,
      window.fromSeq,
      window.toSeq,
      presented.size + 1,
    ) as Row[];
  let throughSeq = window.toSeq;
  const presentedSeqs: number[] = [];
  const messageSeqs: number[] = [];
  for (const row of rows) {
    const roomSeq = integer(row, "room_seq");
    if (!presented.has(roomSeq)) {
      throughSeq = roomSeq - 1;
      break;
    }
    presentedSeqs.push(roomSeq);
    if (text(row, "type") === "message.posted") messageSeqs.push(roomSeq);
  }
  if (presentedSeqs.length === 0) return undefined;
  if (throughSeq < presentedSeqs[presentedSeqs.length - 1]!) return undefined;
  return { throughSeq, presentedSeqs, messageSeqs };
}

/**
 * The freshness floor this rendering justifies on one target. A hold exists to
 * stop an Agent answering past facts it has not seen; a range the Host really
 * put in front of this RunAttempt is seen, so re-holding it only costs an extra
 * round trip. Narrow on purpose: the record must be marked sent, the target
 * must be this Activation's own Room, and the floor is the presented *prefix*,
 * never `toSeq` — content past the first degraded event is genuinely unread and
 * must still hold.
 */
export function presentedFreshnessFloor(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  roomId: string,
): number {
  if (roomId !== scope.roomId) return 0;
  const window = readPresentedWindow(database, scope);
  if (window === undefined || window.sentAt === undefined) return 0;
  return presentedPrefix(database, scope, window)?.throughSeq ?? 0;
}

/**
 * (c) of the trust boundary. A worker mutation issued by this Activation's own
 * credential, whose *model-submitted* causal marker already covers the
 * presented prefix, carries the same evidence the explicit `message-check` ACK
 * carries: the model acted on content it had in hand. A cursor the Kernel
 * resolved for the model (the `--target` route's `#resolveSendWindow`) is not a
 * model submission and never reaches this function. Returns the
 * acknowledgement the caller must apply through `recordCheckedWorkerMessages`,
 * or undefined when nothing may be acknowledged.
 */
export function presentedWindowAcknowledgement(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  basedOnRoomSeq: number,
): { throughSeq: number; messageSeqs: readonly number[] } | undefined {
  const window = readPresentedWindow(database, scope);
  if (!window) return undefined;
  // The Host never reported handing this rendering to the runtime, so nothing
  // here is evidence of anything the model saw.
  if (window.sentAt === undefined) return undefined;
  if (!Number.isSafeInteger(basedOnRoomSeq)) return undefined;
  if (window.presentedSeqs.length === 0) return undefined;
  const prefix = presentedPrefix(database, scope, window);
  if (prefix === undefined) return undefined;
  if (basedOnRoomSeq < prefix.throughSeq) return undefined;
  return { throughSeq: prefix.throughSeq, messageSeqs: prefix.messageSeqs };
}
