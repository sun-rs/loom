import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";

export const LocalRuntimeInventoryRequestSchema = z.object({}).strict();
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
    displayName: z.string().trim().min(1),
    executable: z.string().trim().min(1),
    failureCode: IdentifierSchema.optional(),
    probeObservedAt: TimestampSchema.optional(),
    resolvedExecutablePath: z.string().trim().min(1).optional(),
    runtimeOfferId: IdentifierSchema.optional(),
    runtimeProfileId: IdentifierSchema.optional(),
    runtimeProfileRevisionId: IdentifierSchema.optional(),
    source: z.enum(["configured", "discovered"]),
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
    restartRequiredToRescan: z.literal(true),
    runtimes: z.array(LocalRuntimeInventoryEntrySchema),
  })
  .strict();
export type LocalRuntimeInventoryResponse = z.infer<
  typeof LocalRuntimeInventoryResponseSchema
>;
