import {
  MessageSchema,
  RoomMembershipSchema,
  ThreadSchema,
  WorkspaceSchema,
  type Message,
  type Room,
  type RoomMembership,
  type Thread,
  type Workspace,
} from "@rah-os/protocol";

import { LEGACY_WORKSPACE_ID } from "./schema.ts";
import { integer, nullableText, text, type Row } from "./sqlite-row.ts";

export function newLegacyRoom(
  roomId: string,
  input: { name: string; slug: string },
  createdAt: string,
): Room {
  const room: Room = {
    createdAt,
    kind: "channel",
    name: input.name.trim(),
    roomId,
    slug: input.slug.trim(),
    workspaceId: LEGACY_WORKSPACE_ID,
  };
  if (room.slug.length === 0 || room.name.length === 0) {
    throw new Error("room slug and name are required");
  }
  return room;
}

export function roomProjectionFromRow(row: Row): Room {
  const archivedAt = nullableText(row, "archived_at");
  const description = nullableText(row, "description");
  const visibility = nullableText(row, "visibility");
  const left = nullableText(row, "left_principal_id");
  const right = nullableText(row, "right_principal_id");
  return {
    ...(archivedAt === null ? {} : { archivedAt }),
    createdAt: text(row, "created_at"),
    ...(description === null ? {} : { description }),
    ...(left === null || right === null
      ? {}
      : { directParticipantIds: [left, right] as [string, string] }),
    kind: text(row, "kind") as Room["kind"],
    name: text(row, "name"),
    roomId: text(row, "room_id"),
    slug: text(row, "slug"),
    ...(visibility === null
      ? {}
      : { visibility: visibility as Room["visibility"] }),
    workspaceId: text(row, "workspace_id"),
  };
}

export function messageProjectionFromRow(row: Row): Message {
  const threadId = nullableText(row, "thread_id");
  const forwardedBundleJson = nullableText(row, "forwarded_bundle_json");
  return MessageSchema.parse({
    ...(typeof row.attachment_comment_json === "string"
      ? { attachmentComment: JSON.parse(row.attachment_comment_json) }
      : {}),
    ...(typeof row.attachments_json === "string" &&
    row.attachments_json !== "[]"
      ? { attachments: JSON.parse(row.attachments_json) }
      : {}),
    actorId: text(row, "actor_id"),
    body: text(row, "body"),
    createdAt: text(row, "created_at"),
    ...(forwardedBundleJson === null
      ? {}
      : { forwardedBundle: JSON.parse(forwardedBundleJson) }),
    messageId: text(row, "message_id"),
    roomId: text(row, "room_id"),
    roomSeq: integer(row, "room_seq"),
    ...(threadId === null ? {} : { threadId }),
  });
}

export function roomMembershipProjectionFromRow(row: Row): RoomMembership {
  return RoomMembershipSchema.parse({
    joinedAt: text(row, "joined_at"),
    principalId: text(row, "principal_id"),
    role: text(row, "role"),
    roomId: text(row, "room_id"),
  });
}

export function threadProjectionFromRow(row: Row): Thread {
  const lastReplyAt = nullableText(row, "last_reply_at");
  return ThreadSchema.parse({
    createdAt: text(row, "created_at"),
    createdBy: text(row, "created_by"),
    ...(lastReplyAt === null ? {} : { lastReplyAt }),
    replyCount: integer(row, "reply_count"),
    roomId: text(row, "room_id"),
    rootMessageId: text(row, "root_message_id"),
    threadId: text(row, "thread_id"),
  });
}

export function workspaceProjectionFromRow(row: Row): Workspace {
  const archivedAt = nullableText(row, "workspace_archived_at");
  const controlRoomId = nullableText(row, "workspace_control_room_id");
  return WorkspaceSchema.parse({
    ...(archivedAt === null ? {} : { archivedAt }),
    ...(controlRoomId === null ? {} : { controlRoomId }),
    ...(typeof row.workspace_avatar_key === "string"
      ? { avatarKey: row.workspace_avatar_key }
      : {}),
    createdAt: text(row, "workspace_created_at"),
    name: text(row, "workspace_name"),
    slug: text(row, "workspace_slug"),
    state: text(row, "workspace_state"),
    workspaceId: text(row, "workspace_id"),
  });
}
