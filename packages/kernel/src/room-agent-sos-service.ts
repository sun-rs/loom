import type { DatabaseSync } from "node:sqlite";

import {
  RoomAgentSosOperationSchema,
  type ClientRoomAgentSosResponse,
  type ClientRoomAgentSosResumeRequest,
  type ClientRoomAgentSosStopRequest,
  type RoomAgentSosOperation,
  type RoomExecutionReadResponse,
} from "@rah-os/protocol";

import type { AuthenticatedActorContext } from "./auth.ts";
import {
  requireRoomManager,
  requireRoomMember,
} from "./collaboration-policy.ts";
import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
  RuntimeTerminationProofError,
  StaleContextError,
} from "./errors.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { cancelStoppedRoomQuarantine } from "./room-stop-quarantine.ts";
import { integer, nullableText, text, type Row } from "./sqlite-row.ts";

export class RoomAgentSosService {
  readonly #createId: (prefix: string) => string;
  readonly #database: DatabaseSync;
  readonly #events: RoomEventWriter;
  readonly #now: () => Date;
  readonly #requireActor: (actor: AuthenticatedActorContext) => string;
  readonly #transaction: <Result>(operation: () => Result) => Result;

  constructor(options: {
    createId: (prefix: string) => string;
    database: DatabaseSync;
    events: RoomEventWriter;
    now: () => Date;
    requireActor: (actor: AuthenticatedActorContext) => string;
    transaction: <Result>(operation: () => Result) => Result;
  }) {
    this.#createId = options.createId;
    this.#database = options.database;
    this.#events = options.events;
    this.#now = options.now;
    this.#requireActor = options.requireActor;
    this.#transaction = options.transaction;
  }

  requestStop(
    actor: AuthenticatedActorContext,
    input: ClientRoomAgentSosStopRequest,
  ): ClientRoomAgentSosResponse {
    return this.#transaction(() => {
      const actorId = this.#requireHumanManager(actor, input.roomId);
      const replay = this.#database
        .prepare(
          "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
        )
        .get(input.roomId, input.idempotencyKey);
      if (replay !== undefined) {
        const payload = JSON.parse(text(replay, "payload_json"));
        if (
          text(replay, "type") !== "room.agent_sos_requested" ||
          text(replay, "actor_id") !== actorId ||
          typeof payload.operationId !== "string" ||
          (payload.resumeOnMessage === true) !==
            (input.resumeOnMessage === true)
        ) {
          throw this.#idempotencyConflict(input.idempotencyKey);
        }
        return this.#result(this.#requireOperation(payload.operationId), true);
      }
      const active = this.#database
        .prepare(
          "SELECT * FROM room_agent_sos_operations WHERE room_id = ? AND state <> 'resumed'",
        )
        .get(input.roomId);
      if (active !== undefined) {
        const request = this.#database
          .prepare("SELECT payload_json FROM room_events WHERE event_id = ?")
          .get(text(active, "request_event_id"))!;
        if (
          input.resumeOnMessage === true ||
          JSON.parse(text(request, "payload_json")).resumeOnMessage !== true
        )
          return this.#result(active, true);

        // Tightening a stop must never briefly release the hold or replace
        // its attempt-scoped terminal-proof targets. Original events stay immutable.
        this.#assertFresh(input.roomId, input.basedOnRoomSeq);
        const operationId = text(active, "operation_id");
        const event = this.#events.append({
          actorId,
          aggregateId: operationId,
          aggregateType: "room_agent_sos",
          idempotencyKey: input.idempotencyKey,
          payload: {
            basedOnRoomSeq: input.basedOnRoomSeq,
            operationId,
            resumeOnMessage: false,
            supersedesRequestEventId: text(active, "request_event_id"),
          },
          roomId: input.roomId,
          type: "room.agent_sos_requested",
        });
        this.#database
          .prepare(
            "UPDATE room_agent_sos_operations SET request_event_id = ?, updated_at = ? WHERE operation_id = ?",
          )
          .run(event.eventId, this.#now().toISOString(), operationId);
        return {
          deduplicated: false,
          event,
          operation: this.#projection(this.#requireOperation(operationId)),
        };
      }

      this.#assertFresh(input.roomId, input.basedOnRoomSeq);
      const requestedAt = this.#now().toISOString();
      const operationId = this.#createId("room_sos");
      const requestEvent = this.#events.append({
        actorId,
        aggregateId: operationId,
        aggregateType: "room_agent_sos",
        idempotencyKey: input.idempotencyKey,
        payload: {
          basedOnRoomSeq: input.basedOnRoomSeq,
          operationId,
          resumeOnMessage: input.resumeOnMessage === true,
        },
        roomId: input.roomId,
        type: "room.agent_sos_requested",
      });
      cancelStoppedRoomQuarantine({
        database: this.#database,
        events: this.#events,
        request: requestEvent,
        now: requestedAt,
      });
      this.#database
        .prepare(
          `INSERT INTO room_agent_sos_operations(
             operation_id, room_id, requested_by, idempotency_key, state,
             request_event_id, created_at, updated_at
           ) VALUES(?, ?, ?, ?, 'stopping', ?, ?, ?)`,
        )
        .run(
          operationId,
          input.roomId,
          actorId,
          input.idempotencyKey,
          requestEvent.eventId,
          requestedAt,
          requestedAt,
        );
      this.#database
        .prepare(
          "INSERT INTO room_agent_sos_holds(room_id, operation_id, created_at) VALUES(?, ?, ?)",
        )
        .run(input.roomId, operationId, requestedAt);

      const leased = this.#database
        .prepare(
          `SELECT activation_id, attempt_count, participant_id
           FROM activations
           WHERE room_id = ? AND state = 'leased' AND attempt_count > 0
           ORDER BY participant_id, activation_id`,
        )
        .all(input.roomId);
      for (const activation of leased) {
        this.#database
          .prepare(
            `INSERT INTO room_agent_sos_targets(
               target_id, operation_id, activation_id,
               activation_attempt_number, participant_id, state, requested_at
             ) VALUES(?, ?, ?, ?, ?, 'requested', ?)`,
          )
          .run(
            this.#createId("room_sos_target"),
            operationId,
            text(activation, "activation_id"),
            integer(activation, "attempt_count"),
            text(activation, "participant_id"),
            requestedAt,
          );
      }
      const operation = this.#requireOperation(operationId);
      return leased.length === 0
        ? this.#finishStop(operation, false)
        : this.#result(operation, false);
    });
  }

  continueStop(
    actor: AuthenticatedActorContext,
    input: { operationId: string },
  ): ClientRoomAgentSosResponse {
    return this.#transaction(() => {
      const operation = this.#requireOperation(input.operationId);
      this.#requireHumanManager(actor, text(operation, "room_id"));
      if (["stopped", "resumed"].includes(text(operation, "state"))) {
        return this.#result(operation, true);
      }
      if (text(operation, "state") !== "stopping") {
        throw new ConflictError(
          `Room Agent SOS ${input.operationId} cannot continue from ${text(operation, "state")}`,
        );
      }
      const pending = this.#pendingTargetCount(input.operationId);
      if (pending > 0) {
        throw new RuntimeTerminationProofError(
          `Room Agent SOS ${input.operationId} is waiting for ${String(pending)} Runtime terminal proof(s)`,
        );
      }
      return this.#finishStop(operation, false);
    });
  }

  read(
    actor: AuthenticatedActorContext,
    input: { roomId: string },
  ): RoomExecutionReadResponse {
    this.#requireHumanManager(actor, input.roomId);
    const operation = this.#database
      .prepare(
        "SELECT * FROM room_agent_sos_operations WHERE room_id = ? AND state <> 'resumed'",
      )
      .get(input.roomId);
    const room = this.#database
      .prepare("SELECT next_seq FROM rooms WHERE room_id = ?")
      .get(input.roomId)!;
    const work = this.#database
      .prepare(
        "SELECT 1 FROM activations WHERE room_id = ? AND state IN ('queued', 'leased') LIMIT 1",
      )
      .get(input.roomId);
    return {
      operation: operation ? this.#projection(operation) : null,
      latestRoomSeq: integer(room, "next_seq") - 1,
      working: operation === undefined && work !== undefined,
    };
  }

  settleTerminalStop(roomId: string): void {
    const operation = this.#database
      .prepare(
        "SELECT * FROM room_agent_sos_operations WHERE room_id = ? AND state = 'stopping'",
      )
      .get(roomId);
    if (
      operation &&
      this.#pendingTargetCount(text(operation, "operation_id")) === 0
    )
      this.#finishStop(operation, false);
  }

  withHumanInput<Result>(roomId: string, command: () => Result): Result {
    return this.#transaction(() => {
      const result = command();
      this.resumeAfterHumanMessage(roomId);
      return result;
    });
  }

  // Called inside the message/stop transaction. A queued correction cannot lift
  // the execution fence before all previous processes have terminal proof.
  resumeAfterHumanMessage(roomId: string): void {
    const operation = this.#database
      .prepare(
        `SELECT operation.*, event.room_seq AS request_seq, event.payload_json
      FROM room_agent_sos_operations AS operation JOIN room_events AS event ON event.event_id = operation.request_event_id
      WHERE operation.room_id = ? AND operation.state = 'stopped'`,
      )
      .get(roomId);
    if (
      !operation ||
      JSON.parse(text(operation, "payload_json")).resumeOnMessage !== true
    )
      return;
    const message = this.#database
      .prepare(
        `SELECT event.* FROM room_events AS event
      JOIN principals ON principals.principal_id = event.actor_id
      WHERE event.room_id = ? AND event.room_seq > ? AND event.type IN ('message.posted', 'task.created') AND principals.kind = 'human'
      ORDER BY event.room_seq DESC LIMIT 1`,
      )
      .get(roomId, integer(operation, "request_seq"));
    if (!message) return;
    const operationId = text(operation, "operation_id");
    const payload = JSON.parse(text(message, "payload_json"));
    const content = payload.body ?? payload.title;
    const guidance = typeof content === "string" ? content.slice(0, 4000) : "";
    const now = this.#now().toISOString();
    const event = this.#events.append({
      actorId: text(message, "actor_id"),
      aggregateId: operationId,
      aggregateType: "room_agent_sos",
      idempotencyKey: `composer-resume:${operationId}`,
      roomId,
      type: "room.agent_sos_resumed",
      payload: {
        operationId,
        guidance,
        inputEventId: text(message, "event_id"),
      },
    });
    this.#events.deriveAttention(event, payload.recipients ?? [], now);
    this.#database
      .prepare(
        "UPDATE room_agent_sos_operations SET state = 'resumed', resume_event_id = ?, guidance = ?, resumed_at = ?, updated_at = ? WHERE operation_id = ?",
      )
      .run(event.eventId, guidance, now, now, operationId);
    this.#database
      .prepare("DELETE FROM room_agent_sos_holds WHERE room_id = ?")
      .run(roomId);
  }

  resume(
    actor: AuthenticatedActorContext,
    input: ClientRoomAgentSosResumeRequest,
  ): ClientRoomAgentSosResponse {
    return this.#transaction(() => {
      const actorId = this.#requireHumanManager(actor, input.roomId);
      const guidance = input.guidance.trim();
      if (guidance.length === 0 || guidance.length > 4_000) {
        throw new Error("guidance must contain 1 to 4000 characters");
      }
      const replay = this.#database
        .prepare(
          `SELECT * FROM room_events
           WHERE room_id = ? AND actor_id = ? AND idempotency_key = ?
           LIMIT 1`,
        )
        .get(input.roomId, actorId, input.idempotencyKey);
      if (replay !== undefined) {
        const payload = JSON.parse(text(replay, "payload_json"));
        if (
          text(replay, "type") !== "room.agent_sos_resumed" ||
          payload.guidance !== guidance ||
          typeof payload.operationId !== "string"
        ) {
          throw this.#idempotencyConflict(input.idempotencyKey);
        }
        return this.#result(this.#requireOperation(payload.operationId), true);
      }
      const operation = this.#database
        .prepare(
          `SELECT operation.*
           FROM room_agent_sos_holds AS hold
           JOIN room_agent_sos_operations AS operation
             ON operation.operation_id = hold.operation_id
           WHERE hold.room_id = ?`,
        )
        .get(input.roomId);
      if (operation === undefined) {
        throw new ConflictError(
          `Room ${input.roomId} has no stopped Agent SOS`,
        );
      }
      if (text(operation, "state") !== "stopped") {
        throw new ConflictError(
          `Room Agent SOS ${text(operation, "operation_id")} is not fully stopped`,
        );
      }
      this.#assertFresh(input.roomId, input.basedOnRoomSeq);
      const resumedAt = this.#now().toISOString();
      const operationId = text(operation, "operation_id");
      const event = this.#events.append({
        actorId,
        aggregateId: operationId,
        aggregateType: "room_agent_sos",
        idempotencyKey: input.idempotencyKey,
        payload: {
          basedOnRoomSeq: input.basedOnRoomSeq,
          guidance,
          operationId,
        },
        roomId: input.roomId,
        type: "room.agent_sos_resumed",
      });
      const recipients = this.#database
        .prepare(
          `SELECT memberships.principal_id
           FROM memberships
           JOIN principals ON principals.principal_id = memberships.principal_id
           LEFT JOIN agent_definitions
             ON agent_definitions.participant_id = memberships.principal_id
           WHERE memberships.room_id = ?
             AND principals.kind = 'agent'
             AND (agent_definitions.state IS NULL OR agent_definitions.state = 'enabled')
           ORDER BY memberships.principal_id`,
        )
        .all(input.roomId)
        .map((row) => ({
          participantId: text(row, "principal_id"),
          reason: "manual" as const,
        }));
      this.#events.deriveAttention(event, recipients, resumedAt);
      this.#database
        .prepare(
          `UPDATE room_agent_sos_operations
           SET state = 'resumed', resume_event_id = ?, guidance = ?,
               resumed_at = ?, updated_at = ?
           WHERE operation_id = ?`,
        )
        .run(event.eventId, guidance, resumedAt, resumedAt, operationId);
      this.#database
        .prepare("DELETE FROM room_agent_sos_holds WHERE room_id = ?")
        .run(input.roomId);
      return {
        deduplicated: false,
        event,
        operation: this.#projection(this.#requireOperation(operationId)),
      };
    });
  }

  #finishStop(
    operation: Row,
    deduplicated: boolean,
  ): ClientRoomAgentSosResponse {
    const operationId = text(operation, "operation_id");
    if (text(operation, "state") === "stopped") {
      return this.#result(operation, true);
    }
    const stoppedAt = this.#now().toISOString();
    const event = this.#events.append({
      actorId: text(operation, "requested_by"),
      aggregateId: operationId,
      aggregateType: "room_agent_sos",
      idempotencyKey: `${text(operation, "idempotency_key")}:stopped`,
      payload: {
        operationId,
        targetCount: this.#targetCount(operationId),
      },
      roomId: text(operation, "room_id"),
      type: "room.agent_sos_stopped",
    });
    this.#database
      .prepare(
        `UPDATE room_agent_sos_operations
         SET state = 'stopped', stopped_event_id = ?, stopped_at = ?, updated_at = ?
         WHERE operation_id = ?`,
      )
      .run(event.eventId, stoppedAt, stoppedAt, operationId);
    this.resumeAfterHumanMessage(text(operation, "room_id"));
    if (text(this.#requireOperation(operationId), "state") === "resumed")
      return this.#result(this.#requireOperation(operationId), deduplicated);
    return {
      deduplicated,
      event,
      operation: this.#projection(this.#requireOperation(operationId)),
    };
  }

  #result(operation: Row, deduplicated: boolean): ClientRoomAgentSosResponse {
    const eventId =
      nullableText(operation, "resume_event_id") ??
      nullableText(operation, "stopped_event_id") ??
      text(operation, "request_event_id");
    const eventRow = this.#database
      .prepare("SELECT * FROM room_events WHERE event_id = ?")
      .get(eventId);
    if (eventRow === undefined) {
      throw new NotFoundError(`Room Agent SOS event ${eventId} was not found`);
    }
    return {
      deduplicated,
      event: this.#events.eventFromRow(eventRow),
      operation: this.#projection(operation),
    };
  }

  #projection(row: Row): RoomAgentSosOperation {
    const operationId = text(row, "operation_id");
    const guidance = nullableText(row, "guidance");
    const resumedAt = nullableText(row, "resumed_at");
    const stoppedAt = nullableText(row, "stopped_at");
    return RoomAgentSosOperationSchema.parse({
      ...(guidance === null ? {} : { guidance }),
      operationId,
      pendingTargetCount: this.#pendingTargetCount(operationId),
      requestedAt: text(row, "created_at"),
      requestedBy: text(row, "requested_by"),
      ...(resumedAt === null ? {} : { resumedAt }),
      roomId: text(row, "room_id"),
      state: text(row, "state"),
      ...(stoppedAt === null ? {} : { stoppedAt }),
      targetCount: this.#targetCount(operationId),
      updatedAt: text(row, "updated_at"),
    });
  }

  #requireHumanManager(
    actor: AuthenticatedActorContext,
    roomId: string,
  ): string {
    const actorId = this.#requireActor(actor);
    const principal = this.#database
      .prepare("SELECT kind FROM principals WHERE principal_id = ?")
      .get(actorId);
    if (principal === undefined || text(principal, "kind") !== "human") {
      throw new ForbiddenError(
        "Room Agent SOS requires an authenticated Human",
      );
    }
    const room = this.#database
      .prepare("SELECT kind, archived_at FROM rooms WHERE room_id = ?")
      .get(roomId);
    if (room === undefined) {
      throw new NotFoundError(`room ${roomId} was not found`);
    }
    if (!["channel", "direct"].includes(text(room, "kind"))) {
      throw new ForbiddenError(
        "Room Agent SOS requires a Channel or direct Room",
      );
    }
    if (nullableText(room, "archived_at") !== null) {
      throw new ConflictError(`Room ${roomId} is archived and read-only`);
    }
    if (text(room, "kind") === "direct")
      requireRoomMember(this.#database, roomId, actorId);
    else requireRoomManager(this.#database, roomId, actorId);
    return actorId;
  }

  #assertFresh(roomId: string, basedOnRoomSeq: number): void {
    const room = this.#database
      .prepare("SELECT next_seq FROM rooms WHERE room_id = ?")
      .get(roomId);
    if (room === undefined) {
      throw new NotFoundError(`room ${roomId} was not found`);
    }
    const latestRoomSeq = integer(room, "next_seq") - 1;
    if (basedOnRoomSeq !== latestRoomSeq) {
      throw new StaleContextError(basedOnRoomSeq, latestRoomSeq);
    }
  }

  #requireOperation(operationId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM room_agent_sos_operations WHERE operation_id = ?")
      .get(operationId);
    if (row === undefined) {
      throw new NotFoundError(`Room Agent SOS ${operationId} was not found`);
    }
    return row;
  }

  #targetCount(operationId: string): number {
    const row = this.#database
      .prepare(
        "SELECT COUNT(*) AS count FROM room_agent_sos_targets WHERE operation_id = ?",
      )
      .get(operationId);
    return row === undefined ? 0 : integer(row, "count");
  }

  #pendingTargetCount(operationId: string): number {
    const row = this.#database
      .prepare(
        "SELECT COUNT(*) AS count FROM room_agent_sos_targets WHERE operation_id = ? AND state = 'requested'",
      )
      .get(operationId);
    return row === undefined ? 0 : integer(row, "count");
  }

  #idempotencyConflict(idempotencyKey: string): IdempotencyConflictError {
    return new IdempotencyConflictError(
      `idempotency key ${idempotencyKey} was already used for a different Room Agent SOS command`,
    );
  }
}
