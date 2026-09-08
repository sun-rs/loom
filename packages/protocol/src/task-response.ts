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
