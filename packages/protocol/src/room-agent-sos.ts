import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";
import { RoomEventSchema } from "./room-event.ts";

export const RoomAgentSosStateSchema = z.enum([
  "stopping",
  "stopped",
  "resumed",
]);
export type RoomAgentSosState = z.infer<typeof RoomAgentSosStateSchema>;

export const RoomAgentSosOperationSchema = z
  .object({
    guidance: z.string().trim().min(1).max(4_000).optional(),
    operationId: IdentifierSchema,
    pendingTargetCount: z.number().int().nonnegative(),
    requestedAt: TimestampSchema,
    requestedBy: IdentifierSchema,
    resumedAt: TimestampSchema.optional(),
    roomId: IdentifierSchema,
    state: RoomAgentSosStateSchema,
    stoppedAt: TimestampSchema.optional(),
    targetCount: z.number().int().nonnegative(),
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((operation, context) => {
    if (operation.pendingTargetCount > operation.targetCount) {
      context.addIssue({
        code: "custom",
        message: "pendingTargetCount cannot exceed targetCount",
      });
    }
    if (
      operation.state === "stopping" &&
      (operation.stoppedAt !== undefined ||
        operation.resumedAt !== undefined ||
        operation.guidance !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "stopping operations cannot contain terminal fields",
      });
    }
    if (
      operation.state === "stopped" &&
      (operation.stoppedAt === undefined ||
        operation.resumedAt !== undefined ||
        operation.guidance !== undefined ||
        operation.pendingTargetCount !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "stopped operations require complete stop evidence",
      });
    }
    if (
      operation.state === "resumed" &&
      (operation.stoppedAt === undefined ||
        operation.resumedAt === undefined ||
        operation.guidance === undefined ||
        operation.pendingTargetCount !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "resumed operations require stop and guidance evidence",
      });
    }
  });
export type RoomAgentSosOperation = z.infer<typeof RoomAgentSosOperationSchema>;

export const ClientRoomAgentSosStopRequestSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    roomId: IdentifierSchema,
  })
  .strict();
export type ClientRoomAgentSosStopRequest = z.infer<
  typeof ClientRoomAgentSosStopRequestSchema
>;

export const ClientRoomAgentSosResumeRequestSchema = z
  .object({
    basedOnRoomSeq: z.number().int().nonnegative(),
    guidance: z.string().trim().min(1).max(4_000),
    idempotencyKey: IdentifierSchema,
    roomId: IdentifierSchema,
  })
  .strict();
export type ClientRoomAgentSosResumeRequest = z.infer<
  typeof ClientRoomAgentSosResumeRequestSchema
>;

export const ClientRoomAgentSosResponseSchema = z
  .object({
    deduplicated: z.boolean(),
    event: RoomEventSchema,
    operation: RoomAgentSosOperationSchema,
  })
  .strict();
export type ClientRoomAgentSosResponse = z.infer<
  typeof ClientRoomAgentSosResponseSchema
>;
