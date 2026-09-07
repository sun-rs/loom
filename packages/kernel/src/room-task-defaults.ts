import type { DatabaseSync } from "node:sqlite";

import {
  RoomTaskDefaultsSchema,
  type RoomTaskDefaults,
} from "@rah-os/protocol";

import { ForbiddenError } from "./errors.ts";
import { text, type Row } from "./sqlite-row.ts";

// Owner module for Room-scoped Task participant defaults. These defaults only
// prefill the Human composer in the web client; the Kernel never injects them
// into Task creation (ADR-0020: the web submits explicit Human choices only).

function parseIdList(row: Row, column: string): string[] {
  const raw = text(row, column);
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Room Task defaults column ${column} is not a JSON array`);
  }
  return parsed.map((value) => {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Room Task defaults column ${column} holds a non-id`);
    }
    return value;
  });
}

function agentRoomMemberIds(
  database: DatabaseSync,
  roomId: string,
): Set<string> {
  return new Set(
    database
      .prepare(
        `SELECT memberships.principal_id
         FROM memberships
         JOIN principals ON principals.principal_id = memberships.principal_id
         WHERE memberships.room_id = ? AND principals.kind = 'agent'`,
      )
      .all(roomId)
      .map((row) => text(row, "principal_id")),
  );
}

function requireAgentRoomMember(
  database: DatabaseSync,
  roomId: string,
  participantId: string,
): void {
  const member = database
    .prepare(
      `SELECT principals.kind
       FROM memberships
       JOIN principals ON principals.principal_id = memberships.principal_id
       WHERE memberships.room_id = ? AND memberships.principal_id = ?`,
    )
    .get(roomId, participantId);
  if (member === undefined) {
    throw new ForbiddenError(
      `principal ${participantId} is not a member of Room ${roomId}`,
    );
  }
  if (text(member, "kind") !== "agent") {
    throw new ForbiddenError(
      "Room Task default participants must be Agent principals",
    );
  }
}

function isEmpty(defaults: RoomTaskDefaults): boolean {
  return (
    defaults.defaultAssigneeId === undefined &&
    defaults.defaultCollaboratorIds.length === 0 &&
    defaults.defaultReviewerIds.length === 0
  );
}

/**
 * Reads the stored defaults, filtered down to principals that are still Agent
 * members of the Room. Returns undefined when nothing usable remains.
 */
export function readRoomTaskDefaults(
  database: DatabaseSync,
  roomId: string,
): RoomTaskDefaults | undefined {
  const row = database
    .prepare("SELECT * FROM room_task_defaults WHERE room_id = ?")
    .get(roomId);
  if (row === undefined) return undefined;
  const members = agentRoomMemberIds(database, roomId);
  const storedAssigneeId =
    row.default_assignee_id === null || row.default_assignee_id === undefined
      ? undefined
      : text(row, "default_assignee_id");
  const defaultAssigneeId =
    storedAssigneeId !== undefined && members.has(storedAssigneeId)
      ? storedAssigneeId
      : undefined;
  const keep = (participantId: string): boolean =>
    defaultAssigneeId !== undefined && members.has(participantId);
  const defaults: RoomTaskDefaults = {
    ...(defaultAssigneeId === undefined ? {} : { defaultAssigneeId }),
    defaultCollaboratorIds: parseIdList(
      row,
      "default_collaborator_ids_json",
    ).filter(keep),
    defaultReviewerIds: parseIdList(row, "default_reviewer_ids_json").filter(
      keep,
    ),
  };
  return isEmpty(defaults) ? undefined : defaults;
}

/**
 * Validates and stores Room Task defaults. Returns the normalized defaults, or
 * undefined when the caller cleared them.
 */
export function writeRoomTaskDefaults(
  database: DatabaseSync,
  roomId: string,
  input: RoomTaskDefaults,
  updatedAt: string,
): RoomTaskDefaults | undefined {
  const requested = RoomTaskDefaultsSchema.parse(input);
  const defaults: RoomTaskDefaults = {
    ...(requested.defaultAssigneeId === undefined
      ? {}
      : { defaultAssigneeId: requested.defaultAssigneeId }),
    defaultCollaboratorIds: [...requested.defaultCollaboratorIds].sort(),
    defaultReviewerIds: [...requested.defaultReviewerIds].sort(),
  };
  for (const participantId of new Set([
    ...(defaults.defaultAssigneeId === undefined
      ? []
      : [defaults.defaultAssigneeId]),
    ...defaults.defaultCollaboratorIds,
    ...defaults.defaultReviewerIds,
  ])) {
    requireAgentRoomMember(database, roomId, participantId);
  }
  if (isEmpty(defaults)) {
    database
      .prepare("DELETE FROM room_task_defaults WHERE room_id = ?")
      .run(roomId);
    return undefined;
  }
  database
    .prepare(
      `INSERT INTO room_task_defaults(
         room_id, default_assignee_id, default_collaborator_ids_json,
         default_reviewer_ids_json, updated_at
       ) VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(room_id) DO UPDATE SET
         default_assignee_id = excluded.default_assignee_id,
         default_collaborator_ids_json = excluded.default_collaborator_ids_json,
         default_reviewer_ids_json = excluded.default_reviewer_ids_json,
         updated_at = excluded.updated_at`,
    )
    .run(
      roomId,
      defaults.defaultAssigneeId ?? null,
      JSON.stringify(defaults.defaultCollaboratorIds),
      JSON.stringify(defaults.defaultReviewerIds),
      updatedAt,
    );
  return defaults;
}

/** Drops a principal from a Room's stored defaults after it leaves the Room. */
export function dropRoomTaskDefaultParticipant(
  database: DatabaseSync,
  roomId: string,
  participantId: string,
): void {
  const row = database
    .prepare("SELECT * FROM room_task_defaults WHERE room_id = ?")
    .get(roomId);
  if (row === undefined) return;
  const storedAssigneeId =
    row.default_assignee_id === null || row.default_assignee_id === undefined
      ? undefined
      : text(row, "default_assignee_id");
  if (storedAssigneeId === participantId) {
    database
      .prepare("DELETE FROM room_task_defaults WHERE room_id = ?")
      .run(roomId);
    return;
  }
  const collaboratorIds = parseIdList(
    row,
    "default_collaborator_ids_json",
  ).filter((id) => id !== participantId);
  const reviewerIds = parseIdList(row, "default_reviewer_ids_json").filter(
    (id) => id !== participantId,
  );
  database
    .prepare(
      `UPDATE room_task_defaults
       SET default_collaborator_ids_json = ?, default_reviewer_ids_json = ?
       WHERE room_id = ?`,
    )
    .run(JSON.stringify(collaboratorIds), JSON.stringify(reviewerIds), roomId);
}
