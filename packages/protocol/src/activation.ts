import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";

export const ActivationReasonSchema = z.enum([
  "mention",
  "dm",
  "task_assigned",
  "task_available",
  "task_collaboration",
  "task_review",
  "task_updated",
  "dependency_resolved",
  "input_requested",
  "input_resolved",
  "thread_subscription",
  "reminder",
  "room_policy",
  "manual",
]);
export type ActivationReason = z.infer<typeof ActivationReasonSchema>;

export const ActivationStateSchema = z.enum([
  "queued",
  "leased",
  "quarantined",
  "completed",
  "cancelled",
]);
export type ActivationState = z.infer<typeof ActivationStateSchema>;

export const ActivationSchema = z
  .object({
    activationId: IdentifierSchema,
    roomId: IdentifierSchema,
    participantId: IdentifierSchema,
    fromSeq: z.number().int().positive(),
    toSeq: z.number().int().positive(),
    reason: ActivationReasonSchema,
    state: ActivationStateSchema,
    leaseOwner: IdentifierSchema.optional(),
    leaseUntil: TimestampSchema.optional(),
    attemptCount: z.number().int().nonnegative(),
    availableAt: TimestampSchema.optional(),
    lastError: z.string().min(1).optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .refine((activation) => activation.fromSeq <= activation.toSeq, {
    message: "fromSeq must be less than or equal to toSeq",
    path: ["fromSeq"],
  })
  .refine(
    (activation) =>
      activation.state !== "leased" ||
      (activation.leaseOwner !== undefined &&
        activation.leaseUntil !== undefined),
    {
      message: "leased activations require leaseOwner and leaseUntil",
      path: ["leaseOwner"],
    },
  );
export type Activation = z.infer<typeof ActivationSchema>;

export const WakeHintSchema = z
  .object({
    activationId: IdentifierSchema,
    participantId: IdentifierSchema,
    roomId: IdentifierSchema,
    headCursor: z.number().int().positive(),
    reason: ActivationReasonSchema,
  })
  .strict();
export type WakeHint = z.infer<typeof WakeHintSchema>;
