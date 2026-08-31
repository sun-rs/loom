import type { DatabaseSync } from "node:sqlite";

import {
  ManagedMcpCallRequestSchema,
  ManagedMcpCallResultSchema,
  ManagedMcpCatalogSchema,
  ManagedMcpServerDefinitionSchema,
  ManagedMcpUsageRecordSchema,
  type ActivationCredentialScope,
  type ManagedMcpCallRequest,
  type ManagedMcpCallResult,
  type ManagedMcpCatalog,
  type ManagedMcpServerDefinition,
  type ManagedMcpToolDefinition,
  type ManagedMcpUsageRecord,
  type RoomEvent,
} from "@rah-os/protocol";

import type {
  AuthenticatedActorContext,
  AuthenticatedWorkerExecutionContext,
} from "./auth.ts";
import { canonicalDigest } from "./canonical-digest.ts";
import { requireHumanControlRoomManager } from "./collaboration-policy.ts";
import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
  StaleContextError,
} from "./errors.ts";
import { eventPayloadText } from "./event-payload.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import {
  integer,
  nullableInteger,
  nullableText,
  text,
  type Row,
} from "./sqlite-row.ts";

export type ManagedMcpServerRecord = {
  configVersion: number;
  controlRoomId: string;
  currentRevisionId: string;
  definition: ManagedMcpServerDefinition;
  mcpServerId: string;
  state: "disabled" | "enabled";
};

export type ManagedMcpAssignmentRecord = {
  allowedToolNames: string[];
  assignmentId: string;
  assignmentVersion: number;
  currentRevisionId: string;
  enabled: boolean;
  mcpServerId: string;
  participantId: string;
};

export type ManagedMcpServerMutationResult = {
  deduplicated: boolean;
  event: RoomEvent;
  server: ManagedMcpServerRecord;
};

export type ManagedMcpAssignmentMutationResult = {
  assignment: ManagedMcpAssignmentRecord;
  deduplicated: boolean;
  event: RoomEvent;
};

export type ManagedMcpUsagePage = {
  calls: ManagedMcpUsageRecord[];
  nextCursor?: string;
};

export type ManagedMcpAuthorizedCall = {
  call: {
    arguments: Record<string, unknown>;
    assignmentVersion: number;
    configVersion: number;
    managedMcpCallId: string;
    mcpServerId: string;
    participantId: string;
    roomId: string;
    runAttemptId: string;
    toolName: string;
  };
  executorRef: string;
  tool: ManagedMcpToolDefinition;
};

export type ManagedMcpServiceOptions = {
  createId: (prefix: string) => string;
  database: DatabaseSync;
  events: RoomEventWriter;
  now: () => Date;
  requireActor: (actor: AuthenticatedActorContext) => string;
  requireWorker: (
    execution: AuthenticatedWorkerExecutionContext,
  ) => ActivationCredentialScope;
};

export class ManagedMcpService {
  readonly #createId: (prefix: string) => string;
  readonly #database: DatabaseSync;
  readonly #events: RoomEventWriter;
  readonly #now: () => Date;
  readonly #requireActor: (actor: AuthenticatedActorContext) => string;
  readonly #requireWorker: (
    execution: AuthenticatedWorkerExecutionContext,
  ) => ActivationCredentialScope;

  constructor(options: ManagedMcpServiceOptions) {
    this.#createId = options.createId;
    this.#database = options.database;
    this.#events = options.events;
    this.#now = options.now;
    this.#requireActor = options.requireActor;
    this.#requireWorker = options.requireWorker;
  }

  createServer(
    actor: AuthenticatedActorContext,
    input: {
      controlRoomId: string;
      definition: ManagedMcpServerDefinition;
      basedOnRoomSeq: number;
      idempotencyKey: string;
      mcpServerId: string;
    },
  ): ManagedMcpServerMutationResult {
    const definition = ManagedMcpServerDefinitionSchema.parse(input.definition);
    const mcpServerId = requiredIdentifier(input.mcpServerId, "mcpServerId");
    const idempotencyKey = requiredIdentifier(
      input.idempotencyKey,
      "idempotencyKey",
    );
    const requestDigest = canonicalDigest({
      basedOnRoomSeq: input.basedOnRoomSeq,
      definition,
      domain: "rah/managed-mcp-server-create/v1",
      mcpServerId,
    });
    return this.#transaction(() => {
      const actorId = this.#requireActor(actor);
      requireHumanControlRoomManager(
        this.#database,
        input.controlRoomId,
        actorId,
      );
      const previous = this.#findEvent(input.controlRoomId, idempotencyKey);
      if (previous !== undefined) {
        return this.#serverMutationReplay(
          previous,
          actorId,
          mcpServerId,
          "mcp_server.created",
          requestDigest,
        );
      }
      this.#assertFreshContext(input.controlRoomId, input.basedOnRoomSeq);
      if (this.#findServer(mcpServerId) !== undefined) {
        throw new ConflictError(`managed MCP Server ${mcpServerId} exists`);
      }
      const createdAt = this.#now().toISOString();
      const revisionId = this.#createId("managed_mcp_server_revision");
      this.#database
        .prepare(
          `INSERT INTO managed_mcp_servers(
             mcp_server_id, control_room_id, current_config_version,
             current_revision_id, state, created_at, updated_at
           ) VALUES(?, ?, 1, ?, 'enabled', ?, ?)`,
        )
        .run(
          mcpServerId,
          input.controlRoomId,
          revisionId,
          createdAt,
          createdAt,
        );
      this.#insertServerRevision({
        actorId,
        configVersion: 1,
        createdAt,
        definition,
        mcpServerId,
        revisionId,
      });
      const event = this.#events.append({
        actorId,
        aggregateId: mcpServerId,
        aggregateType: "managed_mcp_server",
        idempotencyKey,
        payload: {
          basedOnRoomSeq: input.basedOnRoomSeq,
          configVersion: 1,
          managedMcpServerRevisionId: revisionId,
          requestDigest,
          state: "enabled",
        },
        roomId: input.controlRoomId,
        type: "mcp_server.created",
      });
      return {
        deduplicated: false,
        event,
        server: this.#serverRecordFromEvent(event),
      };
    });
  }

  reviseServer(
    actor: AuthenticatedActorContext,
    input: {
      definition: ManagedMcpServerDefinition;
      basedOnRoomSeq: number;
      expectedConfigVersion: number;
      idempotencyKey: string;
      mcpServerId: string;
    },
  ): ManagedMcpServerMutationResult {
    const definition = ManagedMcpServerDefinitionSchema.parse(input.definition);
    return this.#transaction(() => {
      const server = this.#requireServer(input.mcpServerId);
      const actorId = this.#requireActor(actor);
      const controlRoomId = text(server, "control_room_id");
      requireHumanControlRoomManager(this.#database, controlRoomId, actorId);
      const idempotencyKey = requiredIdentifier(
        input.idempotencyKey,
        "idempotencyKey",
      );
      const requestDigest = canonicalDigest({
        basedOnRoomSeq: input.basedOnRoomSeq,
        definition,
        domain: "rah/managed-mcp-server-revise/v1",
        expectedConfigVersion: input.expectedConfigVersion,
        mcpServerId: input.mcpServerId,
      });
      const previous = this.#findEvent(controlRoomId, idempotencyKey);
      if (previous !== undefined) {
        return this.#serverMutationReplay(
          previous,
          actorId,
          input.mcpServerId,
          "mcp_server.revised",
          requestDigest,
        );
      }
      this.#assertFreshContext(controlRoomId, input.basedOnRoomSeq);
      const currentVersion = integer(server, "current_config_version");
      if (currentVersion !== input.expectedConfigVersion) {
        throw new ConflictError(
          `managed MCP Server ${input.mcpServerId} config version is stale`,
        );
      }
      const nextToolNames = new Set(
        definition.tools.map(({ toolName }) => toolName),
      );
      const assignedToolNames = this.#database
        .prepare(
          `SELECT revision.allowed_tool_names_json
           FROM managed_mcp_assignments AS assignment
           JOIN managed_mcp_assignment_revisions AS revision
             ON revision.managed_mcp_assignment_revision_id =
                assignment.current_revision_id
           WHERE assignment.mcp_server_id = ? AND assignment.enabled = 1`,
        )
        .all(input.mcpServerId)
        .flatMap((row) => stringArray(row, "allowed_tool_names_json"));
      if (assignedToolNames.some((toolName) => !nextToolNames.has(toolName))) {
        throw new ConflictError(
          "managed MCP config cannot remove a tool used by an active assignment",
        );
      }
      const configVersion = currentVersion + 1;
      const revisionId = this.#createId("managed_mcp_server_revision");
      const createdAt = this.#now().toISOString();
      this.#insertServerRevision({
        actorId,
        configVersion,
        createdAt,
        definition,
        mcpServerId: input.mcpServerId,
        revisionId,
      });
      this.#database
        .prepare(
          `UPDATE managed_mcp_servers
           SET current_config_version = ?, current_revision_id = ?,
               updated_at = ?
           WHERE mcp_server_id = ?`,
        )
        .run(configVersion, revisionId, createdAt, input.mcpServerId);
      const event = this.#events.append({
        actorId,
        aggregateId: input.mcpServerId,
        aggregateType: "managed_mcp_server",
        idempotencyKey,
        payload: {
          basedOnRoomSeq: input.basedOnRoomSeq,
          configVersion,
          managedMcpServerRevisionId: revisionId,
          requestDigest,
          state: text(server, "state"),
        },
        roomId: controlRoomId,
        type: "mcp_server.revised",
      });
      return {
        deduplicated: false,
        event,
        server: this.#serverRecordFromEvent(event),
      };
    });
  }

  assignServer(
    actor: AuthenticatedActorContext,
    input: {
      allowedToolNames: string[];
      basedOnRoomSeq: number;
      idempotencyKey: string;
      mcpServerId: string;
      participantId: string;
    },
  ): ManagedMcpAssignmentMutationResult {
    return this.#transaction(() => {
      const server = this.#requireServer(input.mcpServerId);
      const actorId = this.#requireActor(actor);
      const controlRoomId = text(server, "control_room_id");
      requireHumanControlRoomManager(this.#database, controlRoomId, actorId);
      const idempotencyKey = requiredIdentifier(
        input.idempotencyKey,
        "idempotencyKey",
      );
      const normalizedToolNames = normalizeToolNames(input.allowedToolNames);
      const requestDigest = canonicalDigest({
        allowedToolNames: normalizedToolNames,
        basedOnRoomSeq: input.basedOnRoomSeq,
        domain: "rah/managed-mcp-assignment-create/v1",
        mcpServerId: input.mcpServerId,
        participantId: input.participantId,
      });
      const previous = this.#findEvent(controlRoomId, idempotencyKey);
      if (previous !== undefined) {
        return this.#assignmentMutationReplay(
          previous,
          actorId,
          input,
          "mcp_assignment.created",
          requestDigest,
        );
      }
      this.#assertFreshContext(controlRoomId, input.basedOnRoomSeq);
      this.#requireManagedAgent(controlRoomId, input.participantId);
      if (this.#findAssignment(input) !== undefined) {
        throw new ConflictError(
          `managed MCP assignment for ${input.participantId} and ${input.mcpServerId} exists`,
        );
      }
      const allowedToolNames = this.#validateAllowedTools(
        server,
        normalizedToolNames,
      );
      const assignmentId = this.#createId("managed_mcp_assignment");
      const revisionId = this.#createId("managed_mcp_assignment_revision");
      const createdAt = this.#now().toISOString();
      this.#database
        .prepare(
          `INSERT INTO managed_mcp_assignments(
             managed_mcp_assignment_id, participant_id, mcp_server_id,
             current_assignment_version, current_revision_id, enabled,
             created_at, updated_at
           ) VALUES(?, ?, ?, 1, ?, 1, ?, ?)`,
        )
        .run(
          assignmentId,
          input.participantId,
          input.mcpServerId,
          revisionId,
          createdAt,
          createdAt,
        );
      this.#insertAssignmentRevision({
        actorId,
        allowedToolNames,
        assignmentId,
        assignmentVersion: 1,
        createdAt,
        revisionId,
      });
      const event = this.#events.append({
        actorId,
        aggregateId: assignmentId,
        aggregateType: "managed_mcp_assignment",
        idempotencyKey,
        payload: {
          assignmentVersion: 1,
          basedOnRoomSeq: input.basedOnRoomSeq,
          enabled: true,
          managedMcpAssignmentRevisionId: revisionId,
          mcpServerId: input.mcpServerId,
          participantId: input.participantId,
          requestDigest,
        },
        roomId: controlRoomId,
        type: "mcp_assignment.created",
      });
      return {
        assignment: this.#assignmentRecordFromEvent(event),
        deduplicated: false,
        event,
      };
    });
  }

  reviseAssignment(
    actor: AuthenticatedActorContext,
    input: {
      allowedToolNames: string[];
      basedOnRoomSeq: number;
      expectedAssignmentVersion: number;
      idempotencyKey: string;
      mcpServerId: string;
      participantId: string;
    },
  ): ManagedMcpAssignmentMutationResult {
    return this.#transaction(() => {
      const assignment = this.#requireAssignment(input);
      const server = this.#requireServer(input.mcpServerId);
      const actorId = this.#requireActor(actor);
      const controlRoomId = text(server, "control_room_id");
      requireHumanControlRoomManager(this.#database, controlRoomId, actorId);
      const idempotencyKey = requiredIdentifier(
        input.idempotencyKey,
        "idempotencyKey",
      );
      const normalizedToolNames = normalizeToolNames(input.allowedToolNames);
      const requestDigest = canonicalDigest({
        allowedToolNames: normalizedToolNames,
        basedOnRoomSeq: input.basedOnRoomSeq,
        domain: "rah/managed-mcp-assignment-revise/v1",
        expectedAssignmentVersion: input.expectedAssignmentVersion,
        mcpServerId: input.mcpServerId,
        participantId: input.participantId,
      });
      const previous = this.#findEvent(controlRoomId, idempotencyKey);
      if (previous !== undefined) {
        return this.#assignmentMutationReplay(
          previous,
          actorId,
          input,
          "mcp_assignment.revised",
          requestDigest,
        );
      }
      this.#assertFreshContext(controlRoomId, input.basedOnRoomSeq);
      const currentVersion = integer(assignment, "current_assignment_version");
      if (currentVersion !== input.expectedAssignmentVersion) {
        throw new ConflictError("managed MCP assignment version is stale");
      }
      const assignmentVersion = currentVersion + 1;
      const revisionId = this.#createId("managed_mcp_assignment_revision");
      const createdAt = this.#now().toISOString();
      this.#insertAssignmentRevision({
        actorId,
        allowedToolNames: this.#validateAllowedTools(
          server,
          normalizedToolNames,
        ),
        assignmentId: text(assignment, "managed_mcp_assignment_id"),
        assignmentVersion,
        createdAt,
        revisionId,
      });
      this.#database
        .prepare(
          `UPDATE managed_mcp_assignments
           SET current_assignment_version = ?, current_revision_id = ?,
               enabled = 1, updated_at = ?
           WHERE managed_mcp_assignment_id = ?`,
        )
        .run(
          assignmentVersion,
          revisionId,
          createdAt,
          text(assignment, "managed_mcp_assignment_id"),
        );
      const assignmentId = text(assignment, "managed_mcp_assignment_id");
      const event = this.#events.append({
        actorId,
        aggregateId: assignmentId,
        aggregateType: "managed_mcp_assignment",
        idempotencyKey,
        payload: {
          assignmentVersion,
          basedOnRoomSeq: input.basedOnRoomSeq,
          enabled: true,
          managedMcpAssignmentRevisionId: revisionId,
          mcpServerId: input.mcpServerId,
          participantId: input.participantId,
          requestDigest,
        },
        roomId: controlRoomId,
        type: "mcp_assignment.revised",
      });
      return {
        assignment: this.#assignmentRecordFromEvent(event),
        deduplicated: false,
        event,
      };
    });
  }

  setServerState(
    actor: AuthenticatedActorContext,
    input: {
      basedOnRoomSeq: number;
      expectedConfigVersion: number;
      idempotencyKey: string;
      mcpServerId: string;
      state: "disabled" | "enabled";
    },
  ): ManagedMcpServerMutationResult {
    return this.#transaction(() => {
      const server = this.#requireServer(input.mcpServerId);
      const actorId = this.#requireActor(actor);
      const controlRoomId = text(server, "control_room_id");
      requireHumanControlRoomManager(this.#database, controlRoomId, actorId);
      const idempotencyKey = requiredIdentifier(
        input.idempotencyKey,
        "idempotencyKey",
      );
      const requestDigest = canonicalDigest({
        basedOnRoomSeq: input.basedOnRoomSeq,
        domain: "rah/managed-mcp-server-state/v1",
        expectedConfigVersion: input.expectedConfigVersion,
        mcpServerId: input.mcpServerId,
        state: input.state,
      });
      const eventType = `mcp_server.${input.state}` as const;
      const previous = this.#findEvent(controlRoomId, idempotencyKey);
      if (previous !== undefined) {
        return this.#serverMutationReplay(
          previous,
          actorId,
          input.mcpServerId,
          eventType,
          requestDigest,
        );
      }
      this.#assertFreshContext(controlRoomId, input.basedOnRoomSeq);
      const currentVersion = integer(server, "current_config_version");
      if (currentVersion !== input.expectedConfigVersion) {
        throw new ConflictError(
          `managed MCP Server ${input.mcpServerId} config version is stale`,
        );
      }
      if (text(server, "state") === input.state) {
        throw new ConflictError(`managed MCP Server is already ${input.state}`);
      }
      const configVersion = currentVersion + 1;
      const revisionId = this.#createId("managed_mcp_server_revision");
      const createdAt = this.#now().toISOString();
      this.#insertServerRevision({
        actorId,
        configVersion,
        createdAt,
        definition: this.#currentServerDefinition(server),
        mcpServerId: input.mcpServerId,
        revisionId,
      });
      this.#database
        .prepare(
          `UPDATE managed_mcp_servers
           SET current_config_version = ?, current_revision_id = ?,
               state = ?, updated_at = ?
           WHERE mcp_server_id = ?`,
        )
        .run(
          configVersion,
          revisionId,
          input.state,
          createdAt,
          input.mcpServerId,
        );
      const event = this.#events.append({
        actorId,
        aggregateId: input.mcpServerId,
        aggregateType: "managed_mcp_server",
        idempotencyKey,
        payload: {
          basedOnRoomSeq: input.basedOnRoomSeq,
          configVersion,
          managedMcpServerRevisionId: revisionId,
          requestDigest,
          state: input.state,
        },
        roomId: controlRoomId,
        type: eventType,
      });
      return {
        deduplicated: false,
        event,
        server: this.#serverRecordFromEvent(event),
      };
    });
  }

  setAssignmentState(
    actor: AuthenticatedActorContext,
    input: {
      basedOnRoomSeq: number;
      expectedAssignmentVersion: number;
      idempotencyKey: string;
      mcpServerId: string;
      participantId: string;
      state: "disabled" | "enabled";
    },
  ): ManagedMcpAssignmentMutationResult {
    return this.#transaction(() => {
      const assignment = this.#requireAssignment(input);
      const server = this.#requireServer(input.mcpServerId);
      const actorId = this.#requireActor(actor);
      const controlRoomId = text(server, "control_room_id");
      requireHumanControlRoomManager(this.#database, controlRoomId, actorId);
      const idempotencyKey = requiredIdentifier(
        input.idempotencyKey,
        "idempotencyKey",
      );
      const requestDigest = canonicalDigest({
        basedOnRoomSeq: input.basedOnRoomSeq,
        domain: "rah/managed-mcp-assignment-state/v1",
        expectedAssignmentVersion: input.expectedAssignmentVersion,
        mcpServerId: input.mcpServerId,
        participantId: input.participantId,
        state: input.state,
      });
      const eventType = `mcp_assignment.${input.state}` as const;
      const previous = this.#findEvent(controlRoomId, idempotencyKey);
      if (previous !== undefined) {
        return this.#assignmentMutationReplay(
          previous,
          actorId,
          input,
          eventType,
          requestDigest,
        );
      }
      this.#assertFreshContext(controlRoomId, input.basedOnRoomSeq);
      const currentVersion = integer(assignment, "current_assignment_version");
      if (currentVersion !== input.expectedAssignmentVersion) {
        throw new ConflictError("managed MCP assignment version is stale");
      }
      const enabled = integer(assignment, "enabled") === 1;
      if (enabled === (input.state === "enabled")) {
        throw new ConflictError(
          `managed MCP assignment is already ${input.state}`,
        );
      }
      const assignmentVersion = currentVersion + 1;
      const revisionId = this.#createId("managed_mcp_assignment_revision");
      const createdAt = this.#now().toISOString();
      this.#insertAssignmentRevision({
        actorId,
        allowedToolNames: stringArray(
          this.#requireAssignmentRevision(
            text(assignment, "current_revision_id"),
          ),
          "allowed_tool_names_json",
        ),
        assignmentId: text(assignment, "managed_mcp_assignment_id"),
        assignmentVersion,
        createdAt,
        revisionId,
      });
      this.#database
        .prepare(
          `UPDATE managed_mcp_assignments
           SET current_assignment_version = ?, current_revision_id = ?,
               enabled = ?, updated_at = ?
           WHERE managed_mcp_assignment_id = ?`,
        )
        .run(
          assignmentVersion,
          revisionId,
          input.state === "enabled" ? 1 : 0,
          createdAt,
          text(assignment, "managed_mcp_assignment_id"),
        );
      const event = this.#events.append({
        actorId,
        aggregateId: text(assignment, "managed_mcp_assignment_id"),
        aggregateType: "managed_mcp_assignment",
        idempotencyKey,
        payload: {
          assignmentVersion,
          basedOnRoomSeq: input.basedOnRoomSeq,
          enabled: input.state === "enabled",
          managedMcpAssignmentRevisionId: revisionId,
          mcpServerId: input.mcpServerId,
          participantId: input.participantId,
          requestDigest,
        },
        roomId: controlRoomId,
        type: eventType,
      });
      return {
        assignment: this.#assignmentRecordFromEvent(event),
        deduplicated: false,
        event,
      };
    });
  }

  listServers(
    actor: AuthenticatedActorContext,
    input: { controlRoomId: string },
  ): ManagedMcpServerRecord[] {
    const actorId = this.#requireActor(actor);
    requireHumanControlRoomManager(
      this.#database,
      input.controlRoomId,
      actorId,
    );
    return this.#database
      .prepare(
        `SELECT * FROM managed_mcp_servers
         WHERE control_room_id = ? ORDER BY mcp_server_id`,
      )
      .all(input.controlRoomId)
      .map((row) => this.#serverRecord(row));
  }

  listAssignments(
    actor: AuthenticatedActorContext,
    input: { controlRoomId: string; participantId?: string },
  ): ManagedMcpAssignmentRecord[] {
    const actorId = this.#requireActor(actor);
    requireHumanControlRoomManager(
      this.#database,
      input.controlRoomId,
      actorId,
    );
    const participantClause =
      input.participantId === undefined
        ? ""
        : "AND assignment.participant_id = ?";
    const parameters =
      input.participantId === undefined
        ? [input.controlRoomId]
        : [input.controlRoomId, input.participantId];
    return this.#database
      .prepare(
        `SELECT assignment.* FROM managed_mcp_assignments AS assignment
         JOIN managed_mcp_servers AS server
           ON server.mcp_server_id = assignment.mcp_server_id
         WHERE server.control_room_id = ? ${participantClause}
         ORDER BY assignment.participant_id, assignment.mcp_server_id`,
      )
      .all(...parameters)
      .map((row) => this.#assignmentRecord(row));
  }

  listUsage(
    actor: AuthenticatedActorContext,
    input: {
      beforeCallId?: string;
      controlRoomId: string;
      limit?: number;
      participantId: string;
    },
  ): ManagedMcpUsagePage {
    const actorId = this.#requireActor(actor);
    requireHumanControlRoomManager(
      this.#database,
      input.controlRoomId,
      actorId,
    );
    this.#requireWorkspaceAgent(input.controlRoomId, input.participantId);
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("managed MCP usage limit must be between 1 and 100");
    }
    let cursorClause = "";
    const parameters: Array<number | string> = [
      input.controlRoomId,
      input.participantId,
    ];
    if (input.beforeCallId !== undefined) {
      const cursor = this.#database
        .prepare(
          `SELECT call.created_at, call.managed_mcp_call_id
           FROM managed_mcp_calls AS call
           JOIN managed_mcp_servers AS server
             ON server.mcp_server_id = call.mcp_server_id
           WHERE server.control_room_id = ? AND call.participant_id = ?
             AND call.managed_mcp_call_id = ?`,
        )
        .get(input.controlRoomId, input.participantId, input.beforeCallId);
      if (cursor === undefined) {
        throw new NotFoundError("managed MCP usage cursor was not found");
      }
      cursorClause = `AND (
        call.created_at < ? OR
        (call.created_at = ? AND call.managed_mcp_call_id < ?)
      )`;
      parameters.push(
        text(cursor, "created_at"),
        text(cursor, "created_at"),
        text(cursor, "managed_mcp_call_id"),
      );
    }
    parameters.push(limit + 1);
    const rows = this.#database
      .prepare(
        `SELECT call.*, revision.definition_json
         FROM managed_mcp_calls AS call
         JOIN managed_mcp_servers AS server
           ON server.mcp_server_id = call.mcp_server_id
         JOIN managed_mcp_server_revisions AS revision
           ON revision.mcp_server_id = call.mcp_server_id
          AND revision.config_version = call.config_version
         WHERE server.control_room_id = ? AND call.participant_id = ?
           ${cursorClause}
         ORDER BY call.created_at DESC, call.managed_mcp_call_id DESC
         LIMIT ?`,
      )
      .all(...parameters);
    const hasMore = rows.length > limit;
    const visibleRows = rows.slice(0, limit);
    const calls = visibleRows.map((row) => this.#usageRecord(row));
    return {
      calls,
      ...(hasMore && calls.length > 0
        ? { nextCursor: calls.at(-1)!.managedMcpCallId }
        : {}),
    };
  }

  listCatalog(
    execution: AuthenticatedWorkerExecutionContext,
  ): ManagedMcpCatalog {
    const scope = this.#requireWorker(execution);
    const rows = this.#database
      .prepare(
        `SELECT assignment.current_assignment_version,
                assignment_revision.allowed_tool_names_json,
                server.mcp_server_id, server.current_config_version,
                server_revision.definition_json
         FROM managed_mcp_assignments AS assignment
         JOIN managed_mcp_assignment_revisions AS assignment_revision
           ON assignment_revision.managed_mcp_assignment_revision_id =
              assignment.current_revision_id
         JOIN managed_mcp_servers AS server
           ON server.mcp_server_id = assignment.mcp_server_id
         JOIN managed_mcp_server_revisions AS server_revision
           ON server_revision.managed_mcp_server_revision_id =
              server.current_revision_id
         WHERE assignment.participant_id = ? AND assignment.enabled = 1
           AND server.state = 'enabled'
         ORDER BY server.mcp_server_id`,
      )
      .all(scope.participantId);
    return ManagedMcpCatalogSchema.parse({
      catalogVersion: 1,
      tools: rows.flatMap((row) => {
        const definition = definitionFromRow(row);
        const allowed = new Set(stringArray(row, "allowed_tool_names_json"));
        return definition.tools
          .filter(({ toolName }) => allowed.has(toolName))
          .map((tool) => ({
            ...tool,
            assignmentVersion: integer(row, "current_assignment_version"),
            configVersion: integer(row, "current_config_version"),
            mcpServerId: text(row, "mcp_server_id"),
            serverName: definition.serverName,
          }));
      }),
    });
  }

  authorizeCall(
    execution: AuthenticatedWorkerExecutionContext,
    uncheckedRequest: ManagedMcpCallRequest,
  ): ManagedMcpAuthorizedCall {
    const request = ManagedMcpCallRequestSchema.parse(uncheckedRequest);
    return this.#transaction(() => {
      const scope = this.#requireWorker(execution);
      const server = this.#requireServer(request.mcpServerId);
      const assignment = this.#requireAssignment({
        mcpServerId: request.mcpServerId,
        participantId: scope.participantId,
      });
      if (
        text(server, "state") !== "enabled" ||
        integer(assignment, "enabled") !== 1
      ) {
        throw new ForbiddenError("managed MCP tool is not assigned");
      }
      const configVersion = integer(server, "current_config_version");
      const assignmentVersion = integer(
        assignment,
        "current_assignment_version",
      );
      if (
        configVersion !== request.expectedConfigVersion ||
        assignmentVersion !== request.expectedAssignmentVersion
      ) {
        throw new ConflictError(
          "managed MCP catalog changed; reload tools before calling",
        );
      }
      const definition = this.#currentServerDefinition(server);
      const tool = definition.tools.find(
        ({ toolName }) => toolName === request.toolName,
      );
      const allowed = new Set(
        stringArray(
          this.#requireAssignmentRevision(
            text(assignment, "current_revision_id"),
          ),
          "allowed_tool_names_json",
        ),
      );
      if (tool === undefined || !allowed.has(request.toolName)) {
        throw new ForbiddenError("managed MCP tool is not assigned");
      }
      const managedMcpCallId = this.#createId("managed_mcp_call");
      const createdAt = this.#now().toISOString();
      this.#database
        .prepare(
          `INSERT INTO managed_mcp_calls(
             managed_mcp_call_id, run_attempt_id, participant_id, room_id,
             mcp_server_id, tool_name, config_version, assignment_version,
             arguments_digest, state, created_at, updated_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(
          managedMcpCallId,
          scope.runAttemptId,
          scope.participantId,
          scope.roomId,
          request.mcpServerId,
          request.toolName,
          configVersion,
          assignmentVersion,
          canonicalDigest(request.arguments),
          createdAt,
          createdAt,
        );
      return {
        call: {
          arguments: request.arguments,
          assignmentVersion,
          configVersion,
          managedMcpCallId,
          mcpServerId: request.mcpServerId,
          participantId: scope.participantId,
          roomId: scope.roomId,
          runAttemptId: scope.runAttemptId,
          toolName: request.toolName,
        },
        executorRef: definition.executorRef,
        tool,
      };
    });
  }

  completeCall(
    execution: AuthenticatedWorkerExecutionContext,
    input: { managedMcpCallId: string; result: ManagedMcpCallResult },
  ): ManagedMcpCallResult {
    const result = ManagedMcpCallResultSchema.parse(input.result);
    return this.#transaction(() => {
      const scope = this.#requireWorker(execution);
      const call = this.#requirePendingCall(input.managedMcpCallId, scope);
      const completedAt = this.#now().toISOString();
      this.#database
        .prepare(
          `UPDATE managed_mcp_calls
           SET state = 'completed', is_error = ?, result_digest = ?,
               updated_at = ?, completed_at = ?
           WHERE managed_mcp_call_id = ? AND state = 'pending'`,
        )
        .run(
          result.isError ? 1 : 0,
          canonicalDigest(result),
          completedAt,
          completedAt,
          text(call, "managed_mcp_call_id"),
        );
      return result;
    });
  }

  failCall(
    execution: AuthenticatedWorkerExecutionContext,
    input: {
      failureCode:
        | "executor_failed"
        | "executor_unavailable"
        | "invalid_result"
        | "timeout";
      managedMcpCallId: string;
    },
  ): void {
    this.#transaction(() => {
      const scope = this.#requireWorker(execution);
      const call = this.#requirePendingCall(input.managedMcpCallId, scope);
      const completedAt = this.#now().toISOString();
      this.#database
        .prepare(
          `UPDATE managed_mcp_calls
           SET state = 'failed', failure_code = ?, updated_at = ?,
               completed_at = ?
           WHERE managed_mcp_call_id = ? AND state = 'pending'`,
        )
        .run(
          input.failureCode,
          completedAt,
          completedAt,
          text(call, "managed_mcp_call_id"),
        );
    });
  }

  #serverMutationReplay(
    row: Row,
    actorId: string,
    mcpServerId: string,
    eventType:
      | "mcp_server.created"
      | "mcp_server.disabled"
      | "mcp_server.enabled"
      | "mcp_server.revised",
    requestDigest: string,
  ): ManagedMcpServerMutationResult {
    const event = this.#events.eventFromRow(row);
    if (
      event.actorId !== actorId ||
      event.aggregateId !== mcpServerId ||
      event.type !== eventType ||
      event.payload.requestDigest !== requestDigest
    ) {
      throw new IdempotencyConflictError(
        `idempotency key ${event.idempotencyKey} was already used for another mutation`,
      );
    }
    return {
      deduplicated: true,
      event,
      server: this.#serverRecordFromEvent(event),
    };
  }

  #assignmentMutationReplay(
    row: Row,
    actorId: string,
    input: { mcpServerId: string; participantId: string },
    eventType:
      | "mcp_assignment.created"
      | "mcp_assignment.disabled"
      | "mcp_assignment.enabled"
      | "mcp_assignment.revised",
    requestDigest: string,
  ): ManagedMcpAssignmentMutationResult {
    const event = this.#events.eventFromRow(row);
    if (
      event.actorId !== actorId ||
      event.type !== eventType ||
      event.payload.mcpServerId !== input.mcpServerId ||
      event.payload.participantId !== input.participantId ||
      event.payload.requestDigest !== requestDigest
    ) {
      throw new IdempotencyConflictError(
        `idempotency key ${event.idempotencyKey} was already used for another mutation`,
      );
    }
    return {
      assignment: this.#assignmentRecordFromEvent(event),
      deduplicated: true,
      event,
    };
  }

  #serverRecordFromEvent(event: RoomEvent): ManagedMcpServerRecord {
    const revisionId = eventPayloadText(event, "managedMcpServerRevisionId");
    return {
      configVersion: eventPayloadInteger(event, "configVersion"),
      controlRoomId: event.roomId,
      currentRevisionId: revisionId,
      definition: definitionFromRow(this.#requireServerRevision(revisionId)),
      mcpServerId: event.aggregateId,
      state: eventPayloadState(event),
    };
  }

  #assignmentRecordFromEvent(event: RoomEvent): ManagedMcpAssignmentRecord {
    const revisionId = eventPayloadText(
      event,
      "managedMcpAssignmentRevisionId",
    );
    return {
      allowedToolNames: stringArray(
        this.#requireAssignmentRevision(revisionId),
        "allowed_tool_names_json",
      ),
      assignmentId: event.aggregateId,
      assignmentVersion: eventPayloadInteger(event, "assignmentVersion"),
      currentRevisionId: revisionId,
      enabled: event.payload.enabled === true,
      mcpServerId: eventPayloadText(event, "mcpServerId"),
      participantId: eventPayloadText(event, "participantId"),
    };
  }

  #findEvent(roomId: string, idempotencyKey: string): Row | undefined {
    return this.#database
      .prepare(
        "SELECT * FROM room_events WHERE room_id = ? AND idempotency_key = ?",
      )
      .get(roomId, idempotencyKey);
  }

  #assertFreshContext(roomId: string, basedOnRoomSeq: number): void {
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

  #validateAllowedTools(server: Row, unchecked: string[]): string[] {
    const allowedToolNames = normalizeToolNames(unchecked);
    if (allowedToolNames.length === 0) {
      throw new Error("allowedToolNames must contain at least one tool");
    }
    const available = new Set(
      this.#currentServerDefinition(server).tools.map(
        ({ toolName }) => toolName,
      ),
    );
    const unknown = allowedToolNames.find(
      (toolName) => !available.has(toolName),
    );
    if (unknown !== undefined) {
      throw new NotFoundError(`managed MCP tool ${unknown} was not found`);
    }
    return allowedToolNames;
  }

  #requireManagedAgent(controlRoomId: string, participantId: string): void {
    const row = this.#database
      .prepare(
        `SELECT 1 AS present FROM agent_definitions
         WHERE participant_id = ? AND control_room_id = ? AND state = 'enabled'`,
      )
      .get(participantId, controlRoomId);
    if (row === undefined) {
      throw new ForbiddenError(
        `participant ${participantId} is not an enabled managed Agent in this Workspace`,
      );
    }
  }

  #requireWorkspaceAgent(controlRoomId: string, participantId: string): void {
    const row = this.#database
      .prepare(
        `SELECT 1 AS present FROM agent_definitions
         WHERE participant_id = ? AND control_room_id = ?`,
      )
      .get(participantId, controlRoomId);
    if (row === undefined) {
      throw new NotFoundError(
        `participant ${participantId} is not a managed Agent in this Workspace`,
      );
    }
  }

  #insertServerRevision(input: {
    actorId: string;
    configVersion: number;
    createdAt: string;
    definition: ManagedMcpServerDefinition;
    mcpServerId: string;
    revisionId: string;
  }): void {
    this.#database
      .prepare(
        `INSERT INTO managed_mcp_server_revisions(
           managed_mcp_server_revision_id, mcp_server_id, config_version,
           content_digest, definition_json, created_by, created_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.revisionId,
        input.mcpServerId,
        input.configVersion,
        canonicalDigest(input.definition),
        JSON.stringify(input.definition),
        input.actorId,
        input.createdAt,
      );
  }

  #insertAssignmentRevision(input: {
    actorId: string;
    allowedToolNames: string[];
    assignmentId: string;
    assignmentVersion: number;
    createdAt: string;
    revisionId: string;
  }): void {
    this.#database
      .prepare(
        `INSERT INTO managed_mcp_assignment_revisions(
           managed_mcp_assignment_revision_id, managed_mcp_assignment_id,
           assignment_version, allowed_tool_names_json, created_by, created_at
         ) VALUES(?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.revisionId,
        input.assignmentId,
        input.assignmentVersion,
        JSON.stringify(input.allowedToolNames),
        input.actorId,
        input.createdAt,
      );
  }

  #serverRecord(row: Row): ManagedMcpServerRecord {
    return {
      configVersion: integer(row, "current_config_version"),
      controlRoomId: text(row, "control_room_id"),
      currentRevisionId: text(row, "current_revision_id"),
      definition: this.#currentServerDefinition(row),
      mcpServerId: text(row, "mcp_server_id"),
      state: text(row, "state") as "disabled" | "enabled",
    };
  }

  #assignmentRecord(row: Row): ManagedMcpAssignmentRecord {
    return {
      allowedToolNames: stringArray(
        this.#requireAssignmentRevision(text(row, "current_revision_id")),
        "allowed_tool_names_json",
      ),
      assignmentId: text(row, "managed_mcp_assignment_id"),
      assignmentVersion: integer(row, "current_assignment_version"),
      currentRevisionId: text(row, "current_revision_id"),
      enabled: integer(row, "enabled") === 1,
      mcpServerId: text(row, "mcp_server_id"),
      participantId: text(row, "participant_id"),
    };
  }

  #usageRecord(row: Row): ManagedMcpUsageRecord {
    const state = text(row, "state") as "completed" | "failed" | "pending";
    const completedAt = nullableText(row, "completed_at");
    const failureCode = nullableText(row, "failure_code");
    const isError = nullableInteger(row, "is_error");
    return ManagedMcpUsageRecordSchema.parse({
      assignmentVersion: integer(row, "assignment_version"),
      ...(completedAt === null ? {} : { completedAt }),
      configVersion: integer(row, "config_version"),
      createdAt: text(row, "created_at"),
      ...(failureCode === null ? {} : { failureCode }),
      ...(isError === null ? {} : { isError: isError === 1 }),
      managedMcpCallId: text(row, "managed_mcp_call_id"),
      mcpServerId: text(row, "mcp_server_id"),
      participantId: text(row, "participant_id"),
      roomId: text(row, "room_id"),
      runAttemptId: text(row, "run_attempt_id"),
      serverName: definitionFromRow(row).serverName,
      state,
      toolName: text(row, "tool_name"),
    });
  }

  #currentServerDefinition(row: Row): ManagedMcpServerDefinition {
    return definitionFromRow(
      this.#requireServerRevision(text(row, "current_revision_id")),
    );
  }

  #findServer(mcpServerId: string): Row | undefined {
    return this.#database
      .prepare("SELECT * FROM managed_mcp_servers WHERE mcp_server_id = ?")
      .get(mcpServerId);
  }

  #requireServer(mcpServerId: string): Row {
    const row = this.#findServer(mcpServerId);
    if (row === undefined) {
      throw new NotFoundError(
        `managed MCP Server ${mcpServerId} was not found`,
      );
    }
    return row;
  }

  #findAssignment(input: {
    mcpServerId: string;
    participantId: string;
  }): Row | undefined {
    return this.#database
      .prepare(
        `SELECT * FROM managed_mcp_assignments
         WHERE participant_id = ? AND mcp_server_id = ?`,
      )
      .get(input.participantId, input.mcpServerId);
  }

  #requireAssignment(input: {
    mcpServerId: string;
    participantId: string;
  }): Row {
    const row = this.#findAssignment(input);
    if (row === undefined) {
      throw new ForbiddenError("managed MCP tool is not assigned");
    }
    return row;
  }

  #requireServerRevision(revisionId: string): Row {
    const row = this.#database
      .prepare(
        `SELECT * FROM managed_mcp_server_revisions
         WHERE managed_mcp_server_revision_id = ?`,
      )
      .get(revisionId);
    if (row === undefined) throw new Error("managed MCP revision is missing");
    return row;
  }

  #requireAssignmentRevision(revisionId: string): Row {
    const row = this.#database
      .prepare(
        `SELECT * FROM managed_mcp_assignment_revisions
         WHERE managed_mcp_assignment_revision_id = ?`,
      )
      .get(revisionId);
    if (row === undefined) {
      throw new Error("managed MCP assignment revision is missing");
    }
    return row;
  }

  #requirePendingCall(
    managedMcpCallId: string,
    scope: ActivationCredentialScope,
  ): Row {
    const row = this.#database
      .prepare(
        `SELECT * FROM managed_mcp_calls
         WHERE managed_mcp_call_id = ? AND run_attempt_id = ?
           AND participant_id = ? AND room_id = ? AND state = 'pending'`,
      )
      .get(
        managedMcpCallId,
        scope.runAttemptId,
        scope.participantId,
        scope.roomId,
      );
    if (row === undefined) {
      throw new ConflictError("managed MCP call is no longer pending");
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

function definitionFromRow(row: Row): ManagedMcpServerDefinition {
  return ManagedMcpServerDefinitionSchema.parse(
    JSON.parse(text(row, "definition_json")),
  );
}

function stringArray(row: Row, field: string): string[] {
  const value: unknown = JSON.parse(text(row, field));
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`invalid ${field}`);
  }
  return value;
}

function requiredIdentifier(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} is required`);
  return normalized;
}

function normalizeToolNames(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()))]
    .filter((value) => value.length > 0)
    .sort();
}

function eventPayloadInteger(event: RoomEvent, key: string): number {
  const value = event.payload[key];
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`event payload ${key} must be a positive integer`);
  }
  return value as number;
}

function eventPayloadState(event: RoomEvent): "disabled" | "enabled" {
  const state = eventPayloadText(event, "state");
  if (state !== "disabled" && state !== "enabled") {
    throw new Error("event payload state is invalid");
  }
  return state;
}
