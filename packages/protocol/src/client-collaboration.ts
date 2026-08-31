import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";
import {
  MembershipRoleSchema,
  MessageSchema,
  PrincipalSchema,
  RoomKindSchema,
  RoomMembershipSchema,
  RoomSchema,
  RoomVisibilitySchema,
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

export const ClientWorkspaceUpdateRequestSchema = z
  .object({
    workspaceId: IdentifierSchema,
    name: z.string().trim().min(1).max(120),
    avatarKey: z
      .string()
      .regex(/^[a-z0-9_-]{1,64}$/)
      .nullable(),
    basedOnControlRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export type ClientWorkspaceUpdateRequest = z.infer<
  typeof ClientWorkspaceUpdateRequestSchema
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

export const ClientAgentRoomsListRequestSchema = z
  .object({ agentDefinitionId: IdentifierSchema })
  .strict();
export type ClientAgentRoomsListRequest = z.infer<
  typeof ClientAgentRoomsListRequestSchema
>;

export const ClientAgentRoomsListResponseSchema = z
  .object({ rooms: z.array(RoomSchema) })
  .strict();
export type ClientAgentRoomsListResponse = z.infer<
  typeof ClientAgentRoomsListResponseSchema
>;

export const AgentActivityRelationSchema = z.enum([
  "configuration",
  "performed",
  "received",
  "runtime",
  "tool",
]);
export type AgentActivityRelation = z.infer<typeof AgentActivityRelationSchema>;

export const AgentActivityToneSchema = z.enum([
  "active",
  "error",
  "neutral",
  "success",
  "warning",
]);
export type AgentActivityTone = z.infer<typeof AgentActivityToneSchema>;

const AgentActivityCommonSchema = z.object({
  activityId: IdentifierSchema,
  createdAt: TimestampSchema,
  participantId: IdentifierSchema,
  relation: AgentActivityRelationSchema,
  roomId: IdentifierSchema,
  roomKind: RoomKindSchema,
  roomName: IdentifierSchema,
  roomSlug: IdentifierSchema,
  tone: AgentActivityToneSchema,
});

export const AgentRoomEventActivityRecordSchema =
  AgentActivityCommonSchema.extend({
    aggregateId: IdentifierSchema,
    aggregateType: IdentifierSchema,
    completedAt: z.never().optional(),
    eventType: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
    failureCode: z.never().optional(),
    isError: z.never().optional(),
    managedMcpCallId: z.never().optional(),
    mcpServerId: z.never().optional(),
    roomSeq: z.number().int().positive(),
    runAttemptId: z.never().optional(),
    serverName: z.never().optional(),
    source: z.literal("room_event"),
    state: z.never().optional(),
    toolName: z.never().optional(),
  }).strict();
export type AgentRoomEventActivityRecord = z.infer<
  typeof AgentRoomEventActivityRecordSchema
>;

export const AgentManagedMcpActivityRecordSchema =
  AgentActivityCommonSchema.extend({
    aggregateId: z.never().optional(),
    aggregateType: z.never().optional(),
    completedAt: TimestampSchema.optional(),
    eventType: z.never().optional(),
    failureCode: z
      .enum([
        "executor_failed",
        "executor_unavailable",
        "invalid_result",
        "timeout",
      ])
      .optional(),
    isError: z.boolean().optional(),
    managedMcpCallId: IdentifierSchema,
    mcpServerId: IdentifierSchema,
    roomSeq: z.never().optional(),
    runAttemptId: IdentifierSchema,
    serverName: z.string().trim().min(1).max(512),
    source: z.literal("managed_mcp_call"),
    state: z.enum(["pending", "completed", "failed"]),
    toolName: z.string().trim().min(1).max(512),
  }).strict();
export type AgentManagedMcpActivityRecord = z.infer<
  typeof AgentManagedMcpActivityRecordSchema
>;

export const AgentActivityRecordSchema = z
  .discriminatedUnion("source", [
    AgentRoomEventActivityRecordSchema,
    AgentManagedMcpActivityRecordSchema,
  ])
  .superRefine((record, context) => {
    if (record.source !== "managed_mcp_call") return;
    const valid =
      (record.state === "pending" &&
        record.completedAt === undefined &&
        record.failureCode === undefined &&
        record.isError === undefined) ||
      (record.state === "completed" &&
        record.completedAt !== undefined &&
        record.failureCode === undefined &&
        record.isError !== undefined) ||
      (record.state === "failed" &&
        record.completedAt !== undefined &&
        record.failureCode !== undefined &&
        record.isError === undefined);
    if (!valid) {
      context.addIssue({
        code: "custom",
        message: "managed MCP activity terminal fields do not match state",
      });
    }
  });
export type AgentActivityRecord = z.infer<typeof AgentActivityRecordSchema>;

export const ClientAgentActivityListRequestSchema = z
  .object({
    agentDefinitionId: IdentifierSchema,
    beforeActivityId: IdentifierSchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ClientAgentActivityListRequest = z.infer<
  typeof ClientAgentActivityListRequestSchema
>;

export const ClientAgentActivityListResponseSchema = z
  .object({
    activities: z.array(AgentActivityRecordSchema).max(100),
    nextCursor: IdentifierSchema.optional(),
  })
  .strict();
export type ClientAgentActivityListResponse = z.infer<
  typeof ClientAgentActivityListResponseSchema
>;

export const ClientRoomCreateRequestSchema = z
  .object({
    basedOnControlRoomSeq: z.number().int().nonnegative(),
    description: z.string().trim().max(2_000).optional(),
    idempotencyKey: IdentifierSchema,
    initialAgentParticipantIds: z.array(IdentifierSchema).max(50).optional(),
    kind: RoomKindSchema.refine((kind) => kind === "channel", {
      message: "initial managed Room creation only supports channel",
    }),
    name: IdentifierSchema,
    slug: IdentifierSchema,
    visibility: RoomVisibilitySchema.optional(),
    workspaceId: IdentifierSchema,
  })
  .strict();
export type ClientRoomCreateRequest = z.infer<
  typeof ClientRoomCreateRequestSchema
>;

export const ClientRoomUpdateRequestSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    description: z.string().trim().max(2_000).optional(),
    idempotencyKey: IdentifierSchema,
    name: IdentifierSchema,
    roomId: IdentifierSchema,
    visibility: RoomVisibilitySchema,
  })
  .strict();
export type ClientRoomUpdateRequest = z.infer<
  typeof ClientRoomUpdateRequestSchema
>;

export const ClientDirectRoomOpenRequestSchema = z
  .object({
    basedOnControlRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    peerPrincipalId: IdentifierSchema,
    workspaceId: IdentifierSchema,
  })
  .strict();
export type ClientDirectRoomOpenRequest = z.infer<
  typeof ClientDirectRoomOpenRequestSchema
>;

export const ClientDirectRoomOpenResponseSchema = z
  .object({
    room: RoomSchema.refine((room) => room.kind === "direct", {
      message: "opened Room must be direct",
    }),
  })
  .strict();
export type ClientDirectRoomOpenResponse = z.infer<
  typeof ClientDirectRoomOpenResponseSchema
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
    afterSeq: z.number().int().nonnegative().optional(),
    beforeSeq: z.number().int().positive().optional(),
    limit: z.number().int().positive().max(500).default(100),
    roomId: IdentifierSchema,
    threadId: IdentifierSchema.optional(),
  })
  .strict()
  .refine(
    ({ afterSeq, beforeSeq }) =>
      afterSeq === undefined || beforeSeq === undefined,
    { message: "message pagination accepts either afterSeq or beforeSeq" },
  );
export type ClientMessagesListRequest = z.infer<
  typeof ClientMessagesListRequestSchema
>;

export const ClientMessagesListResponseSchema = z
  .object({
    cursorAfter: z.number().int().nonnegative(),
    cursorBefore: z.number().int().nonnegative(),
    hasMoreAfter: z.boolean(),
    hasMoreBefore: z.boolean(),
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
    attachmentIds: z.array(IdentifierSchema).max(10).optional(),
    basedOnRoomSeq: z.number().int().nonnegative(),
    body: z.string().trim(),
    idempotencyKey: IdentifierSchema,
    recipients: z.array(ClientAttentionRecipientSchema).default([]),
    roomId: IdentifierSchema,
  })
  .strict()
  .refine(
    (input) => input.body.length > 0 || !!input.attachmentIds?.length,
    "message body or attachment is required",
  );
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
