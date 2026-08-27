import type { DatabaseSync } from "node:sqlite";

import type { MembershipRole } from "@rah-os/protocol";

import { ForbiddenError, NotFoundError } from "./errors.ts";
import { text } from "./sqlite-row.ts";
import type { Principal } from "./types.ts";

export function requireHumanRoomOwner(principal: Principal): void {
  if (principal.kind !== "human") {
    throw new ForbiddenError("only Human principals can create Rooms");
  }
}

export function requireHumanControlRoomManager(
  database: DatabaseSync,
  controlRoomId: string,
  principalId: string,
): void {
  const room = database
    .prepare("SELECT kind FROM rooms WHERE room_id = ?")
    .get(controlRoomId);
  if (room === undefined) {
    throw new NotFoundError(`room ${controlRoomId} was not found`);
  }
  if (text(room, "kind") !== "control") {
    throw new ForbiddenError(
      `room ${controlRoomId} is not a managed control Room`,
    );
  }
  const principal = database
    .prepare("SELECT kind FROM principals WHERE principal_id = ?")
    .get(principalId);
  if (principal === undefined) {
    throw new NotFoundError(`principal ${principalId} was not found`);
  }
  if (text(principal, "kind") !== "human") {
    throw new ForbiddenError(
      "control object mutations require an authenticated Human member",
    );
  }
  requireRoomManager(database, controlRoomId, principalId);
}

export function requireExecutionPolicyRevisionControlRoom(
  database: DatabaseSync,
  executionPolicyRevisionId: string,
  controlRoomId: string,
): void {
  const row = database
    .prepare(
      "SELECT control_room_id FROM execution_policy_revisions WHERE execution_policy_revision_id = ?",
    )
    .get(executionPolicyRevisionId);
  if (row === undefined) {
    throw new NotFoundError(
      `execution policy revision ${executionPolicyRevisionId} was not found`,
    );
  }
  if (text(row, "control_room_id") !== controlRoomId) {
    throw new ForbiddenError(
      `execution policy revision ${executionPolicyRevisionId} must belong to the same control Room`,
    );
  }
}

export function requireRoomMember(
  database: DatabaseSync,
  roomId: string,
  principalId: string,
): void {
  const room = database
    .prepare("SELECT 1 AS present FROM rooms WHERE room_id = ?")
    .get(roomId);
  if (room === undefined) {
    throw new ForbiddenError(`room ${roomId} is unavailable`);
  }
  const membership = database
    .prepare(
      "SELECT 1 AS present FROM memberships WHERE room_id = ? AND principal_id = ?",
    )
    .get(roomId, principalId);
  if (membership === undefined) {
    throw new ForbiddenError(
      `principal ${principalId} is not a member of room ${roomId}`,
    );
  }
}

export function requireRoomManager(
  database: DatabaseSync,
  roomId: string,
  principalId: string,
): "admin" | "owner" {
  const role = roomRole(database, roomId, principalId);
  if (role !== "owner" && role !== "admin") {
    throw new ForbiddenError(
      `principal ${principalId} must be a Room owner or admin`,
    );
  }
  return role;
}

export function requireRoomOwner(
  database: DatabaseSync,
  roomId: string,
  principalId: string,
): void {
  if (roomRole(database, roomId, principalId) !== "owner") {
    throw new ForbiddenError(`principal ${principalId} must be a Room owner`);
  }
}

export function roomRole(
  database: DatabaseSync,
  roomId: string,
  principalId: string,
): MembershipRole {
  const membership = database
    .prepare(
      "SELECT role FROM memberships WHERE room_id = ? AND principal_id = ?",
    )
    .get(roomId, principalId);
  if (membership === undefined) {
    const room = database
      .prepare("SELECT 1 AS present FROM rooms WHERE room_id = ?")
      .get(roomId);
    if (room === undefined)
      throw new NotFoundError(`room ${roomId} was not found`);
    throw new ForbiddenError(
      `principal ${principalId} is not a member of room ${roomId}`,
    );
  }
  return text(membership, "role") as MembershipRole;
}
