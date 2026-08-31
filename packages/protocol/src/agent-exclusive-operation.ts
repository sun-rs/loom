import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";

export const AGENT_EXCLUSIVE_OPERATION_MAX_LEASE_MS = 5 * 60_000;

export const AgentExclusiveOperationKindSchema = z.enum([
  "memory_maintenance",
  "memory_reset",
  "execution_restart",
  "task_reassignment",
]);
export type AgentExclusiveOperationKind = z.infer<
  typeof AgentExclusiveOperationKindSchema
>;

export const AgentExclusiveOperationLeaseStateSchema = z.enum([
  "active",
  "released",
]);
export type AgentExclusiveOperationLeaseState = z.infer<
  typeof AgentExclusiveOperationLeaseStateSchema
>;

export const AgentExclusiveOperationLeaseSchema = z
  .object({
    acquiredAt: TimestampSchema,
    kind: AgentExclusiveOperationKindSchema,
    leaseId: IdentifierSchema,
    leaseUntil: TimestampSchema,
    operationId: IdentifierSchema,
    ownerHostId: IdentifierSchema,
    ownerHostInstanceId: IdentifierSchema,
    participantId: IdentifierSchema,
    releasedAt: TimestampSchema.optional(),
    renewedAt: TimestampSchema,
    schemaVersion: z.literal(1),
    state: AgentExclusiveOperationLeaseStateSchema,
  })
  .strict()
  .superRefine((lease, context) => {
    if (
      (lease.state === "active" && lease.releasedAt !== undefined) ||
      (lease.state === "released" && lease.releasedAt === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "releasedAt must match the released lease state",
        path: ["releasedAt"],
      });
    }
    if (Date.parse(lease.renewedAt) < Date.parse(lease.acquiredAt)) {
      context.addIssue({
        code: "custom",
        message: "renewedAt must not precede acquiredAt",
        path: ["renewedAt"],
      });
    }
    if (Date.parse(lease.leaseUntil) <= Date.parse(lease.renewedAt)) {
      context.addIssue({
        code: "custom",
        message: "leaseUntil must follow renewedAt",
        path: ["leaseUntil"],
      });
    }
  });
export type AgentExclusiveOperationLease = z.infer<
  typeof AgentExclusiveOperationLeaseSchema
>;

export const AgentExclusiveOperationAcquireInputSchema = z
  .object({
    kind: AgentExclusiveOperationKindSchema,
    leaseMs: z
      .number()
      .int()
      .positive()
      .max(AGENT_EXCLUSIVE_OPERATION_MAX_LEASE_MS),
    operationId: IdentifierSchema,
    participantId: IdentifierSchema,
  })
  .strict();
export type AgentExclusiveOperationAcquireInput = z.infer<
  typeof AgentExclusiveOperationAcquireInputSchema
>;

export const AgentExclusiveOperationRenewInputSchema = z
  .object({
    leaseId: IdentifierSchema,
    leaseMs: z
      .number()
      .int()
      .positive()
      .max(AGENT_EXCLUSIVE_OPERATION_MAX_LEASE_MS),
    operationId: IdentifierSchema,
  })
  .strict();
export type AgentExclusiveOperationRenewInput = z.infer<
  typeof AgentExclusiveOperationRenewInputSchema
>;

export const AgentExclusiveOperationReleaseInputSchema = z
  .object({
    leaseId: IdentifierSchema,
    operationId: IdentifierSchema,
  })
  .strict();
export type AgentExclusiveOperationReleaseInput = z.infer<
  typeof AgentExclusiveOperationReleaseInputSchema
>;
