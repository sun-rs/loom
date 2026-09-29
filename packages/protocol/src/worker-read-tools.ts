import { WorkerAddressingSchema } from "./worker-addressing.ts";
export * from "./worker-target-context.ts";
export * from "./worker-visible-profile.ts";
import { WorkerVisibleProfileMetadataSchema } from "./worker-visible-profile.ts";
export * from "./worker-room-targets.ts";
import { WorkerReadChannelSchema } from "./worker-room-targets.ts";
import { TaskAmendChangesSchema } from "./task-amend.ts";
import { z } from "zod";
import { IdentifierSchema, TimestampSchema } from "./common.ts";
import { AgentDefinitionStateSchema } from "./agent-definition.ts";
import { MessageSchema, PrincipalSchema, RoomSchema } from "./collaboration.ts";
import { TaskSchema, TaskWorkflowStatusSchema } from "./task.ts";
import { MAX_ATTACHMENT_BYTES } from "./room-files.ts";

const Page = {
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.number().int().min(1).max(100).default(50),
};
export const WorkerHistoryRequestSchema = z
  .object({
    ...Page,
    channel: WorkerReadChannelSchema.optional(),
    before: IdentifierSchema.optional(),
    after: IdentifierSchema.optional(),
    around: IdentifierSchema.optional(),
    threadId: IdentifierSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      [input.before, input.after, input.around].filter(
        (value) => value !== undefined,
      ).length <= 1,
    { message: "choose at most one of before, after, or around" },
  );
export type WorkerHistoryRequest = z.input<typeof WorkerHistoryRequestSchema>;
export const WorkerHistoryResponseSchema = z
  .object({
    readReceiptId: z.string().uuid().optional(),
    /** Messages whose bodies this run's sent wake already delivered. */
    deliveredInWakeSeqs: z
      .array(z.number().int().positive())
      .max(100)
      .optional(),
    messages: z.array(MessageSchema).max(100),
    addressing: WorkerAddressingSchema.optional(),
    frozenThroughRoomSeq: z.number().int().nonnegative(),
    olderCursor: z.string().optional(),
    newerCursor: z.string().optional(),
    nextCursor: z.string().optional(),
  })
  .strict();
export type WorkerHistoryResponse = z.infer<typeof WorkerHistoryResponseSchema>;

export const WorkerMessageResolveRequestSchema = z
  .object({
    messageId: IdentifierSchema,
    channel: WorkerReadChannelSchema.optional(),
  })
  .strict();
export type WorkerMessageResolveRequest = z.infer<
  typeof WorkerMessageResolveRequestSchema
>;
export const WorkerMessageResolveResponseSchema = z
  .object({
    message: MessageSchema,
    addressing: WorkerAddressingSchema.optional(),
    rootMessage: MessageSchema.optional(),
    threadId: IdentifierSchema.optional(),
  })
  .strict();
export type WorkerMessageResolveResponse = z.infer<
  typeof WorkerMessageResolveResponseSchema
>;

export const WorkerMembersRequestSchema = z
  .object({ ...Page, channel: WorkerReadChannelSchema.optional() })
  .strict();
export type WorkerMembersRequest = z.input<typeof WorkerMembersRequestSchema>;
export const WorkerVisibleProfileSchema = z
  .object({
    ...WorkerVisibleProfileMetadataSchema.partial().shape,
    principal: PrincipalSchema,
    displayName: z.string().min(1).max(128),
    description: z.string().max(3000).optional(),
    avatarKey: IdentifierSchema.optional(),
    isSelf: z.boolean(),
    agentId: IdentifierSchema.optional(),
    agentState: AgentDefinitionStateSchema.optional(),
  })
  .strict();
export const WorkerMembersResponseSchema = z
  .object({
    roomId: IdentifierSchema,
    members: z.array(WorkerVisibleProfileSchema).max(100),
    nextCursor: z.string().optional(),
  })
  .strict();
export type WorkerMembersResponse = z.infer<typeof WorkerMembersResponseSchema>;
export const WorkerServerInfoResponseSchema =
  WorkerMembersResponseSchema.extend({
    scope: z.enum(["current_room", "selected_room"]),
    room: RoomSchema,
    selfParticipantId: IdentifierSchema,
    runtimeContext: WorkerVisibleProfileSchema.optional(),
  }).strict();
export type WorkerServerInfoResponse = z.infer<
  typeof WorkerServerInfoResponseSchema
>;
export const WorkerProfileReadRequestSchema = z
  .object({
    createdAgentsLimit: z.number().int().min(1).max(50).optional(),
    createdAgentsCursor: z.string().min(1).max(65536).optional(),
    target: IdentifierSchema.optional(),
    channel: WorkerReadChannelSchema.optional(),
  })
  .strict();
export type WorkerProfileReadRequest = z.infer<
  typeof WorkerProfileReadRequestSchema
>;
export type WorkerVisibleProfile = z.infer<typeof WorkerVisibleProfileSchema>;

export const WorkerTaskListRequestSchema = z
  .object({
    ...Page,
    channel: WorkerReadChannelSchema.optional(),
    mine: z.boolean().default(false),
    status: TaskWorkflowStatusSchema.optional(),
  })
  .strict();
export type WorkerTaskListRequest = z.input<typeof WorkerTaskListRequestSchema>;
export const WorkerTaskListResponseSchema = z
  .object({
    tasks: z.array(TaskSchema).max(100),
    projection: z.literal("current"),
    nextCursor: z.string().optional(),
  })
  .strict();
export type WorkerTaskListResponse = z.infer<
  typeof WorkerTaskListResponseSchema
>;

export const WorkerTaskHistoryRequestSchema = z
  .object({
    ...Page,
    taskId: IdentifierSchema,
    channel: WorkerReadChannelSchema.optional(),
  })
  .strict();
export type WorkerTaskHistoryRequest = z.input<
  typeof WorkerTaskHistoryRequestSchema
>;
// A narrow lifecycle record, never a raw InputRequest answer or provider log.
export const WorkerTaskHistoryEntrySchema = z
  .object({
    eventId: IdentifierSchema,
    roomSeq: z.number().int().positive(),
    type: z.string().min(1),
    actorId: IdentifierSchema,
    createdAt: TimestampSchema,
    changes: TaskAmendChangesSchema.optional(),
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    summary: z.string().optional(),
    progress: z.string().optional(),
    assigneeId: IdentifierSchema.nullable().optional(),
    workflowStatus: TaskWorkflowStatusSchema.optional(),
    previousWorkflowStatus: TaskWorkflowStatusSchema.optional(),
    disposition: z.enum(["approved", "changes_requested"]).optional(),
  })
  .strict();
export const WorkerTaskHistoryResponseSchema = z
  .object({
    taskId: IdentifierSchema,
    events: z.array(WorkerTaskHistoryEntrySchema).max(100),
    frozenThroughRoomSeq: z.number().int().nonnegative(),
    nextCursor: z.string().optional(),
  })
  .strict();
export type WorkerTaskHistoryResponse = z.infer<
  typeof WorkerTaskHistoryResponseSchema
>;

// Structural port of Raft 1.0.18 attachmentUploadContract capabilities. Local
// daemon PUT reservations do not enable the upstream presigned-object path.
export const WorkerAttachmentUploadCapabilitiesRequestSchema = z
  .object({})
  .strict();
export const WorkerAttachmentUploadCapabilitiesResponseSchema = z
  .object({
    directUploadEnabled: z.literal(false),
    directUploadThresholdBytes: z.null(),
    maxBytes: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
    sessionExpiresInSeconds: z.number().int().positive().max(86400),
  })
  .strict();
export type WorkerAttachmentUploadCapabilitiesRequest = z.input<
  typeof WorkerAttachmentUploadCapabilitiesRequestSchema
>;
export type WorkerAttachmentUploadCapabilitiesResponse = z.infer<
  typeof WorkerAttachmentUploadCapabilitiesResponseSchema
>;
