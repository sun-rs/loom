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
