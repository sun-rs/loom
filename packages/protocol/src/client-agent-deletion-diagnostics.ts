import { z } from "zod";
import { IdentifierSchema, TimestampSchema } from "./common.ts";

/**
 * R5: a read-only projection of why a durable Agent deletion intent cannot
 * complete. Every field is derived from durable Kernel rows the deletion fence
 * itself reads. Free-form runtime text (recovery descriptors, provider errors,
 * credentials) is deliberately excluded: the projection carries identities and
 * enumerated states only, so it can be shown to an operator without leaking a
 * token.
 */
export const AgentDeletionBlockerKindSchema = z.enum([
  "run_attempt",
  "runtime_process",
  "activation",
  "placement",
  "exclusive_operation_lease",
]);
export type AgentDeletionBlockerKind = z.infer<
  typeof AgentDeletionBlockerKindSchema
>;

export const AgentDeletionBlockerSchema = z
  .object({
    activationId: IdentifierSchema.optional(),
    /** The Host that owns the durable row; it must return to prove termination. */
    hostId: z.string().min(1).max(200).optional(),
    kind: AgentDeletionBlockerKindSchema,
    /** Exact durable predicate the deletion fence evaluated. */
    predicate: z.string().min(1).max(200),
    recoveryDriver: z.string().min(1).max(200).optional(),
    runAttemptId: IdentifierSchema.optional(),
    runAttemptState: z.string().min(1).max(40).optional(),
    runtimeProcessState: z.string().min(1).max(40).optional(),
    /** Durable table the predicate was evaluated against. */
    table: z.string().min(1).max(80),
  })
  .strict();
export type AgentDeletionBlocker = z.infer<typeof AgentDeletionBlockerSchema>;

export const AgentDeletionStatusSchema = z.enum([
  "not_requested",
  "pending",
  "blocked",
  "completed",
]);
export type AgentDeletionStatus = z.infer<typeof AgentDeletionStatusSchema>;

export const AgentDeletionDiagnosticsSchema = z
  .object({
    agentId: IdentifierSchema,
    blocker: AgentDeletionBlockerSchema.optional(),
    /** First observation of an uninterrupted block; survives restart. */
    firstObservedAt: TimestampSchema.optional(),
    /** Derived on read: the moment the durable rows were re-evaluated. */
    observedAt: TimestampSchema,
    participantId: IdentifierSchema,
    reasonCode: z.literal("missing_runtime_termination_proof").optional(),
    /** Operator-actionable steps; never a force delete. */
    recoverySteps: z.array(z.string().min(1).max(400)).max(8),
    requestedAt: TimestampSchema.optional(),
    status: AgentDeletionStatusSchema,
    summary: z.string().min(1).max(400),
  })
  .strict();
export type AgentDeletionDiagnostics = z.infer<
  typeof AgentDeletionDiagnosticsSchema
>;

export const ClientAgentDeletionDiagnosticsRequestSchema = z
  .object({ agentId: IdentifierSchema })
  .strict();
export type ClientAgentDeletionDiagnosticsRequest = z.infer<
  typeof ClientAgentDeletionDiagnosticsRequestSchema
>;

export const ClientAgentDeletionDiagnosticsResponseSchema =
  AgentDeletionDiagnosticsSchema;
export type ClientAgentDeletionDiagnosticsResponse = z.infer<
  typeof ClientAgentDeletionDiagnosticsResponseSchema
>;
