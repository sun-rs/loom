import { z } from "zod";
import { IdentifierSchema } from "./common.ts";
import { RoomEventSchema } from "./room-event.ts";
import { TaskSchema } from "./task.ts";
import {
  InputRequestSchema,
  InputRequestStatusSchema,
} from "./input-request.ts";
export const ClientTaskMutationResponseSchema = z
  .object({
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    task: TaskSchema,
  })
  .strict();
export type ClientTaskMutationResponse = z.infer<
  typeof ClientTaskMutationResponseSchema
>;

export const ClientTaskAttentionMutationResponseSchema =
  ClientTaskMutationResponseSchema.extend({
    activationIds: z.array(IdentifierSchema),
  }).strict();
export type ClientTaskAttentionMutationResponse = z.infer<
  typeof ClientTaskAttentionMutationResponseSchema
>;

export const ClientInputRequestsListResponseSchema = z
  .object({ inputRequests: z.array(InputRequestSchema) })
  .strict();
export type ClientInputRequestsListResponse = z.infer<
  typeof ClientInputRequestsListResponseSchema
>;

export const WorkerAcknowledgeResponseSchema = z
  .object({
    acknowledgedThrough: z.number().int().nonnegative(),
  })
  .strict();
export type WorkerAcknowledgeResponse = z.infer<
  typeof WorkerAcknowledgeResponseSchema
>;

export const WorkerTaskMutationResponseSchema = z
  .object({
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    task: TaskSchema,
  })
  .strict();
export type WorkerTaskMutationResponse = z.infer<
  typeof WorkerTaskMutationResponseSchema
>;

export const WorkerTaskAttentionMutationResponseSchema =
  WorkerTaskMutationResponseSchema.extend({
    activationIds: z.array(IdentifierSchema),
  }).strict();
export type WorkerTaskAttentionMutationResponse = z.infer<
  typeof WorkerTaskAttentionMutationResponseSchema
>;

export const WorkerTaskRequestInputResponseSchema = z
  .object({
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    inputRequest: InputRequestSchema,
    task: TaskSchema,
  })
  .strict();
export type WorkerTaskRequestInputResponse = z.infer<
  typeof WorkerTaskRequestInputResponseSchema
>;

export const InputRequestResolveResponseSchema = z
  .object({
    activationIds: z.array(IdentifierSchema),
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    inputRequest: InputRequestSchema,
    task: TaskSchema,
  })
  .strict();
export type InputRequestResolveResponse = z.infer<
  typeof InputRequestResolveResponseSchema
>;

export const WorkerTaskGetResponseSchema = z
  .object({
    task: TaskSchema,
  })
  .strict();
export type WorkerTaskGetResponse = z.infer<typeof WorkerTaskGetResponseSchema>;

export const WorkerTaskInputStatusResponseSchema = z
  .object({
    inputRequest: InputRequestStatusSchema.nullable(),
  })
  .strict();
export type WorkerTaskInputStatusResponse = z.infer<
  typeof WorkerTaskInputStatusResponseSchema
>;

/**
 * Raft holds a Task claim, status update or amendment on stale context the same
 * way it holds a send: `formatFreshnessHoldOutput` is written to stdout and the
 * command returns 0 (`dist-UT7IQEHX.js@2818799`, `@2828615`, `@2840513`). The
 * mutation is simply not applied — unlike a send, no draft is saved, so this
 * carries no draft id, rehold count or continue-anyway suggestion.
 */
export const WorkerTaskHeldResponseSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    newMessageCount: z.number().int().nonnegative(),
    newerMessages: z.array(RoomEventSchema),
    omittedMessageCount: z.number().int().nonnegative(),
    reason: z.literal("newer_messages_available"),
    seenUpToSeq: z.number().int().nonnegative(),
    shownMessageCount: z.number().int().nonnegative(),
    state: z.literal("held"),
  })
  .strict();
export type WorkerTaskHeldResponse = z.infer<
  typeof WorkerTaskHeldResponseSchema
>;
