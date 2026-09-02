import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";

export const LocalComputerProfileSchema = z
  .object({
    description: z.string().trim().max(500).nullable(),
    displayName: z.string().trim().min(1).max(120),
    hostId: IdentifierSchema,
    revision: z.number().int().nonnegative(),
    updatedAt: TimestampSchema,
  })
  .strict();
export type LocalComputerProfile = z.infer<typeof LocalComputerProfileSchema>;

export const ClientComputerProfileUpdateRequestSchema = z
  .object({
    description: z.string().trim().max(500).nullable(),
    displayName: z.string().trim().min(1).max(120),
    expectedRevision: z.number().int().nonnegative(),
    hostId: IdentifierSchema,
    idempotencyKey: IdentifierSchema,
  })
  .strict();
export type ClientComputerProfileUpdateRequest = z.infer<
  typeof ClientComputerProfileUpdateRequestSchema
>;

export const ClientComputerProfileUpdateResponseSchema = z
  .object({
    computer: LocalComputerProfileSchema,
    deduplicated: z.boolean(),
  })
  .strict();
export type ClientComputerProfileUpdateResponse = z.infer<
  typeof ClientComputerProfileUpdateResponseSchema
>;
