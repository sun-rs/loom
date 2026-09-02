import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";

export const ReminderStatusSchema = z.enum(["scheduled", "fired", "canceled"]);
export type ReminderStatus = z.infer<typeof ReminderStatusSchema>;

export const ReminderEventTypeSchema = z.enum([
  "scheduled",
  "fired",
  "snoozed",
  "updated",
  "canceled",
]);
export type ReminderEventType = z.infer<typeof ReminderEventTypeSchema>;

export const ReminderRecurrenceSchema = z
  .object({
    description: z.string().trim().min(1),
    kind: z.enum(["interval", "daily", "weekly", "unsupported"]),
  })
  .strict();
export type ReminderRecurrence = z.infer<typeof ReminderRecurrenceSchema>;

export const ReminderSchema = z
  .object({
    reminderId: IdentifierSchema,
    ownerAgentId: IdentifierSchema,
    ownerParticipantId: IdentifierSchema,
    roomId: IdentifierSchema,
    targetRoomId: IdentifierSchema,
    threadId: IdentifierSchema.optional(),
    rootMessageId: IdentifierSchema.optional(),
    title: z.string().trim().min(1),
    fireAt: TimestampSchema,
    firedAt: TimestampSchema.optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    status: ReminderStatusSchema,
    msgId: IdentifierSchema,
    payload: z.record(z.string(), z.unknown()).optional(),
    recurrence: ReminderRecurrenceSchema.optional(),
    repeat: z.string().trim().min(1).optional(),
    timezone: z.string().trim().min(1).optional(),
    version: z.number().int().positive(),
  })
  .strict();
export type Reminder = z.infer<typeof ReminderSchema>;

export const ReminderEventSchema = z
  .object({
    eventId: IdentifierSchema,
    reminderId: IdentifierSchema,
    eventType: ReminderEventTypeSchema,
    actorType: z.enum(["agent", "human", "system"]),
    actorId: IdentifierSchema.optional(),
    occurredAt: TimestampSchema,
    nextFireAt: TimestampSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ReminderEvent = z.infer<typeof ReminderEventSchema>;

const ReminderIdempotencySchema = z
  .object({ idempotencyKey: IdentifierSchema })
  .strict();

export const WorkerReminderScheduleRequestSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    channel: z.string().trim().min(2).max(512).optional(),
    delaySeconds: z.number().int().positive().optional(),
    fireAt: TimestampSchema.optional(),
    idempotencyKey: IdentifierSchema,
    messageId: IdentifierSchema,
    payload: z.record(z.string(), z.unknown()).optional(),
    repeat: z.string().trim().min(1).optional(),
    timezone: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).max(2_000),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.delaySeconds !== undefined && request.fireAt !== undefined) {
      context.addIssue({
        code: "custom",
        message: "delaySeconds and fireAt are mutually exclusive",
        path: ["fireAt"],
      });
    }
    if (
      request.delaySeconds === undefined &&
      request.fireAt === undefined &&
      request.repeat === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "one of delaySeconds, fireAt, or repeat is required",
        path: ["fireAt"],
      });
    }
  });
export type WorkerReminderScheduleRequest = z.infer<
  typeof WorkerReminderScheduleRequestSchema
>;

export const WorkerReminderListRequestSchema = z
  .object({
    all: z.boolean().optional(),
    status: ReminderStatusSchema.optional(),
    statuses: z.array(ReminderStatusSchema).min(1).max(3).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.status !== undefined && request.statuses !== undefined) {
      context.addIssue({
        code: "custom",
        message: "status and statuses are mutually exclusive",
      });
    }
  });
export type WorkerReminderListRequest = z.infer<
  typeof WorkerReminderListRequestSchema
>;

export const WorkerReminderCancelRequestSchema =
  ReminderIdempotencySchema.extend({
    reminderId: IdentifierSchema,
  }).strict();
export type WorkerReminderCancelRequest = z.infer<
  typeof WorkerReminderCancelRequestSchema
>;

export const WorkerReminderSnoozeRequestSchema =
  ReminderIdempotencySchema.extend({
    delaySeconds: z.number().int().positive(),
    reminderId: IdentifierSchema,
  }).strict();
export type WorkerReminderSnoozeRequest = z.infer<
  typeof WorkerReminderSnoozeRequestSchema
>;

export const WorkerReminderUpdateRequestSchema =
  ReminderIdempotencySchema.extend({
    delaySeconds: z.number().int().positive().optional(),
    fireAt: TimestampSchema.optional(),
    reminderId: IdentifierSchema,
    repeat: z.string().trim().min(1).nullable().optional(),
    timezone: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).max(2_000).optional(),
  })
    .strict()
    .superRefine((request, context) => {
      const changes = [
        request.delaySeconds,
        request.fireAt,
        request.repeat,
        request.title,
      ].filter((value) => value !== undefined);
      if (changes.length !== 1) {
        context.addIssue({
          code: "custom",
          message: "exactly one reminder field must be updated",
        });
      }
    });
export type WorkerReminderUpdateRequest = z.infer<
  typeof WorkerReminderUpdateRequestSchema
>;

export const WorkerReminderLogRequestSchema = z
  .object({ reminderId: IdentifierSchema })
  .strict();
export type WorkerReminderLogRequest = z.infer<
  typeof WorkerReminderLogRequestSchema
>;

export const WorkerReminderMutationResponseSchema = z
  .object({ deduplicated: z.boolean(), reminder: ReminderSchema })
  .strict();
export type WorkerReminderMutationResponse = z.infer<
  typeof WorkerReminderMutationResponseSchema
>;

export const WorkerReminderListResponseSchema = z
  .object({ reminders: z.array(ReminderSchema) })
  .strict();
export type WorkerReminderListResponse = z.infer<
  typeof WorkerReminderListResponseSchema
>;

export const WorkerReminderLogResponseSchema = z
  .object({ events: z.array(ReminderEventSchema), reminder: ReminderSchema })
  .strict();
export type WorkerReminderLogResponse = z.infer<
  typeof WorkerReminderLogResponseSchema
>;

export const ClientAgentRemindersListRequestSchema = z
  .object({
    agentDefinitionId: IdentifierSchema,
    all: z.boolean().optional(),
    status: ReminderStatusSchema.optional(),
  })
  .strict();
export type ClientAgentRemindersListRequest = z.infer<
  typeof ClientAgentRemindersListRequestSchema
>;

export const ClientAgentRemindersListResponseSchema = z
  .object({ reminders: z.array(ReminderSchema) })
  .strict();
export type ClientAgentRemindersListResponse = z.infer<
  typeof ClientAgentRemindersListResponseSchema
>;
