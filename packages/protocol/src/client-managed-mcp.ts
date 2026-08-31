import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";
import {
  ManagedMcpServerDefinitionSchema,
  ManagedMcpToolDefinitionSchema,
} from "./managed-mcp.ts";
import { RoomEventSchema } from "./room-event.ts";

export const ManagedMcpServerRecordSchema = z
  .object({
    configVersion: z.number().int().positive(),
    controlRoomId: IdentifierSchema,
    currentRevisionId: IdentifierSchema,
    definition: ManagedMcpServerDefinitionSchema,
    mcpServerId: IdentifierSchema,
    state: z.enum(["disabled", "enabled"]),
  })
  .strict();
export type ManagedMcpServerRecord = z.infer<
  typeof ManagedMcpServerRecordSchema
>;

export const ManagedMcpAssignmentRecordSchema = z
  .object({
    allowedToolNames: z.array(ManagedMcpToolDefinitionSchema.shape.toolName),
    assignmentId: IdentifierSchema,
    assignmentVersion: z.number().int().positive(),
    currentRevisionId: IdentifierSchema,
    enabled: z.boolean(),
    mcpServerId: IdentifierSchema,
    participantId: IdentifierSchema,
  })
  .strict();
export type ManagedMcpAssignmentRecord = z.infer<
  typeof ManagedMcpAssignmentRecordSchema
>;

const CausalMutationSchema = z.object({
  basedOnRoomSeq: z.number().int().nonnegative(),
  idempotencyKey: IdentifierSchema,
});

export const ManagedMcpExecutorDescriptorSchema = z
  .object({
    executorRef: IdentifierSchema,
    transportKind: z.literal("streamable-http"),
  })
  .strict();
export type ManagedMcpExecutorDescriptor = z.infer<
  typeof ManagedMcpExecutorDescriptorSchema
>;
export const ClientManagedMcpExecutorsListRequestSchema = z
  .object({ controlRoomId: IdentifierSchema })
  .strict();
export type ClientManagedMcpExecutorsListRequest = z.infer<
  typeof ClientManagedMcpExecutorsListRequestSchema
>;
export const ClientManagedMcpExecutorsListResponseSchema = z
  .object({ executors: z.array(ManagedMcpExecutorDescriptorSchema) })
  .strict();
export type ClientManagedMcpExecutorsListResponse = z.infer<
  typeof ClientManagedMcpExecutorsListResponseSchema
>;
export const ClientManagedMcpExecutorDiscoverRequestSchema = z
  .object({
    controlRoomId: IdentifierSchema,
    executorRef: IdentifierSchema,
  })
  .strict();
export type ClientManagedMcpExecutorDiscoverRequest = z.infer<
  typeof ClientManagedMcpExecutorDiscoverRequestSchema
>;
export const ClientManagedMcpExecutorDiscoverResponseSchema = z
  .object({ tools: z.array(ManagedMcpToolDefinitionSchema).max(512) })
  .strict();
export type ClientManagedMcpExecutorDiscoverResponse = z.infer<
  typeof ClientManagedMcpExecutorDiscoverResponseSchema
>;

export const ClientManagedMcpServersListRequestSchema = z
  .object({ controlRoomId: IdentifierSchema })
  .strict();
export type ClientManagedMcpServersListRequest = z.infer<
  typeof ClientManagedMcpServersListRequestSchema
>;
export const ClientManagedMcpServersListResponseSchema = z
  .object({ servers: z.array(ManagedMcpServerRecordSchema) })
  .strict();
export type ClientManagedMcpServersListResponse = z.infer<
  typeof ClientManagedMcpServersListResponseSchema
>;

export const ClientManagedMcpServerCreateRequestSchema =
  CausalMutationSchema.extend({
    controlRoomId: IdentifierSchema,
    definition: ManagedMcpServerDefinitionSchema,
    mcpServerId: IdentifierSchema,
  }).strict();
export type ClientManagedMcpServerCreateRequest = z.infer<
  typeof ClientManagedMcpServerCreateRequestSchema
>;
export const ClientManagedMcpServerReviseRequestSchema =
  CausalMutationSchema.extend({
    definition: ManagedMcpServerDefinitionSchema,
    expectedConfigVersion: z.number().int().positive(),
    mcpServerId: IdentifierSchema,
  }).strict();
export type ClientManagedMcpServerReviseRequest = z.infer<
  typeof ClientManagedMcpServerReviseRequestSchema
>;
export const ClientManagedMcpServerStateRequestSchema =
  CausalMutationSchema.extend({
    expectedConfigVersion: z.number().int().positive(),
    mcpServerId: IdentifierSchema,
    state: z.enum(["disabled", "enabled"]),
  }).strict();
export type ClientManagedMcpServerStateRequest = z.infer<
  typeof ClientManagedMcpServerStateRequestSchema
>;
export const ClientManagedMcpServerMutationResponseSchema = z
  .object({
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    server: ManagedMcpServerRecordSchema,
  })
  .strict();
export type ClientManagedMcpServerMutationResponse = z.infer<
  typeof ClientManagedMcpServerMutationResponseSchema
>;

export const ClientManagedMcpAssignmentsListRequestSchema = z
  .object({
    controlRoomId: IdentifierSchema,
    participantId: IdentifierSchema.optional(),
  })
  .strict();
export type ClientManagedMcpAssignmentsListRequest = z.infer<
  typeof ClientManagedMcpAssignmentsListRequestSchema
>;
export const ClientManagedMcpAssignmentsListResponseSchema = z
  .object({ assignments: z.array(ManagedMcpAssignmentRecordSchema) })
  .strict();
export type ClientManagedMcpAssignmentsListResponse = z.infer<
  typeof ClientManagedMcpAssignmentsListResponseSchema
>;

const AssignmentMutationSchema = CausalMutationSchema.extend({
  allowedToolNames: z
    .array(ManagedMcpToolDefinitionSchema.shape.toolName)
    .min(1)
    .max(128),
  mcpServerId: IdentifierSchema,
  participantId: IdentifierSchema,
});
export const ClientManagedMcpAssignmentCreateRequestSchema =
  AssignmentMutationSchema.strict();
export type ClientManagedMcpAssignmentCreateRequest = z.infer<
  typeof ClientManagedMcpAssignmentCreateRequestSchema
>;
export const ClientManagedMcpAssignmentReviseRequestSchema =
  AssignmentMutationSchema.extend({
    expectedAssignmentVersion: z.number().int().positive(),
  }).strict();
export type ClientManagedMcpAssignmentReviseRequest = z.infer<
  typeof ClientManagedMcpAssignmentReviseRequestSchema
>;
export const ClientManagedMcpAssignmentStateRequestSchema =
  CausalMutationSchema.extend({
    expectedAssignmentVersion: z.number().int().positive(),
    mcpServerId: IdentifierSchema,
    participantId: IdentifierSchema,
    state: z.enum(["disabled", "enabled"]),
  }).strict();
export type ClientManagedMcpAssignmentStateRequest = z.infer<
  typeof ClientManagedMcpAssignmentStateRequestSchema
>;
export const ClientManagedMcpAssignmentMutationResponseSchema = z
  .object({
    assignment: ManagedMcpAssignmentRecordSchema,
    deduplicated: z.boolean(),
    event: RoomEventSchema,
  })
  .strict();
export type ClientManagedMcpAssignmentMutationResponse = z.infer<
  typeof ClientManagedMcpAssignmentMutationResponseSchema
>;

export const ManagedMcpUsageRecordSchema = z
  .object({
    assignmentVersion: z.number().int().positive(),
    completedAt: TimestampSchema.optional(),
    configVersion: z.number().int().positive(),
    createdAt: TimestampSchema,
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
    participantId: IdentifierSchema,
    roomId: IdentifierSchema,
    runAttemptId: IdentifierSchema,
    serverName: z.string().trim().min(1).max(512),
    state: z.enum(["pending", "completed", "failed"]),
    toolName: ManagedMcpToolDefinitionSchema.shape.toolName,
  })
  .strict()
  .superRefine((record, context) => {
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
        message: "managed MCP usage terminal fields do not match state",
      });
    }
  });
export type ManagedMcpUsageRecord = z.infer<typeof ManagedMcpUsageRecordSchema>;

export const ClientManagedMcpUsageListRequestSchema = z
  .object({
    beforeCallId: IdentifierSchema.optional(),
    controlRoomId: IdentifierSchema,
    limit: z.number().int().min(1).max(100).optional(),
    participantId: IdentifierSchema,
  })
  .strict();
export type ClientManagedMcpUsageListRequest = z.infer<
  typeof ClientManagedMcpUsageListRequestSchema
>;

export const ClientManagedMcpUsageListResponseSchema = z
  .object({
    calls: z.array(ManagedMcpUsageRecordSchema).max(100),
    nextCursor: IdentifierSchema.optional(),
  })
  .strict();
export type ClientManagedMcpUsageListResponse = z.infer<
  typeof ClientManagedMcpUsageListResponseSchema
>;
