import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";

export const InputRequestStateSchema = z.enum([
  "pending",
  "resolved",
  "cancelled",
]);
export type InputRequestState = z.infer<typeof InputRequestStateSchema>;

export const InputRequestSchema = z
  .object({
    inputRequestId: IdentifierSchema,
    roomId: IdentifierSchema,
    taskId: IdentifierSchema,
    requesterId: IdentifierSchema,
    responderId: IdentifierSchema,
    question: z.string().trim().min(1),
    state: InputRequestStateSchema,
    answer: z.string().trim().min(1).optional(),
    resolvedBy: IdentifierSchema.optional(),
    cancelledAt: TimestampSchema.optional(),
    cancelledBy: IdentifierSchema.optional(),
    cancellationReason: z.string().trim().min(1).optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    resolvedAt: TimestampSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    const resolutionFields = [
      request.answer,
      request.resolvedAt,
      request.resolvedBy,
    ];
    const cancellationFields = [
      request.cancelledAt,
      request.cancelledBy,
      request.cancellationReason,
    ];
    if (
      request.state === "pending" &&
      [...resolutionFields, ...cancellationFields].some(
        (value) => value !== undefined,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "pending InputRequests cannot contain terminal evidence",
        path: ["state"],
      });
    }
    if (
      request.state === "resolved" &&
      resolutionFields.some((value) => value === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "resolved InputRequests require complete resolution evidence",
        path: ["state"],
      });
    }
    if (
      request.state === "resolved" &&
      cancellationFields.some((value) => value !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "resolved InputRequests cannot contain cancellation evidence",
        path: ["state"],
      });
    }
    if (
      request.state === "cancelled" &&
      cancellationFields.some((value) => value === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "cancelled InputRequests require complete cancellation evidence",
        path: ["state"],
      });
    }
    if (
      request.state === "cancelled" &&
      resolutionFields.some((value) => value !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "cancelled InputRequests cannot contain resolution evidence",
        path: ["state"],
      });
    }
    if (
      request.resolvedBy !== undefined &&
      request.resolvedBy !== request.responderId
    ) {
      context.addIssue({
        code: "custom",
        message: "InputRequests must be resolved by their responder",
        path: ["resolvedBy"],
      });
    }
    if (
      request.cancelledBy !== undefined &&
      request.cancelledBy !== request.responderId
    ) {
      context.addIssue({
        code: "custom",
        message: "InputRequests must be cancelled by their responder",
        path: ["cancelledBy"],
      });
    }
  });
export type InputRequest = z.infer<typeof InputRequestSchema>;

export const InputRequestStatusSchema = z
  .object({
    inputRequestId: IdentifierSchema,
    taskId: IdentifierSchema,
    state: InputRequestStateSchema,
  })
  .strict();
export type InputRequestStatus = z.infer<typeof InputRequestStatusSchema>;

export const InputRequestResolveRequestSchema = z
  .object({
    answer: z.string().trim().min(1),
    basedOnRoomSeq: z.number().int().nonnegative(),
    idempotencyKey: IdentifierSchema,
    inputRequestId: IdentifierSchema,
  })
  .strict();
export type InputRequestResolveRequest = z.infer<
  typeof InputRequestResolveRequestSchema
>;
