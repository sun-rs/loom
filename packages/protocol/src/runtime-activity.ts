import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1);
const TimestampSchema = z.iso.datetime({ offset: true });
const BoundedTextSchema = z.string().max(8_192);
const ProducerFactIdSchema = z.string().trim().min(1).max(512).optional();

export const RuntimeTrajectoryActivitySchema = z.enum([
  "error",
  "offline",
  "online",
  "thinking",
  "working",
]);
export type RuntimeTrajectoryActivity = z.infer<
  typeof RuntimeTrajectoryActivitySchema
>;

export const RuntimeTrajectoryDetailKindSchema = z.enum([
  "checking_messages",
  "compacting_context",
  "compaction_finished",
  "computer_operation_failed",
  "computer_restarted",
  "computer_started",
  "computer_upgraded",
  "machine_disconnected",
  "message_received",
  "model_request_started",
  "model_response_started",
  "none",
  "other",
  "running_command",
  "runtime_crashed",
  "runtime_error",
  "runtime_progress",
  "starting",
  "stopped",
  "subagent_activity",
  "thinking_end",
  "thinking_started",
  "tool_end",
  "tool_started",
]);
export type RuntimeTrajectoryDetailKind = z.infer<
  typeof RuntimeTrajectoryDetailKindSchema
>;

const RuntimeTrajectorySubagentSchema = z
  .object({ subagentType: z.string().trim().min(1).max(128).optional() })
  .strict();

const RuntimeTrajectoryEntryBaseShape = {
  producerFactId: ProducerFactIdSchema,
  subagent: RuntimeTrajectorySubagentSchema.optional(),
} as const;

export const RuntimeTrajectoryEntrySchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...RuntimeTrajectoryEntryBaseShape,
      kind: z.literal("thinking"),
      text: BoundedTextSchema,
    })
    .strict(),
  z
    .object({
      ...RuntimeTrajectoryEntryBaseShape,
      kind: z.literal("tool_start"),
      toolInput: z.string().max(4_096).optional(),
      toolName: z.string().trim().min(1).max(512),
    })
    .strict(),
  z
    .object({
      ...RuntimeTrajectoryEntryBaseShape,
      kind: z.literal("text"),
      text: BoundedTextSchema,
    })
    .strict(),
  z
    .object({
      ...RuntimeTrajectoryEntryBaseShape,
      kind: z.enum(["slock_action", "system"]),
      text: BoundedTextSchema,
      title: z.string().trim().min(1).max(512),
    })
    .strict(),
  z
    .object({
      ...RuntimeTrajectoryEntryBaseShape,
      kind: z.enum(["compaction_finished", "compaction_started"]),
    })
    .strict(),
  z
    .object({
      ...RuntimeTrajectoryEntryBaseShape,
      activity: RuntimeTrajectoryActivitySchema,
      detail: z.string().max(2_048).optional(),
      detailKind: RuntimeTrajectoryDetailKindSchema.optional(),
      kind: z.literal("status"),
    })
    .strict(),
]);
export type RuntimeTrajectoryEntry = z.infer<
  typeof RuntimeTrajectoryEntrySchema
>;

export const RuntimeTrajectoryAppendInputSchema = z
  .object({
    entry: RuntimeTrajectoryEntrySchema,
    observedAt: TimestampSchema,
    producerSequence: z.number().int().positive(),
    runAttemptId: IdentifierSchema,
    runtimeRunId: IdentifierSchema,
  })
  .strict();
export type RuntimeTrajectoryAppendInput = z.infer<
  typeof RuntimeTrajectoryAppendInputSchema
>;

export const RuntimeTrajectoryRecordSchema =
  RuntimeTrajectoryAppendInputSchema.extend({
    activityId: IdentifierSchema,
    participantId: IdentifierSchema,
    recordedAt: TimestampSchema,
    roomId: IdentifierSchema,
    serverSequence: z.number().int().positive(),
    context: z
      .object({
        roomId: IdentifierSchema,
        roomName: z.string(),
        roomKind: z.string(),
      })
      .strict()
      .optional(),
  }).strict();
export type RuntimeTrajectoryRecord = z.infer<
  typeof RuntimeTrajectoryRecordSchema
>;

export const ClientAgentTrajectoryListRequestSchema = z
  .object({
    agentId: IdentifierSchema,
    beforeActivityId: IdentifierSchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ClientAgentTrajectoryListRequest = z.infer<
  typeof ClientAgentTrajectoryListRequestSchema
>;

export const ClientAgentTrajectoryListResponseSchema = z
  .object({
    activities: z.array(RuntimeTrajectoryRecordSchema).max(100),
    nextCursor: IdentifierSchema.optional(),
  })
  .strict();
export type ClientAgentTrajectoryListResponse = z.infer<
  typeof ClientAgentTrajectoryListResponseSchema
>;
