import { z } from "zod";
import { IdentifierSchema } from "./common.ts";

// Raft Computer 1.0.18 system.cleaner contract. No memory-content policy.
export const AgentMemoryCleanerValuesSchema = z
  .object({
    enabled: z.boolean(),
    threshold_bytes: z.number().int().min(4096).max(1073741824),
    interval_ms: z.number().int().min(900000).max(604800000),
  })
  .strict();
export const AgentMemoryCleanerOverridesSchema =
  AgentMemoryCleanerValuesSchema.partial();
export const AgentMemoryCleanerDefaults = Object.freeze({
  enabled: true,
  threshold_bytes: 65536,
  interval_ms: 3600000,
});
export const AgentMemoryConfigPatchSchema = z
  .object({
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 1),
    set: AgentMemoryCleanerOverridesSchema.optional(),
    unset: z
      .array(z.enum(["enabled", "threshold_bytes", "interval_ms"]))
      .max(3)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = Object.keys(value.set ?? {});
    const unset = value.unset ?? [];
    if (
      keys.length + unset.length === 0 ||
      new Set(unset).size !== unset.length ||
      unset.some((key) => keys.includes(key))
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Cleaner mutation requires distinct non-overlapping set/unset keys",
      });
    }
  });
export type AgentMemoryConfigPatch = z.infer<
  typeof AgentMemoryConfigPatchSchema
>;
export const AgentMemoryConfigSnapshotSchema = z
  .object({
    appId: z.literal("system.cleaner"),
    ownerParticipantId: IdentifierSchema,
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    overrides: AgentMemoryCleanerOverridesSchema,
    effective: AgentMemoryCleanerValuesSchema,
  })
  .strict();
export type AgentMemoryConfigSnapshot = z.infer<
  typeof AgentMemoryConfigSnapshotSchema
>;
export const ClientAgentMemoryConfigGetRequestSchema = z
  .object({ agentDefinitionId: IdentifierSchema })
  .strict();
export type ClientAgentMemoryConfigGetRequest = z.infer<
  typeof ClientAgentMemoryConfigGetRequestSchema
>;
export const ClientAgentMemoryConfigPatchRequestSchema = z
  .object({
    agentDefinitionId: IdentifierSchema,
    patch: AgentMemoryConfigPatchSchema,
  })
  .strict();
export type ClientAgentMemoryConfigPatchRequest = z.infer<
  typeof ClientAgentMemoryConfigPatchRequestSchema
>;
export const ClientAgentMemoryConfigResponseSchema = z
  .object({
    computerHostId: IdentifierSchema,
    config: AgentMemoryConfigSnapshotSchema,
  })
  .strict();
export type ClientAgentMemoryConfigResponse = z.infer<
  typeof ClientAgentMemoryConfigResponseSchema
>;
