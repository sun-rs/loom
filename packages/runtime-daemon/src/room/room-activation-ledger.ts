import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type {
  RoomActivation,
  RoomActivationEnqueueResult,
  RoomInboxAvailableWakeHint,
  RoomRunAttempt,
  RoomWorkerExecution,
} from "@rah/runtime-protocol";
import { validateRoomWakeHint } from "@rah/runtime-protocol";

import { RoomDomainError, roomError } from "./room-errors";
import {
  integer,
  optionalText,
  text,
  type RoomSqlRow as Row,
} from "./room-rows";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_LIST = 500;
const MAX_ACTIVATION_ROOM_SPAN = 500;
const MAX_EXPIRED_LEASE_ATTEMPTS = 5;

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
    this.#createId =
      options.createId ?? ((prefix) => `${prefix}-${randomUUID()}`);
    this.#now = options.now ?? (() => new Date());
  }

  enqueue(rawHint: RoomInboxAvailableWakeHint): RoomActivationEnqueueResult {
    const validated = validateRoomWakeHint(rawHint);
    if (validated.topic !== "inbox.available") {
      throw roomError(
        "invalid_argument",
        "Activation requires an inbox.available hint",
      );
    }
    if (validated.disposition !== "activation") {
      throw roomError(
        "invalid_argument",
        "Notification-only Inbox hints cannot create an Activation",
      );
    }
    return this.#transaction(() => {
      const duplicate = this.#database
        .prepare("SELECT * FROM room_activation_receipts WHERE hint_id = ?")
        .get(validated.hintId) as Row | undefined;
      if (duplicate) {
        const activationId = optionalText(duplicate, "activation_id");
        return {
          activation: activationId
            ? this.#requireActivation(activationId)
            : null,
          deduplicated: true,
          receiptId: text(duplicate, "receipt_id"),
        };
      }

      const principal = this.#database
        .prepare("SELECT kind FROM room_principals WHERE principal_id = ?")
        .get(validated.participantId) as Row | undefined;
      if (!principal) {
        throw roomError(
          "not_found",
          `principal ${validated.participantId} was not found`,
        );
      }
      const receiptId = this.#createId("activation-receipt");
      if (text(principal, "kind") !== "agent") {
        this.#insertReceipt(validated, receiptId, null);
        return { activation: null, deduplicated: false, receiptId };
      }

      let activation = this.#queuedLane(
        validated.roomId,
        validated.participantId,
      );
      if (
        activation &&
        Math.max(activation.toSeq, validated.roomSeq) -
          Math.min(activation.fromSeq, validated.roomSeq) +
          1 >
          MAX_ACTIVATION_ROOM_SPAN
      ) {
        activation = undefined;
      }
      if (activation) {
        this.#database
          .prepare(
            `UPDATE room_activations
             SET from_seq = MIN(from_seq, ?), to_seq = MAX(to_seq, ?), updated_at = ?
             WHERE activation_id = ?`,
          )
          .run(
            validated.roomSeq,
            validated.roomSeq,
            this.#timestamp(),
            activation.activationId,
          );
        activation = this.#requireActivation(activation.activationId);
      } else {
        const leased = this.#leasedLane(
          validated.roomId,
          validated.participantId,
        );
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
    return (
      this.#database
        .prepare(
          `SELECT * FROM room_activations
         WHERE participant_id = ? AND state IN ('queued', 'leased', 'quarantined')
         ORDER BY activation_seq LIMIT ?`,
        )
        .all(participantId, limit) as Row[]
    ).map(activationFromRow);
  }

  leaseNext(
    workerId: string,
    options: { participantId?: string; leaseMs?: number } = {},
  ): RoomActivation | undefined {
    this.#requireIdentifier(workerId, "workerId");
    if (options.participantId)
      this.#requireIdentifier(options.participantId, "participantId");
    const leaseMs = options.leaseMs ?? 30_000;
    if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) {
      throw roomError(
        "invalid_argument",
        "leaseMs must be between 1000 and 300000",
      );
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
        .get(
          nowText,
          options.participantId ?? null,
          options.participantId ?? null,
        ) as Row | undefined;
      if (!row) return undefined;
      const activationId = text(row, "activation_id");
      const leaseToken = this.#createId("activation-attempt");
      const leaseExpiresAt = new Date(
        this.#now().getTime() + leaseMs,
      ).toISOString();
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

  renewLease(
    workerId: string,
    activationId: string,
    leaseToken: string,
    leaseMs = 30_000,
  ): RoomActivation {
    this.#requireIdentifier(workerId, "workerId");
    this.#requireIdentifier(activationId, "activationId");
    this.#requireIdentifier(leaseToken, "leaseToken");
    if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) {
      throw roomError(
        "invalid_argument",
        "leaseMs must be between 1000 and 300000",
      );
    }
    return this.#transaction(() => {
      const activation = this.#requireActivation(activationId);
      this.#requireActiveLease(activation, workerId, leaseToken);
      const timestamp = this.#timestamp();
      const leaseExpiresAt = new Date(
        this.#now().getTime() + leaseMs,
      ).toISOString();
      this.#database
        .prepare(
          `UPDATE room_activations SET lease_expires_at = ?, updated_at = ?
           WHERE activation_id = ?`,
        )
        .run(leaseExpiresAt, timestamp, activationId);
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
      throw roomError(
        "invalid_argument",
        "throughSeq must be a positive safe integer",
      );
    }
    return this.#transaction(() => {
      const activation = this.#requireActivation(activationId);
      this.#requireActiveLease(activation, workerId, leaseToken);
      if (throughSeq > activation.toSeq) {
        throw roomError(
          "invalid_argument",
          "throughSeq cannot exceed the Activation boundary",
        );
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

  createRunAttempt(
    workerId: string,
    activationId: string,
    leaseToken: string,
    input: { runtimeProfileId: string; provider: string; workspace: string },
  ): RoomRunAttempt {
    this.#requireIdentifier(workerId, "workerId");
    this.#requireIdentifier(activationId, "activationId");
    this.#requireIdentifier(leaseToken, "leaseToken");
    this.#requireIdentifier(input.runtimeProfileId, "runtimeProfileId");
    this.#requireIdentifier(input.provider, "provider");
    if (!input.workspace.trim())
      throw roomError("invalid_argument", "workspace must not be empty");
    return this.#transaction(() => {
      const activation = this.#requireActivation(activationId);
      this.#requireActiveLease(activation, workerId, leaseToken);
      const active = this.#database
        .prepare(
          "SELECT run_attempt_id FROM room_run_attempts WHERE activation_id = ? AND state IN ('prepared', 'running')",
        )
        .get(activationId);
      if (active)
        throw roomError(
          "conflict",
          `Activation ${activationId} already has an active Run`,
        );
      const attemptNumber = integer(
        this.#database
          .prepare(
            "SELECT COUNT(*) + 1 AS next FROM room_run_attempts WHERE activation_id = ?",
          )
          .get(activationId) as Row,
        "next",
      );
      const runAttemptId = this.#createId("run-attempt");
      const timestamp = this.#timestamp();
      this.#database
        .prepare(
          `INSERT INTO room_run_attempts(
             run_attempt_id, activation_id, attempt_number, room_id, participant_id,
             worker_id, lease_token, runtime_profile_id, provider, workspace,
             state, created_at, updated_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)`,
        )
        .run(
          runAttemptId,
          activationId,
          attemptNumber,
          activation.roomId,
          activation.participantId,
          workerId,
          leaseToken,
          input.runtimeProfileId,
          input.provider,
          input.workspace.trim(),
          timestamp,
          timestamp,
        );
      return this.#requireRunAttempt(runAttemptId);
    });
  }

  startRunAttempt(
    workerId: string,
    activationId: string,
    leaseToken: string,
    runAttemptId: string,
    providerSessionId?: string,
  ): RoomRunAttempt {
    return this.#mutateRun(
      workerId,
      activationId,
      leaseToken,
      runAttemptId,
      (run) => {
        if (run.state !== "prepared")
          throw roomError("conflict", "Run must be prepared before start");
        const timestamp = this.#timestamp();
        this.#database
          .prepare(
            `UPDATE room_run_attempts SET state = 'running', provider_session_id = ?,
             started_at = ?, updated_at = ? WHERE run_attempt_id = ?`,
          )
          .run(providerSessionId ?? null, timestamp, timestamp, runAttemptId);
      },
    );
  }

  finishRunAttempt(
    workerId: string,
    activationId: string,
    leaseToken: string,
    runAttemptId: string,
    input: { state: "exited" | "failed"; exitCode?: number },
  ): RoomRunAttempt {
    return this.#mutateRun(
      workerId,
      activationId,
      leaseToken,
      runAttemptId,
      (run) => {
        if (run.state !== "running")
          throw roomError("conflict", "Run must be running before finish");
        const timestamp = this.#timestamp();
        this.#database
          .prepare(
            `UPDATE room_run_attempts SET state = ?, exit_code = ?, ended_at = ?, updated_at = ?
           WHERE run_attempt_id = ?`,
          )
          .run(
            input.state,
            input.exitCode ?? null,
            timestamp,
            timestamp,
            runAttemptId,
          );
      },
    );
  }

  workerExecution(
    workerId: string,
    activationId: string,
    leaseToken: string,
    runAttemptId: string,
  ): RoomWorkerExecution {
    const activation = this.#requireActivation(activationId);
    this.#requireActiveLease(activation, workerId, leaseToken);
    const run = this.#requireRunAttempt(runAttemptId);
    if (
      run.activationId !== activationId ||
      run.state !== "running" ||
      run.participantId !== activation.participantId ||
      run.roomId !== activation.roomId
    ) {
      throw roomError(
        "forbidden",
        "RunAttempt is outside this Activation execution scope",
      );
    }
    return {
      workerId,
      activationId,
      leaseToken,
      runAttemptId,
      roomId: activation.roomId,
      participantId: activation.participantId,
      fromSeq: activation.fromSeq,
      toSeq: activation.toSeq,
    };
  }

  recordOutcome(execution: RoomWorkerExecution, eventId: string): void {
    this.#requireIdentifier(eventId, "eventId");
    this.#transaction(() => {
      const activation = this.#requireActivation(execution.activationId);
      this.#requireActiveLease(
        activation,
        execution.workerId,
        execution.leaseToken,
      );
      const run = this.#requireRunAttempt(execution.runAttemptId);
      if (
        run.activationId !== execution.activationId ||
        run.state !== "running" ||
        run.participantId !== execution.participantId ||
        run.roomId !== execution.roomId
      ) {
        throw roomError(
          "forbidden",
          "Outcome is outside the active RunAttempt scope",
        );
      }
      const event = this.#database
        .prepare(
          "SELECT room_id, room_seq, actor_id, created_at FROM room_events WHERE event_id = ?",
        )
        .get(eventId) as Row | undefined;
      if (
        !event ||
        text(event, "room_id") !== execution.roomId ||
        text(event, "actor_id") !== execution.participantId ||
        integer(event, "room_seq") <= activation.toSeq ||
        !run.startedAt ||
        text(event, "created_at") < run.startedAt
      ) {
        throw roomError(
          "forbidden",
          "Outcome event must be attributable to this Worker and follow the Activation boundary",
        );
      }
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO room_activation_outcomes(
             activation_id, event_id, run_attempt_id, created_at
           ) VALUES(?, ?, ?, ?)`,
        )
        .run(
          execution.activationId,
          eventId,
          execution.runAttemptId,
          this.#timestamp(),
        );
    });
  }

  complete(
    workerId: string,
    activationId: string,
    leaseToken: string,
  ): RoomActivation {
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
      const latestRun = this.#database
        .prepare(
          `SELECT run_attempt_id, state FROM room_run_attempts
           WHERE activation_id = ?
           ORDER BY attempt_number DESC LIMIT 1`,
        )
        .get(activationId) as Row | undefined;
      if (
        !latestRun ||
        !["exited", "failed"].includes(text(latestRun, "state"))
      ) {
        throw roomError(
          "conflict",
          "Activation requires terminal RunAttempt evidence",
        );
      }
      const outcome = this.#database
        .prepare(
          `SELECT event_id FROM room_activation_outcomes
           WHERE activation_id = ? AND run_attempt_id = ? LIMIT 1`,
        )
        .get(activationId, text(latestRun, "run_attempt_id"));
      if (!outcome) {
        throw roomError(
          "conflict",
          "Activation requires a canonical outcome event",
        );
      }
      this.#requireActionableInboxResolved(
        activation,
        text(latestRun, "run_attempt_id"),
      );
      const completedAt = this.#timestamp();
      this.#database
        .prepare(
          `UPDATE room_inbox_items
         SET state = 'acknowledged', acknowledged_at = ?
         WHERE room_id = ? AND participant_id = ? AND state = 'pending'
           AND disposition = 'activation' AND event_seq BETWEEN ? AND ?`,
        )
        .run(
          completedAt,
          activation.roomId,
          activation.participantId,
          activation.fromSeq,
          activation.toSeq,
        );
      this.#database
        .prepare(
          `UPDATE room_activations
           SET state = 'completed', lease_owner = NULL, lease_token = NULL,
               lease_expires_at = NULL, updated_at = ?
           WHERE activation_id = ?`,
        )
        .run(completedAt, activationId);
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
      this.#database
        .prepare(
          `UPDATE room_run_attempts
           SET state = 'failed', ended_at = ?, updated_at = ?
           WHERE activation_id = ? AND state IN ('prepared', 'running')`,
        )
        .run(nowText, nowText, activation.activationId);
      const latestRun = this.#database
        .prepare(
          `SELECT run_attempt_id FROM room_run_attempts
         WHERE activation_id = ? ORDER BY attempt_number DESC LIMIT 1`,
        )
        .get(activation.activationId) as Row | undefined;
      const completedOutcome =
        latestRun &&
        this.#database
          .prepare(
            `SELECT 1 FROM room_activation_outcomes
         WHERE activation_id = ? AND run_attempt_id = ? LIMIT 1`,
          )
          .get(activation.activationId, text(latestRun, "run_attempt_id"));
      if (latestRun && completedOutcome) {
        try {
          this.#requireActionableInboxResolved(
            activation,
            text(latestRun, "run_attempt_id"),
          );
          this.#database
            .prepare(
              `UPDATE room_inbox_items SET state = 'acknowledged', acknowledged_at = ?
             WHERE room_id = ? AND participant_id = ? AND state = 'pending'
               AND disposition = 'activation' AND event_seq BETWEEN ? AND ?`,
            )
            .run(
              nowText,
              activation.roomId,
              activation.participantId,
              activation.fromSeq,
              activation.toSeq,
            );
          this.#database
            .prepare(
              `UPDATE room_activations
             SET state = 'completed', lease_owner = NULL, lease_token = NULL,
                 lease_expires_at = NULL, updated_at = ?
             WHERE activation_id = ?`,
            )
            .run(nowText, activation.activationId);
          continue;
        } catch (error) {
          if (!(error instanceof RoomDomainError) || error.code !== "conflict")
            throw error;
        }
      }
      if (activation.attemptCount >= MAX_EXPIRED_LEASE_ATTEMPTS) {
        this.#database
          .prepare(
            `UPDATE room_activations
             SET state = 'quarantined', lease_owner = NULL, lease_token = NULL,
                 lease_expires_at = NULL, last_error = ?, updated_at = ?
             WHERE activation_id = ?`,
          )
          .run(
            `lease expired ${MAX_EXPIRED_LEASE_ATTEMPTS} times; operator action required`,
            nowText,
            activation.activationId,
          );
      } else {
        this.#database
          .prepare(
            `UPDATE room_activations
             SET state = 'queued', lease_owner = NULL, lease_token = NULL,
                 lease_expires_at = NULL, pulled_through_seq = 0,
                 available_at = ?, last_error = ?, updated_at = ?
             WHERE activation_id = ?`,
          )
          .run(
            nowText,
            "previous lease expired",
            nowText,
            activation.activationId,
          );
      }
    }
  }

  #requireActionableInboxResolved(
    activation: RoomActivation,
    runAttemptId: string,
  ): void {
    const inboxRows = this.#database
      .prepare(
        `SELECT inbox.inbox_item_id, source.type, source.aggregate_type, source.aggregate_id,
              source.room_seq, source.payload_json
       FROM room_inbox_items AS inbox
       JOIN room_events AS source ON source.event_id = inbox.event_id
       WHERE inbox.room_id = ? AND inbox.participant_id = ?
         AND inbox.disposition = 'activation' AND inbox.state = 'pending'
         AND inbox.event_seq BETWEEN ? AND ?
       ORDER BY inbox.event_seq`,
      )
      .all(
        activation.roomId,
        activation.participantId,
        activation.fromSeq,
        activation.toSeq,
      ) as Row[];
    const outcomes = this.#database
      .prepare(
        `SELECT event.type, event.aggregate_type, event.aggregate_id,
              event.room_seq, event.payload_json
       FROM room_activation_outcomes AS outcome
       JOIN room_events AS event ON event.event_id = outcome.event_id
       WHERE outcome.activation_id = ? AND outcome.run_attempt_id = ?
       ORDER BY event.room_seq`,
      )
      .all(activation.activationId, runAttemptId) as Row[];
    for (const source of inboxRows) {
      const sourceType = text(source, "type");
      const sourcePayload = JSON.parse(text(source, "payload_json")) as Record<
        string,
        unknown
      >;
      const taskId =
        text(source, "aggregate_type") === "task"
          ? text(source, "aggregate_id")
          : typeof sourcePayload.taskId === "string"
            ? sourcePayload.taskId
            : undefined;
      const resolved = outcomes.some((candidate) => {
        if (integer(candidate, "room_seq") <= activation.toSeq) return false;
        const outcomeType = text(candidate, "type");
        const outcomePayload = JSON.parse(
          text(candidate, "payload_json"),
        ) as Record<string, unknown>;
        if (sourceType === "message.posted")
          return outcomeType === "message.posted";
        if (sourceType === "task.submitted") {
          return (
            outcomeType === "review.submitted" &&
            outcomePayload.taskId === taskId
          );
        }
        if (
          sourceType === "task.created" ||
          sourceType === "task.dependency_resolved" ||
          (sourceType === "review.submitted" &&
            sourcePayload.disposition === "changes_requested")
        ) {
          return (
            outcomeType === "task.submitted" && outcomePayload.taskId === taskId
          );
        }
        return false;
      });
      if (!resolved) {
        throw roomError(
          "conflict",
          `Activation has unresolved actionable Inbox item ${text(source, "inbox_item_id")}`,
        );
      }
    }
  }

  #mutateRun(
    workerId: string,
    activationId: string,
    leaseToken: string,
    runAttemptId: string,
    mutate: (run: RoomRunAttempt) => void,
  ): RoomRunAttempt {
    this.#requireIdentifier(workerId, "workerId");
    this.#requireIdentifier(activationId, "activationId");
    this.#requireIdentifier(leaseToken, "leaseToken");
    this.#requireIdentifier(runAttemptId, "runAttemptId");
    return this.#transaction(() => {
      const activation = this.#requireActivation(activationId);
      this.#requireActiveLease(activation, workerId, leaseToken);
      const run = this.#requireRunAttempt(runAttemptId);
      if (run.activationId !== activationId) {
        throw roomError("forbidden", "RunAttempt is outside this Activation");
      }
      mutate(run);
      return this.#requireRunAttempt(runAttemptId);
    });
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
      .run(
        hint.hintId,
        receiptId,
        activationId,
        hint.participantId,
        this.#timestamp(),
      );
  }

  #queuedLane(
    roomId: string,
    participantId: string,
  ): RoomActivation | undefined {
    const row = this.#database
      .prepare(
        `SELECT * FROM room_activations
         WHERE room_id = ? AND participant_id = ? AND state = 'queued'
         ORDER BY activation_seq DESC LIMIT 1`,
      )
      .get(roomId, participantId) as Row | undefined;
    return row ? activationFromRow(row) : undefined;
  }

  #leasedLane(
    roomId: string,
    participantId: string,
  ): RoomActivation | undefined {
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
    if (!row)
      throw roomError("not_found", `Activation ${activationId} was not found`);
    return activationFromRow(row);
  }

  #requireRunAttempt(runAttemptId: string): RoomRunAttempt {
    const row = this.#database
      .prepare("SELECT * FROM room_run_attempts WHERE run_attempt_id = ?")
      .get(runAttemptId) as Row | undefined;
    if (!row)
      throw roomError("not_found", `RunAttempt ${runAttemptId} was not found`);
    return runAttemptFromRow(row);
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
      throw roomError(
        "conflict",
        `Activation ${activation.activationId} lease is not owned`,
      );
    }
    if (
      !activation.leaseExpiresAt ||
      activation.leaseExpiresAt <= this.#timestamp()
    ) {
      throw roomError(
        "conflict",
        `Activation ${activation.activationId} lease has expired`,
      );
    }
  }

  #transaction<T>(operation: () => T): T {
    try {
      this.#database.exec("BEGIN IMMEDIATE");
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        /* preserve primary error */
      }
      if (error instanceof RoomDomainError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/database is (locked|busy)/i.test(message)) {
        throw roomError(
          "unavailable",
          "Room Activation storage is temporarily busy",
        );
      }
      throw error;
    }
  }

  #requireIdentifier(value: string, name: string): void {
    if (!IDENTIFIER.test(value)) {
      throw roomError(
        "invalid_argument",
        `${name} must be a stable identifier`,
      );
    }
  }

  #requireLimit(value: number): void {
    if (!Number.isInteger(value) || value < 1 || value > MAX_LIST) {
      throw roomError(
        "invalid_argument",
        `limit must be between 1 and ${MAX_LIST}`,
      );
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

function runAttemptFromRow(row: Row): RoomRunAttempt {
  const providerSessionId = optionalText(row, "provider_session_id");
  const startedAt = optionalText(row, "started_at");
  const endedAt = optionalText(row, "ended_at");
  const exitCode =
    row.exit_code === null || row.exit_code === undefined
      ? undefined
      : integer(row, "exit_code");
  return {
    runAttemptId: text(row, "run_attempt_id"),
    activationId: text(row, "activation_id"),
    attemptNumber: integer(row, "attempt_number"),
    roomId: text(row, "room_id"),
    participantId: text(row, "participant_id"),
    runtimeProfileId: text(row, "runtime_profile_id"),
    provider: text(row, "provider"),
    workspace: text(row, "workspace"),
    state: text(row, "state") as RoomRunAttempt["state"],
    ...(providerSessionId ? { providerSessionId } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}
