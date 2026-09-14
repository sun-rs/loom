import { z } from "zod";

import {
  IdentifierSchema,
  TimestampSchema,
  rejectDuplicateStrings,
} from "./common.ts";
import {
  ModelBindingDescriptorSchema,
  ToolAccessModeSchema,
} from "./execution-policy.ts";

export const LocalRuntimeInventoryRequestSchema = z
  .object({ refreshOfferId: z.string().min(1).max(200).optional() })
  .strict();
export type LocalRuntimeInventoryRequest = z.infer<
  typeof LocalRuntimeInventoryRequestSchema
>;

export const LocalRuntimeInventoryEntrySchema = z
  .object({
    agentBindings: z.array(
      z
        .object({
          agentDefinitionId: IdentifierSchema,
          handle: IdentifierSchema,
          participantId: IdentifierSchema,
        })
        .strict(),
    ),
    available: z.boolean(),
    configured: z.boolean(),
    cliId: z.enum(["codex", "kimi", "opencode", "claude"]).optional(),
    displayName: z.string().trim().min(1),
    executable: z.string().trim().min(1),
    failureCode: IdentifierSchema.optional(),
    modelBindingDescriptors: z.array(ModelBindingDescriptorSchema),
    probeObservedAt: TimestampSchema.optional(),
    probeValidatedAt: TimestampSchema.optional(),
    resolvedExecutablePath: z.string().trim().min(1).optional(),
    runtimeOfferId: IdentifierSchema.optional(),
    runtimeProfileId: IdentifierSchema.optional(),
    runtimeProfileRevisionId: IdentifierSchema.optional(),
    source: z.enum(["configured", "discovered"]),
    supportedToolAccessModes: z
      .array(ToolAccessModeSchema)
      .min(1)
      .superRefine(rejectDuplicateStrings)
      .optional(),
    version: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.configured && entry.runtimeProfileId === undefined) {
      context.addIssue({
        code: "custom",
        message: "configured runtimes require runtimeProfileId",
        path: ["runtimeProfileId"],
      });
    }
    if (entry.available && entry.resolvedExecutablePath === undefined) {
      context.addIssue({
        code: "custom",
        message: "available runtimes require resolvedExecutablePath",
        path: ["resolvedExecutablePath"],
      });
    }
  });
export type LocalRuntimeInventoryEntry = z.infer<
  typeof LocalRuntimeInventoryEntrySchema
>;

export const LocalRuntimeInventoryResponseSchema = z
  .object({
    hostId: IdentifierSchema,
    computer: z
      .object({
        createdAt: TimestampSchema.optional(),
        description: z.string().max(500).nullable().optional(),
        displayName: z.string().min(1),
        hostname: z.string().min(1),
        os: z.string().min(1),
        status: z.enum(["online", "draining", "offline", "unknown"]),
        observedAt: TimestampSchema,
        lastSeenAt: TimestampSchema.optional(),
        instanceId: IdentifierSchema.optional(),
        profileRevision: z.number().int().nonnegative().optional(),
        profileUpdatedAt: TimestampSchema.optional(),
        buildVersion: z.string().optional(),
        staleAfterMs: z.number().int().positive(),
      })
      .strict()
      .optional(),
    restartRequiredToRescan: z.literal(true),
    runtimes: z.array(LocalRuntimeInventoryEntrySchema),
  })
  .strict();
export type LocalRuntimeInventoryResponse = z.infer<
  typeof LocalRuntimeInventoryResponseSchema
>;
export type LocalComputerObservation = NonNullable<
  LocalRuntimeInventoryResponse["computer"]
>;
