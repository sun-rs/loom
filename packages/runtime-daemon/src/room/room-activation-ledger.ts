import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type {
  RoomActivation,
  RoomActivationEnqueueResult,
  RoomInboxAvailableWakeHint,
} from "@rah/runtime-protocol";
import { validateRoomWakeHint } from "@rah/runtime-protocol";

import { RoomDomainError, roomError } from "./room-errors";
import { integer, optionalText, text, type RoomSqlRow as Row } from "./room-rows";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_LIST = 500;

export interface RoomActivationLedgerOptions {
  createId?: (prefix: string) => string;
  now?: () => Date;
}

export class RoomActivationLedger {
  readonly #database: DatabaseSync;
  readonly #createId: (prefix: string) => string;
  readonly #now: () => Date;
  #closed = false;

  constructor(databasePath: string, options: RoomActivationLedgerOptions = {}) {
    this.#database = new DatabaseSync(databasePath);
    this.#database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 250;");
    this.#createId = options.createId ?? ((prefix) => `${prefix}-${randomUUID()}`);
    this.#now = options.now ?? (() => new Date());
  }

  enqueue(rawHint: RoomInboxAvailableWakeHint): RoomActivationEnqueueResult {
    const validated = validateRoomWakeHint(rawHint);
    if (validated.topic !== "inbox.available") {
      throw roomError("invalid_argument", "Activation requires an inbox.available hint");
    }
    return this.#transaction(() => {
      const duplicate = this.#database
        .prepare("SELECT * FROM room_activation_receipts WHERE hint_id = ?")
        .get(validated.hintId) as Row | undefined;
      if (duplicate) {
        const activationId = optionalText(duplicate, "activation_id");
        return {
          activation: activationId ? this.#requireActivation(activationId) : null,
          deduplicated: true,
          receiptId: text(duplicate, "receipt_id"),
        };
      }

      const principal = this.#database
        .prepare("SELECT kind FROM room_principals WHERE principal_id = ?")
        .get(validated.participantId) as Row | undefined;
      if (!principal) {
        throw roomError("not_found", `principal ${validated.participantId} was not found`);
      }
      const receiptId = this.#createId("activation-receipt");
      if (text(principal, "kind") !== "agent") {
        this.#insertReceipt(validated, receiptId, null);
        return { activation: null, deduplicated: false, receiptId };
      }

      let activation = this.#queuedLane(validated.roomId, validated.participantId);
      if (activation) {
        this.#database
          .prepare(
            `UPDATE room_activations
             SET from_seq = MIN(from_seq, ?), to_seq = MAX(to_seq, ?), updated_at = ?
             WHERE activation_id = ?`,
          )
          .run(validated.roomSeq, validated.roomSeq, this.#timestamp(), activation.activationId);
        activation = this.#requireActivation(activation.activationId);
      } else {
        const leased = this.#leasedLane(validated.roomId, validated.participantId);
        if (leased && validated.roomSeq <= leased.toSeq) {
          activation = leased;
        } else {
          const activationId = this.#createId("activation");
          const timestamp = this.#timestamp();
          this.#database
            .prepare(
              `INSERT INTO room_activations(
                 activation_id, room_id, participant_id, from_seq, to_seq, reason,
                 state, pulled_through_seq, available_at, created_at, updated_at
               ) VALUES(?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`,
            )
            .run(
              activationId,
              validated.roomId,
              validated.participantId,
              validated.roomSeq,
              validated.roomSeq,
              validated.reason,
              timestamp,
              timestamp,
              timestamp,
            );
          activation = this.#requireActivation(activationId);
        }
      }
      this.#insertReceipt(validated, receiptId, activation.activationId);
      return { activation, deduplicated: false, receiptId };
    });
  }

  listPending(participantId: string, limit = 100): RoomActivation[] {
    this.#requireIdentifier(participantId, "participantId");
    this.#requireLimit(limit);
    return (this.#database
      .prepare(
        `SELECT * FROM room_activations
         WHERE participant_id = ? AND state IN ('queued', 'leased', 'quarantined')
         ORDER BY activation_seq LIMIT ?`,
      )
      .all(participantId, limit) as Row[]).map(activationFromRow);
  }

  leaseNext(
    workerId: string,
    options: { participantId?: string; leaseMs?: number } = {},
  ): RoomActivation | undefined {
    this.#requireIdentifier(workerId, "workerId");
    if (options.participantId) this.#requireIdentifier(options.participantId, "participantId");
    const leaseMs = options.leaseMs ?? 30_000;
    if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) {
      throw roomError("invalid_argument", "leaseMs must be between 1000 and 300000");
    }
    return this.#transaction(() => {
      this.#recoverExpiredLeases();
      const nowText = this.#timestamp();
      const row = this.#database
        .prepare(
          `SELECT candidate.* FROM room_activations AS candidate
           WHERE candidate.state = 'queued' AND candidate.available_at <= ?
             AND (? IS NULL OR candidate.participant_id = ?)
             AND NOT EXISTS (
               SELECT 1 FROM room_activations AS active
               WHERE active.participant_id = candidate.participant_id
                 AND active.state = 'leased'
             )
           ORDER BY candidate.activation_seq LIMIT 1`,
        )
        .get(nowText, options.participantId ?? null, options.participantId ?? null) as
        | Row
        | undefined;
      if (!row) return undefined;
      const activationId = text(row, "activation_id");
      const leaseToken = this.#createId("activation-attempt");
      const leaseExpiresAt = new Date(this.#now().getTime() + leaseMs).toISOString();
      this.#database
        .prepare(
          `UPDATE room_activations
           SET state = 'leased', lease_owner = ?, lease_token = ?, lease_expires_at = ?,
               attempt_count = attempt_count + 1, updated_at = ?
           WHERE activation_id = ? AND state = 'queued'`,
        )
        .run(workerId, leaseToken, leaseExpiresAt, nowText, activationId);
      return this.#requireActivation(activationId);
    });
  }

  acknowledgePull(
    workerId: string,
    activationId: string,
    leaseToken: string,
    throughSeq: number,
  ): RoomActivation {
    this.#requireIdentifier(workerId, "workerId");
    this.#requireIdentifier(activationId, "activationId");
    this.#requireIdentifier(leaseToken, "leaseToken");
    if (!Number.isSafeInteger(throughSeq) || throughSeq < 1) {
      throw roomError("invalid_argument", "throughSeq must be a positive safe integer");
    }
    return this.#transaction(() => {
      const activation = this.#requireActivation(activationId);
      this.#requireActiveLease(activation, workerId, leaseToken);
      if (throughSeq > activation.toSeq) {
        throw roomError("invalid_argument", "throughSeq cannot exceed the Activation boundary");
      }
      this.#database
        .prepare(
          `UPDATE room_activations
           SET pulled_through_seq = MAX(pulled_through_seq, ?), updated_at = ?
           WHERE activation_id = ?`,
        )
        .run(throughSeq, this.#timestamp(), activationId);
      return this.#requireActivation(activationId);
    });
  }

  complete(workerId: string, activationId: string, leaseToken: string): RoomActivation {
    this.#requireIdentifier(workerId, "workerId");
    this.#requireIdentifier(activationId, "activationId");
    this.#requireIdentifier(leaseToken, "leaseToken");
    return this.#transaction(() => {
      const activation = this.#requireActivation(activationId);
      this.#requireActiveLease(activation, workerId, leaseToken);
      if (activation.pulledThroughSeq < activation.toSeq) {
        throw roomError(
          "conflict",
          `Activation must pull through sequence ${activation.toSeq} before completion`,
        );
      }
      this.#database
        .prepare(
          `UPDATE room_activations
           SET state = 'completed', lease_owner = NULL, lease_token = NULL,
               lease_expires_at = NULL, updated_at = ?
           WHERE activation_id = ?`,
        )
        .run(this.#timestamp(), activationId);
      return this.#requireActivation(activationId);
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#database.close();
  }

  #recoverExpiredLeases(): void {
    const nowText = this.#timestamp();
    const expired = this.#database
      .prepare(
        `SELECT * FROM room_activations
         WHERE state = 'leased' AND lease_expires_at <= ?
         ORDER BY activation_seq`,
      )
      .all(nowText) as Row[];
    for (const row of expired) {
      const activation = activationFromRow(row);
      const queued = this.#queuedLane(activation.roomId, activation.participantId);
      if (queued) {
        this.#database
          .prepare(
            `UPDATE room_activations
             SET from_seq = MIN(from_seq, ?), to_seq = MAX(to_seq, ?), updated_at = ?
             WHERE activation_id = ?`,
          )
          .run(activation.fromSeq, activation.toSeq, nowText, queued.activationId);
        this.#database
          .prepare(
            `UPDATE room_activations
             SET state = 'cancelled', lease_owner = NULL, lease_token = NULL,
                 lease_expires_at = NULL, last_error = ?, updated_at = ?
             WHERE activation_id = ?`,
          )
          .run("expired lease merged into queued lane", nowText, activation.activationId);
      } else {
        this.#database
          .prepare(
            `UPDATE room_activations
             SET state = 'queued', lease_owner = NULL, lease_token = NULL,
                 lease_expires_at = NULL, available_at = ?, last_error = ?, updated_at = ?
             WHERE activation_id = ?`,
          )
          .run(nowText, "previous lease expired", nowText, activation.activationId);
      }
    }
  }

  #insertReceipt(
    hint: RoomInboxAvailableWakeHint,
    receiptId: string,
    activationId: string | null,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO room_activation_receipts(
           hint_id, receipt_id, activation_id, participant_id, created_at
         ) VALUES(?, ?, ?, ?, ?)`,
      )
      .run(hint.hintId, receiptId, activationId, hint.participantId, this.#timestamp());
  }

  #queuedLane(roomId: string, participantId: string): RoomActivation | undefined {
    return this.#lane(roomId, participantId, "queued");
  }

  #leasedLane(roomId: string, participantId: string): RoomActivation | undefined {
    return this.#lane(roomId, participantId, "leased");
  }

  #lane(
    roomId: string,
    participantId: string,
    state: "queued" | "leased",
  ): RoomActivation | undefined {
    const row = this.#database
      .prepare(
        `SELECT * FROM room_activations
         WHERE room_id = ? AND participant_id = ? AND state = ?
         ORDER BY activation_seq LIMIT 1`,
      )
      .get(roomId, participantId, state) as Row | undefined;
    return row ? activationFromRow(row) : undefined;
  }

  #requireActivation(activationId: string): RoomActivation {
    const row = this.#database
      .prepare("SELECT * FROM room_activations WHERE activation_id = ?")
      .get(activationId) as Row | undefined;
    if (!row) throw roomError("not_found", `Activation ${activationId} was not found`);
    return activationFromRow(row);
  }

  #requireActiveLease(
    activation: RoomActivation,
    workerId: string,
    leaseToken: string,
  ): void {
    if (
      activation.state !== "leased" ||
      activation.leaseOwner !== workerId ||
      activation.leaseToken !== leaseToken
    ) {
      throw roomError("conflict", `Activation ${activation.activationId} lease is not owned`);
    }
    if (!activation.leaseExpiresAt || activation.leaseExpiresAt <= this.#timestamp()) {
      throw roomError("conflict", `Activation ${activation.activationId} lease has expired`);
    }
  }

  #transaction<T>(operation: () => T): T {
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.#database.exec("ROLLBACK"); } catch { /* preserve primary error */ }
      if (error instanceof RoomDomainError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/database is (locked|busy)/i.test(message)) {
        throw roomError("unavailable", "Room Activation storage is temporarily busy");
      }
      throw error;
    }
  }

  #requireIdentifier(value: string, name: string): void {
    if (!IDENTIFIER.test(value)) {
      throw roomError("invalid_argument", `${name} must be a stable identifier`);
    }
  }

  #requireLimit(value: number): void {
    if (!Number.isInteger(value) || value < 1 || value > MAX_LIST) {
      throw roomError("invalid_argument", `limit must be between 1 and ${MAX_LIST}`);
    }
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }
}

function activationFromRow(row: Row): RoomActivation {
  const leaseOwner = optionalText(row, "lease_owner");
  const leaseToken = optionalText(row, "lease_token");
  const leaseExpiresAt = optionalText(row, "lease_expires_at");
  const lastError = optionalText(row, "last_error");
  return {
    activationSeq: integer(row, "activation_seq"),
    activationId: text(row, "activation_id"),
    roomId: text(row, "room_id"),
    participantId: text(row, "participant_id"),
    fromSeq: integer(row, "from_seq"),
    toSeq: integer(row, "to_seq"),
    reason: text(row, "reason") as RoomActivation["reason"],
    state: text(row, "state") as RoomActivation["state"],
    pulledThroughSeq: integer(row, "pulled_through_seq"),
    availableAt: text(row, "available_at"),
    attemptCount: integer(row, "attempt_count"),
    ...(leaseOwner ? { leaseOwner } : {}),
    ...(leaseToken ? { leaseToken } : {}),
    ...(leaseExpiresAt ? { leaseExpiresAt } : {}),
    ...(lastError ? { lastError } : {}),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}
