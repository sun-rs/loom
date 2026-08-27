import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";

export const ParticipantKindSchema = z.enum(["human", "agent", "service"]);
export type ParticipantKind = z.infer<typeof ParticipantKindSchema>;

export const PrincipalSchema = z
  .object({
    principalId: IdentifierSchema,
    handle: IdentifierSchema,
    kind: ParticipantKindSchema,
  })
  .strict();
export type Principal = z.infer<typeof PrincipalSchema>;

export const WorkspaceStateSchema = z.enum(["active", "archived"]);
export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;

export const WorkspaceSchema = z
  .object({
    archivedAt: TimestampSchema.optional(),
    controlRoomId: IdentifierSchema.optional(),
    createdAt: TimestampSchema,
    name: IdentifierSchema,
    slug: IdentifierSchema,
    state: WorkspaceStateSchema,
    workspaceId: IdentifierSchema,
  })
  .strict()
  .refine(
    (workspace) =>
      workspace.state === "archived"
        ? workspace.archivedAt !== undefined
        : workspace.archivedAt === undefined,
    {
      message: "archivedAt must match the Workspace state",
      path: ["archivedAt"],
    },
  );
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const RoomKindSchema = z.enum(["channel", "direct", "control"]);
export type RoomKind = z.infer<typeof RoomKindSchema>;

export const MembershipRoleSchema = z.enum(["owner", "admin", "member"]);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

export const RoomSchema = z
  .object({
    archivedAt: TimestampSchema.optional(),
    createdAt: TimestampSchema,
    kind: RoomKindSchema,
    name: IdentifierSchema,
    roomId: IdentifierSchema,
    slug: IdentifierSchema,
    workspaceId: IdentifierSchema,
  })
  .strict();
export type Room = z.infer<typeof RoomSchema>;

export const RoomMembershipSchema = z
  .object({
    joinedAt: TimestampSchema,
    principalId: IdentifierSchema,
    role: MembershipRoleSchema,
    roomId: IdentifierSchema,
  })
  .strict();
export type RoomMembership = z.infer<typeof RoomMembershipSchema>;

export const MessageSchema = z
  .object({
    actorId: IdentifierSchema,
    body: z.string().min(1),
    createdAt: TimestampSchema,
    messageId: IdentifierSchema,
    roomId: IdentifierSchema,
    roomSeq: z.number().int().positive(),
    threadId: IdentifierSchema.optional(),
  })
  .strict();
export type Message = z.infer<typeof MessageSchema>;

export const ThreadSchema = z
  .object({
    createdAt: TimestampSchema,
    createdBy: IdentifierSchema,
    lastReplyAt: TimestampSchema.optional(),
    replyCount: z.number().int().nonnegative(),
    roomId: IdentifierSchema,
    rootMessageId: IdentifierSchema,
    threadId: IdentifierSchema,
  })
  .strict();
export type Thread = z.infer<typeof ThreadSchema>;
