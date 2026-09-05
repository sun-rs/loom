import type { DatabaseSync } from "node:sqlite";

import type { RoomOutboxEntry } from "@rah/runtime-protocol";

import { roomError } from "./room-errors";
import {
  integer,
  optionalText,
  outboxFromRow,
  type RoomSqlRow as Row,
} from "./room-rows";

const ROOM_OUTBOX_LIST_LIMIT = 500;
const STABLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class RoomOutboxLedger {
  readonly #database: DatabaseSync;
  readonly #now: () => Date;
  readonly #createId: (prefix: string) => string;
  readonly #transaction: <T>(operation: () => T) => T;

  constructor(args: {
    database: DatabaseSync;
    now: () => Date;
    createId: (prefix: string) => string;
    transaction: <T>(operation: () => T) => T;
  }) {
    this.#database = args.database;
    this.#now = args.now;
    this.#createId = args.createId;
    this.#transaction = args.transaction;
  }

  list(options: { afterOutboxSeq?: number; limit?: number } = {}): RoomOutboxEntry[] {
    const afterOutboxSeq = options.afterOutboxSeq ?? 0;
    const limit = options.limit ?? ROOM_OUTBOX_LIST_LIMIT;
    if (!Number.isInteger(afterOutboxSeq) || afterOutboxSeq < 0) {
      throw roomError("invalid_argument", "afterOutboxSeq must be a non-negative integer");
    }
    this.#requireLimit(limit);
    return (this.#database
      .prepare("SELECT * FROM room_outbox WHERE outbox_seq > ? ORDER BY outbox_seq LIMIT ?")
      .all(afterOutboxSeq, limit) as Row[]).map(outboxFromRow);
  }

  claim(
    workerId: string,
    options: { limit?: number; leaseMs?: number } = {},
  ): RoomOutboxEntry[] {
    this.#requireIdentifier(workerId, "workerId");
    const limit = options.limit ?? 100;
    const leaseMs = options.leaseMs ?? 30_000;
    this.#requireLimit(limit);
    if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) {
      throw roomError("invalid_argument", "leaseMs must be between 1000 and 300000");
    }
    return this.#transaction(() => {
      const nowText = this.#timestamp();
      const leaseExpiresAt = new Date(this.#now().getTime() + leaseMs).toISOString();
      const malformedRows = this.#database
        .prepare(
          `SELECT outbox_seq FROM room_outbox
           WHERE published_at IS NULL AND quarantined_at IS NULL
             AND available_at <= ?
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
             AND json_valid(payload_json) = 0
           ORDER BY outbox_seq
           LIMIT ?`,
        )
        .all(nowText, nowText, limit) as Row[];
      for (const row of malformedRows) {
        this.#database
          .prepare(
            `UPDATE room_outbox
             SET quarantined_at = ?, last_error = ?, lease_owner = NULL,
                 lease_token = NULL, lease_expires_at = NULL
             WHERE outbox_seq = ? AND quarantined_at IS NULL`,
          )
          .run(nowText, "payload_json must contain valid JSON", integer(row, "outbox_seq"));
      }
      const rows = this.#database
        .prepare(
          `SELECT outbox_seq FROM room_outbox
           WHERE published_at IS NULL
             AND quarantined_at IS NULL AND blocked_at IS NULL
             AND available_at <= ?
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
             AND json_valid(payload_json) = 1
           ORDER BY outbox_seq
           LIMIT ?`,
        )
        .all(nowText, nowText, limit) as Row[];
      return rows.map((row) => {
        const outboxSeq = integer(row, "outbox_seq");
        const leaseToken = this.#createId("outbox-attempt");
        this.#database
          .prepare(
            `UPDATE room_outbox
             SET lease_owner = ?, lease_token = ?, lease_expires_at = ?,
                 last_attempt_id = ?, attempt_count = attempt_count + 1
             WHERE outbox_seq = ?`,
          )
          .run(workerId, leaseToken, leaseExpiresAt, leaseToken, outboxSeq);
        return this.#requireEntry(outboxSeq);
      });
    });
  }

  complete(
    workerId: string,
    outboxSeq: number,
    leaseToken: string,
    deliveryReceipt = leaseToken,
  ): RoomOutboxEntry {
    this.#requireIdentifier(workerId, "workerId");
    this.#requireIdentifier(leaseToken, "leaseToken");
    this.#requireIdentifier(deliveryReceipt, "deliveryReceipt");
    this.#requireSequence(outboxSeq);
    return this.#transaction(() => {
      const entry = this.#requireEntry(outboxSeq);
      if (entry.publishedAt) {
        if (
          entry.publishedBy === workerId &&
          this.#publishedLeaseToken(outboxSeq) === leaseToken
        ) return entry;
        throw roomError("conflict", `outbox entry ${outboxSeq} was completed by another worker`);
      }
      this.#requireActiveLease(entry, workerId, leaseToken);
      this.#database
        .prepare(
          `UPDATE room_outbox
           SET published_at = ?, published_by = ?, published_lease_token = lease_token,
               delivery_receipt = ?, lease_owner = NULL, lease_token = NULL,
               lease_expires_at = NULL, last_error = NULL, failure_class = NULL,
               action_required = NULL
           WHERE outbox_seq = ?`,
        )
        .run(this.#timestamp(), workerId, deliveryReceipt, outboxSeq);
      return this.#requireEntry(outboxSeq);
    });
  }

  fail(
    workerId: string,
    outboxSeq: number,
    input: { error: string; retryAt: string; leaseToken: string; failureClass?: string },
  ): RoomOutboxEntry {
    this.#requireIdentifier(workerId, "workerId");
    this.#requireIdentifier(input.leaseToken, "leaseToken");
    this.#requireSequence(outboxSeq);
    const retryAt = new Date(input.retryAt);
    if (!Number.isFinite(retryAt.getTime())) {
      throw roomError("invalid_argument", "retryAt must be an ISO timestamp");
    }
    if (!input.error.trim()) throw roomError("invalid_argument", "error must not be empty");
    return this.#transaction(() => {
      const entry = this.#requireEntry(outboxSeq);
      if (entry.publishedAt) {
        throw roomError("conflict", `outbox entry ${outboxSeq} is already complete`);
      }
      this.#requireActiveLease(entry, workerId, input.leaseToken);
      this.#database
        .prepare(
          `UPDATE room_outbox
           SET available_at = ?, lease_owner = NULL, lease_token = NULL,
               lease_expires_at = NULL, last_error = ?, failure_class = ?,
               action_required = NULL, blocked_at = NULL, sticky = 0
           WHERE outbox_seq = ?`,
        )
        .run(
          retryAt.toISOString(),
          input.error.trim().slice(0, 2_000),
          input.failureClass?.trim().slice(0, 120) ?? null,
          outboxSeq,
        );
      return this.#requireEntry(outboxSeq);
    });
  }

  block(
    workerId: string,
    outboxSeq: number,
    input: {
      error: string;
      failureClass: string;
      actionRequired: string;
      sticky: boolean;
      leaseToken: string;
    },
  ): RoomOutboxEntry {
    this.#requireIdentifier(workerId, "workerId");
    this.#requireIdentifier(input.leaseToken, "leaseToken");
    this.#requireSequence(outboxSeq);
    if (!input.error.trim() || !input.failureClass.trim() || !input.actionRequired.trim()) {
      throw roomError("invalid_argument", "blocked outbox diagnostics must not be empty");
    }
    return this.#transaction(() => {
      const entry = this.#requireEntry(outboxSeq);
      if (entry.publishedAt) {
        throw roomError("conflict", `outbox entry ${outboxSeq} is already complete`);
      }
      this.#requireActiveLease(entry, workerId, input.leaseToken);
      this.#database
        .prepare(
          `UPDATE room_outbox
           SET blocked_at = ?, failure_class = ?, action_required = ?, sticky = ?,
               last_error = ?, lease_owner = NULL, lease_token = NULL,
               lease_expires_at = NULL
           WHERE outbox_seq = ?`,
        )
        .run(
          this.#timestamp(),
          input.failureClass.trim().slice(0, 120),
          input.actionRequired.trim().slice(0, 500),
          input.sticky ? 1 : 0,
          input.error.trim().slice(0, 2_000),
          outboxSeq,
        );
      return this.#requireEntry(outboxSeq);
    });
  }

  prune(input: { throughOutboxSeq: number; limit?: number }): number {
    const limit = input.limit ?? ROOM_OUTBOX_LIST_LIMIT;
    this.#requireSequence(input.throughOutboxSeq);
    this.#requireLimit(limit);
    return this.#transaction(() => Number(this.#database
      .prepare(
        `DELETE FROM room_outbox
         WHERE outbox_seq IN (
           SELECT outbox_seq FROM room_outbox
           WHERE published_at IS NOT NULL AND outbox_seq <= ?
           ORDER BY outbox_seq
           LIMIT ?
         )`,
      )
      .run(input.throughOutboxSeq, limit).changes));
  }

  #requireEntry(outboxSeq: number): RoomOutboxEntry {
    const row = this.#database
      .prepare("SELECT * FROM room_outbox WHERE outbox_seq = ?")
      .get(outboxSeq) as Row | undefined;
    if (!row) throw roomError("not_found", `outbox entry ${outboxSeq} was not found`);
    return outboxFromRow(row);
  }

  #publishedLeaseToken(outboxSeq: number): string | undefined {
    const row = this.#database
      .prepare("SELECT published_lease_token FROM room_outbox WHERE outbox_seq = ?")
      .get(outboxSeq) as Row | undefined;
    return row ? optionalText(row, "published_lease_token") : undefined;
  }

  #requireActiveLease(entry: RoomOutboxEntry, workerId: string, leaseToken: string): void {
    if (entry.leaseOwner !== workerId) {
      throw roomError("conflict", `outbox entry ${entry.outboxSeq} is not leased by ${workerId}`);
    }
    if (entry.leaseToken !== leaseToken) {
      throw roomError("conflict", `outbox entry ${entry.outboxSeq} is fenced by a newer claim`);
    }
    if (!entry.leaseExpiresAt || entry.leaseExpiresAt <= this.#timestamp()) {
      throw roomError("conflict", `outbox entry ${entry.outboxSeq} lease has expired`);
    }
  }

  #requireIdentifier(value: string, name: string): void {
    if (!STABLE_IDENTIFIER.test(value)) {
      throw roomError("invalid_argument", `${name} must be a stable identifier`);
    }
  }

  #requireSequence(value: number): void {
    if (!Number.isInteger(value) || value < 1) {
      throw roomError("invalid_argument", "outboxSeq must be a positive integer");
    }
  }

  #requireLimit(value: number): void {
    if (!Number.isInteger(value) || value < 1 || value > ROOM_OUTBOX_LIST_LIMIT) {
      throw roomError(
        "invalid_argument",
        `outbox limit must be between 1 and ${ROOM_OUTBOX_LIST_LIMIT}`,
      );
    }
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }
}
