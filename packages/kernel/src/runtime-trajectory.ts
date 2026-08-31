import type { DatabaseSync } from "node:sqlite";

import {
  ClientAgentTrajectoryListResponseSchema,
  RuntimeTrajectoryAppendInputSchema,
  RuntimeTrajectoryRecordSchema,
  type ClientAgentTrajectoryListResponse,
  type RuntimeTrajectoryAppendInput,
  type RuntimeTrajectoryRecord,
} from "@rah-os/protocol";

import type {
  AuthenticatedActorContext,
  AuthenticatedHostContext,
} from "./auth.ts";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors.ts";
import { text, type Row } from "./sqlite-row.ts";

export type AgentTrajectoryListInput = {
  agentDefinitionId: string;
  beforeActivityId?: string;
  limit?: number;
};

export type RuntimeTrajectoryServiceOptions = {
  createId: (prefix: string) => string;
  database: DatabaseSync;
  now: () => Date;
  requireActor: (actor: AuthenticatedActorContext) => string;
  requireHost: (host: AuthenticatedHostContext) => AuthenticatedHostContext;
  requireHostParticipant: (
    host: AuthenticatedHostContext,
    participantId: string,
  ) => void;
  requireRunAttemptHostGeneration: (
    runAttempt: Row,
    host: AuthenticatedHostContext,
  ) => void;
};

export class RuntimeTrajectoryService {
  readonly #createId: (prefix: string) => string;
  readonly #database: DatabaseSync;
  readonly #now: () => Date;
  readonly #requireActor: (actor: AuthenticatedActorContext) => string;
  readonly #requireHost: (
    host: AuthenticatedHostContext,
  ) => AuthenticatedHostContext;
  readonly #requireHostParticipant: (
    host: AuthenticatedHostContext,
    participantId: string,
  ) => void;
  readonly #requireRunAttemptHostGeneration: (
    runAttempt: Row,
    host: AuthenticatedHostContext,
  ) => void;

  constructor(options: RuntimeTrajectoryServiceOptions) {
    this.#createId = options.createId;
    this.#database = options.database;
    this.#now = options.now;
    this.#requireActor = options.requireActor;
    this.#requireHost = options.requireHost;
    this.#requireHostParticipant = options.requireHostParticipant;
    this.#requireRunAttemptHostGeneration =
      options.requireRunAttemptHostGeneration;
  }

  append(
    host: AuthenticatedHostContext,
    untrustedInput: RuntimeTrajectoryAppendInput,
  ): RuntimeTrajectoryRecord {
    const authenticatedHost = this.#requireHost(host);
    const input = RuntimeTrajectoryAppendInputSchema.parse(untrustedInput);
    return this.#transaction(() => {
      const runAttempt = this.#requireRunAttempt(input.runAttemptId);
      const participantId = text(runAttempt, "participant_id");
      this.#requireHostParticipant(authenticatedHost, participantId);
      if (text(runAttempt, "host_id") !== authenticatedHost.hostId) {
        throw new ForbiddenError(
          `host ${authenticatedHost.hostId} does not own run attempt ${input.runAttemptId}`,
        );
      }
      this.#requireRunAttemptHostGeneration(runAttempt, authenticatedHost);
      const runState = text(runAttempt, "state");
      if (runState !== "starting" && runState !== "running") {
        throw new ConflictError(
          `run attempt ${input.runAttemptId} cannot accept runtime trajectory`,
        );
      }
      const runtimeProcess = this.#database
        .prepare("SELECT * FROM runtime_processes WHERE run_attempt_id = ?")
        .get(input.runAttemptId);
      if (
        runtimeProcess === undefined ||
        text(runtimeProcess, "runtime_run_id") !== input.runtimeRunId ||
        !["active", "prepared"].includes(text(runtimeProcess, "state"))
      ) {
        throw new ConflictError(
          `run attempt ${input.runAttemptId} has no matching prepared runtime`,
        );
      }
      return appendRunTrajectory(this.#database, input, {
        activityId: this.#createId("runtime_activity"),
        participantId,
        recordedAt: this.#now().toISOString(),
        roomId: text(runAttempt, "room_id"),
      });
    });
  }

  list(
    actor: AuthenticatedActorContext,
    input: AgentTrajectoryListInput,
  ): ClientAgentTrajectoryListResponse {
    return listAgentTrajectory(
      this.#database,
      this.#requireActor(actor),
      input,
    );
  }

  #requireRunAttempt(runAttemptId: string): Row {
    const row = this.#database
      .prepare("SELECT * FROM run_attempts WHERE run_attempt_id = ?")
      .get(runAttemptId);
    if (row === undefined) {
      throw new NotFoundError(`run attempt ${runAttemptId} was not found`);
    }
    return row;
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}

export function appendRunTrajectory(
  database: DatabaseSync,
  input: RuntimeTrajectoryAppendInput,
  identity: {
    activityId: string;
    participantId: string;
    recordedAt: string;
    roomId: string;
  },
): RuntimeTrajectoryRecord {
  const activity = RuntimeTrajectoryAppendInputSchema.parse(input);
  const entryJson = JSON.stringify(activity.entry);
  const existing = database
    .prepare(
      "SELECT * FROM run_trajectory_entries WHERE runtime_run_id = ? AND producer_sequence = ?",
    )
    .get(activity.runtimeRunId, activity.producerSequence);
  if (existing !== undefined) {
    if (
      text(existing, "run_attempt_id") !== activity.runAttemptId ||
      text(existing, "observed_at") !== activity.observedAt ||
      text(existing, "entry_json") !== entryJson
    ) {
      throw new ConflictError(
        "runtime trajectory producer sequence conflicts with an existing fact",
      );
    }
    return trajectoryFromRow(existing);
  }
  database
    .prepare(
      `INSERT INTO run_trajectory_entries(
         activity_id, run_attempt_id, runtime_run_id, room_id,
         participant_id, producer_sequence, observed_at, entry_json, recorded_at
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      identity.activityId,
      activity.runAttemptId,
      activity.runtimeRunId,
      identity.roomId,
      identity.participantId,
      activity.producerSequence,
      activity.observedAt,
      entryJson,
      identity.recordedAt,
    );
  return trajectoryFromRow(
    database
      .prepare("SELECT * FROM run_trajectory_entries WHERE activity_id = ?")
      .get(identity.activityId)!,
  );
}

export function listAgentTrajectory(
  database: DatabaseSync,
  actorId: string,
  input: AgentTrajectoryListInput,
): ClientAgentTrajectoryListResponse {
  const scope = database
    .prepare(
      `SELECT agent_definitions.participant_id, rooms.workspace_id
       FROM agent_definitions
       JOIN rooms ON rooms.room_id = agent_definitions.control_room_id
       JOIN memberships AS actor_control_membership
         ON actor_control_membership.room_id = agent_definitions.control_room_id
        AND actor_control_membership.principal_id = ?
       JOIN principals AS actor
         ON actor.principal_id = actor_control_membership.principal_id
        AND actor.kind = 'human'
       WHERE agent_definitions.agent_definition_id = ?
         AND agent_definitions.state <> 'tombstoned'`,
    )
    .get(actorId, input.agentDefinitionId);
  if (scope === undefined) {
    throw new NotFoundError(
      `AgentDefinition ${input.agentDefinitionId} was not found`,
    );
  }
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Agent trajectory limit must be between 1 and 100");
  }
  const participantId = text(scope, "participant_id");
  const workspaceId = text(scope, "workspace_id");
  const visibleSql = `
    SELECT trajectory.*, rooms.name AS context_room_name, rooms.kind AS context_room_kind
    FROM run_trajectory_entries AS trajectory
    JOIN rooms ON rooms.room_id = trajectory.room_id
    JOIN memberships AS actor_membership
      ON actor_membership.room_id = trajectory.room_id
     AND actor_membership.principal_id = ?
    WHERE trajectory.participant_id = ?
      AND rooms.workspace_id = ?`;
  const parameters: Array<number | string> = [
    actorId,
    participantId,
    workspaceId,
  ];
  let cursorClause = "";
  if (input.beforeActivityId !== undefined) {
    const cursor = database
      .prepare(`${visibleSql} AND trajectory.activity_id = ?`)
      .get(...parameters, input.beforeActivityId);
    if (cursor === undefined) {
      throw new NotFoundError("Agent trajectory cursor was not found");
    }
    cursorClause = "AND trajectory.server_sequence < ?";
    parameters.push(Number(cursor.server_sequence));
  }
  const rows = database
    .prepare(
      `${visibleSql} ${cursorClause}
       ORDER BY trajectory.server_sequence DESC
       LIMIT ?`,
    )
    .all(...parameters, limit + 1);
  const hasMore = rows.length > limit;
  const activities = rows.slice(0, limit).map(trajectoryFromRow);
  return ClientAgentTrajectoryListResponseSchema.parse({
    activities,
    ...(hasMore && activities.length > 0
      ? { nextCursor: activities.at(-1)!.activityId }
      : {}),
  });
}

function trajectoryFromRow(row: Row): RuntimeTrajectoryRecord {
  return RuntimeTrajectoryRecordSchema.parse({
    activityId: text(row, "activity_id"),
    entry: JSON.parse(text(row, "entry_json")) as unknown,
    observedAt: text(row, "observed_at"),
    participantId: text(row, "participant_id"),
    producerSequence: Number(row.producer_sequence),
    recordedAt: text(row, "recorded_at"),
    roomId: text(row, "room_id"),
    runAttemptId: text(row, "run_attempt_id"),
    runtimeRunId: text(row, "runtime_run_id"),
    serverSequence: Number(row.server_sequence),
    ...(row.context_room_name !== undefined
      ? {
          context: {
            roomId: text(row, "room_id"),
            roomName: text(row, "context_room_name"),
            roomKind: text(row, "context_room_kind"),
          },
        }
      : {}),
  });
}
