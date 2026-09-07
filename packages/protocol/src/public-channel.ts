import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import {
  RoomSchema,
  RoomMembershipSchema,
  MessageSchema,
  PrincipalSchema,
  ThreadSchema,
} from "./collaboration.ts";
import { TaskSchema } from "./task.ts";
import { ClientRoomMemberMutationResponseSchema } from "./client-collaboration.ts";

export const PublicChannelDirectoryRequestSchema = z
  .object({
    workspaceId: IdentifierSchema,
    afterRoomId: IdentifierSchema.optional(),
    query: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type PublicChannelDirectoryRequest = z.input<
  typeof PublicChannelDirectoryRequestSchema
>;
export const PublicChannelDirectoryResponseSchema = z
  .object({
    channels: z
      .array(
        z
          .object({
            room: RoomSchema.refine(
              (room) =>
                room.kind === "channel" &&
                room.visibility === "public" &&
                room.archivedAt === undefined,
            ),
            roomSeq: z.number().int().nonnegative(),
            membership: RoomMembershipSchema.optional(),
          })
          .strict(),
      )
      .max(100),
    nextAfterRoomId: IdentifierSchema.optional(),
  })
  .strict();
export type PublicChannelDirectoryResponse = z.infer<
  typeof PublicChannelDirectoryResponseSchema
>;
export const PublicChannelJoinRequestSchema = z
  .object({
    workspaceId: IdentifierSchema,
    roomId: IdentifierSchema,
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export type PublicChannelJoinRequest = z.infer<
  typeof PublicChannelJoinRequestSchema
>;
export const PublicChannelJoinResponseSchema =
  ClientRoomMemberMutationResponseSchema;
export type PublicChannelJoinResponse = z.infer<
  typeof PublicChannelJoinResponseSchema
>;

export const ChannelPreviewRequestSchema = z
  .object({
    workspaceId: IdentifierSchema,
    roomId: IdentifierSchema,
    view: z.enum(["chat", "tasks"]).default("chat"),
    beforeTaskNumber: z.number().int().positive().optional(),
    messageId: IdentifierSchema.optional(),
    rootMessageId: IdentifierSchema.optional(),
    threadId: IdentifierSchema.optional(),
    beforeSeq: z.number().int().positive().optional(),
    ceilingSeq: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(50).default(30),
  })
  .strict();
export type ChannelPreviewRequest = z.input<typeof ChannelPreviewRequestSchema>;
export const ChannelPreviewResponseSchema = z
  .object({
    room: RoomSchema,
    roomSeq: z.number().int().nonnegative(),
    ceilingSeq: z.number().int().nonnegative(),
    membership: RoomMembershipSchema.optional(),
    messages: z.array(MessageSchema).max(51),
    threadId: IdentifierSchema.optional(),
    nextBeforeSeq: z.number().int().positive().optional(),
    authors: z.array(PrincipalSchema).max(51),
    threads: z.array(ThreadSchema).max(51),
    tasks: z.array(TaskSchema).max(50).optional(),
    nextBeforeTaskNumber: z.number().int().positive().optional(),
  })
  .strict();
export type ChannelPreviewResponse = z.infer<
  typeof ChannelPreviewResponseSchema
>;
