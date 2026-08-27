import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";
import {
  MembershipRoleSchema,
  MessageSchema,
  PrincipalSchema,
  RoomKindSchema,
  RoomMembershipSchema,
  RoomSchema,
  ThreadSchema,
  WorkspaceSchema,
} from "./collaboration.ts";
import { RoomEventSchema } from "./room-event.ts";

export const ClientPrincipalMeRequestSchema = z.object({}).strict();
export type ClientPrincipalMeRequest = z.infer<
  typeof ClientPrincipalMeRequestSchema
>;

export const ClientPrincipalMeResponseSchema = z
  .object({ principal: PrincipalSchema })
  .strict();
export type ClientPrincipalMeResponse = z.infer<
  typeof ClientPrincipalMeResponseSchema
>;

export const ClientWorkspacesListRequestSchema = z.object({}).strict();
export type ClientWorkspacesListRequest = z.infer<
  typeof ClientWorkspacesListRequestSchema
>;

export const ClientWorkspacesListResponseSchema = z
  .object({ workspaces: z.array(WorkspaceSchema) })
  .strict();
export type ClientWorkspacesListResponse = z.infer<
  typeof ClientWorkspacesListResponseSchema
>;

export const ClientWorkspaceCreateRequestSchema = z
  .object({
    idempotencyKey: IdentifierSchema,
    name: IdentifierSchema,
    slug: IdentifierSchema,
  })
  .strict();
export type ClientWorkspaceCreateRequest = z.infer<
  typeof ClientWorkspaceCreateRequestSchema
>;

export const ClientWorkspaceMutationResponseSchema = z
  .object({
    controlRoom: RoomSchema,
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    workspace: WorkspaceSchema,
  })
  .strict();
export type ClientWorkspaceMutationResponse = z.infer<
  typeof ClientWorkspaceMutationResponseSchema
>;

export const ClientRoomsListRequestSchema = z
  .object({ workspaceId: IdentifierSchema.optional() })
  .strict();
export type ClientRoomsListRequest = z.infer<
  typeof ClientRoomsListRequestSchema
>;

export const ClientRoomsListResponseSchema = z
  .object({ rooms: z.array(RoomSchema) })
  .strict();
export type ClientRoomsListResponse = z.infer<
  typeof ClientRoomsListResponseSchema
>;

export const ClientRoomCreateRequestSchema = z
  .object({
    basedOnControlRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    kind: RoomKindSchema.refine((kind) => kind === "channel", {
      message: "initial managed Room creation only supports channel",
    }),
    name: IdentifierSchema,
    slug: IdentifierSchema,
    workspaceId: IdentifierSchema,
  })
  .strict();
export type ClientRoomCreateRequest = z.infer<
  typeof ClientRoomCreateRequestSchema
>;

export const ClientRoomMutationResponseSchema = z
  .object({
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    room: RoomSchema,
  })
  .strict();
export type ClientRoomMutationResponse = z.infer<
  typeof ClientRoomMutationResponseSchema
>;

export const RoomAgentActivityStateSchema = z.enum([
  "idle",
  "waking",
  "working",
  "error",
]);
export type RoomAgentActivityState = z.infer<
  typeof RoomAgentActivityStateSchema
>;

export const RoomAgentActivitySchema = z
  .object({
    activationId: IdentifierSchema.optional(),
    lastError: z.string().min(1).optional(),
    participantId: IdentifierSchema,
    roomId: IdentifierSchema,
    runAttemptId: IdentifierSchema.optional(),
    state: RoomAgentActivityStateSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export type RoomAgentActivity = z.infer<typeof RoomAgentActivitySchema>;

export const ClientRoomAgentActivityListRequestSchema = z
  .object({ roomId: IdentifierSchema })
  .strict();
export type ClientRoomAgentActivityListRequest = z.infer<
  typeof ClientRoomAgentActivityListRequestSchema
>;

export const ClientRoomAgentActivityListResponseSchema = z
  .object({ agents: z.array(RoomAgentActivitySchema) })
  .strict();
export type ClientRoomAgentActivityListResponse = z.infer<
  typeof ClientRoomAgentActivityListResponseSchema
>;

export const ClientRoomMembersListRequestSchema = z
  .object({ roomId: IdentifierSchema })
  .strict();
export type ClientRoomMembersListRequest = z.infer<
  typeof ClientRoomMembersListRequestSchema
>;

export const ClientRoomMembersListResponseSchema = z
  .object({ memberships: z.array(RoomMembershipSchema) })
  .strict();
export type ClientRoomMembersListResponse = z.infer<
  typeof ClientRoomMembersListResponseSchema
>;

const ClientRoomMemberMutationRequestSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    principalId: IdentifierSchema,
    role: MembershipRoleSchema,
    roomId: IdentifierSchema,
  })
  .strict();

export const ClientRoomMemberAddRequestSchema =
  ClientRoomMemberMutationRequestSchema;
export type ClientRoomMemberAddRequest = z.infer<
  typeof ClientRoomMemberAddRequestSchema
>;

export const ClientRoomMemberRoleRequestSchema =
  ClientRoomMemberMutationRequestSchema;
export type ClientRoomMemberRoleRequest = z.infer<
  typeof ClientRoomMemberRoleRequestSchema
>;

export const ClientRoomMemberRemoveRequestSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    principalId: IdentifierSchema,
    roomId: IdentifierSchema,
  })
  .strict();
export type ClientRoomMemberRemoveRequest = z.infer<
  typeof ClientRoomMemberRemoveRequestSchema
>;

export const ClientRoomMemberMutationResponseSchema = z
  .object({
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    membership: RoomMembershipSchema,
  })
  .strict();
export type ClientRoomMemberMutationResponse = z.infer<
  typeof ClientRoomMemberMutationResponseSchema
>;

export const ClientRoomMemberRemoveResponseSchema = z
  .object({
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    removedPrincipalId: IdentifierSchema,
  })
  .strict();
export type ClientRoomMemberRemoveResponse = z.infer<
  typeof ClientRoomMemberRemoveResponseSchema
>;

export const ClientMessagesListRequestSchema = z
  .object({
    afterSeq: z.number().int().nonnegative().default(0),
    limit: z.number().int().positive().max(500).default(100),
    roomId: IdentifierSchema,
    threadId: IdentifierSchema.optional(),
  })
  .strict();
export type ClientMessagesListRequest = z.infer<
  typeof ClientMessagesListRequestSchema
>;

export const ClientMessagesListResponseSchema = z
  .object({
    cursorAfter: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    messages: z.array(MessageSchema),
  })
  .strict();
export type ClientMessagesListResponse = z.infer<
  typeof ClientMessagesListResponseSchema
>;

const ClientAttentionRecipientSchema = z
  .object({
    participantId: IdentifierSchema,
    reason: z.enum(["dm", "mention", "manual"]),
  })
  .strict();

export const ClientMessagePostRequestSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    body: z.string().trim().min(1),
    idempotencyKey: IdentifierSchema,
    recipients: z.array(ClientAttentionRecipientSchema).default([]),
    roomId: IdentifierSchema,
  })
  .strict();
export type ClientMessagePostRequest = z.infer<
  typeof ClientMessagePostRequestSchema
>;

export const ClientMessageMutationResponseSchema = z
  .object({
    activationIds: z.array(IdentifierSchema),
    deduplicated: z.boolean(),
    event: RoomEventSchema,
  })
  .strict();
export type ClientMessageMutationResponse = z.infer<
  typeof ClientMessageMutationResponseSchema
>;

export const ClientThreadsListRequestSchema = z
  .object({ roomId: IdentifierSchema })
  .strict();
export type ClientThreadsListRequest = z.infer<
  typeof ClientThreadsListRequestSchema
>;

export const ClientThreadsListResponseSchema = z
  .object({ threads: z.array(ThreadSchema) })
  .strict();
export type ClientThreadsListResponse = z.infer<
  typeof ClientThreadsListResponseSchema
>;

export const ClientThreadCreateRequestSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    recipientIds: z.array(IdentifierSchema).default([]),
    roomId: IdentifierSchema,
    rootMessageId: IdentifierSchema,
  })
  .strict();
export type ClientThreadCreateRequest = z.infer<
  typeof ClientThreadCreateRequestSchema
>;

export const ClientThreadReplyRequestSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    body: z.string().trim().min(1),
    idempotencyKey: IdentifierSchema,
    recipientIds: z.array(IdentifierSchema).default([]),
    roomId: IdentifierSchema,
    threadId: IdentifierSchema,
  })
  .strict();
export type ClientThreadReplyRequest = z.infer<
  typeof ClientThreadReplyRequestSchema
>;

export const ClientThreadCreateResponseSchema = z
  .object({
    activationIds: z.array(IdentifierSchema),
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    thread: ThreadSchema,
  })
  .strict();
export type ClientThreadCreateResponse = z.infer<
  typeof ClientThreadCreateResponseSchema
>;
