import { z } from "zod";

/**
 * Human-owned daemon concurrency settings (contract §3: instances run in
 * parallel, one lane each). Two run caps — all instances on this Host, and the
 * instances of one CLI (RuntimeProfile) — plus the start-rate gate. A change
 * applies to the next scheduling decision; running work is never interrupted.
 */
const RunCapSchema = z.number().int().min(1).max(64);

export const RuntimeConcurrencyReadSchema = z.object({}).strict();
export type RuntimeConcurrencyRead = z.infer<
  typeof RuntimeConcurrencyReadSchema
>;

export const RuntimeConcurrencyUpdateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    maxConcurrentRuns: RunCapSchema.optional(),
    maxConcurrentStarts: z.number().int().min(1).max(64).optional(),
    minStartIntervalMs: z.number().int().min(0).max(60_000).optional(),
    runtimes: z
      .array(
        z
          .object({
            maxConcurrentRuns: RunCapSchema,
            runtimeProfileId: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(64)
      .optional(),
  })
  .strict();
export type RuntimeConcurrencyUpdate = z.infer<
  typeof RuntimeConcurrencyUpdateSchema
>;

export const RuntimeConcurrencySettingsSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    maxConcurrentRuns: RunCapSchema,
    maxConcurrentStarts: z.number().int().min(1),
    minStartIntervalMs: z.number().int().min(0),
    runtimes: z.array(
      z
        .object({
          maxConcurrentRuns: RunCapSchema,
          /** The offer's advertised ceiling; a larger cap cannot take effect. */
          offerMaxConcurrent: z.number().int().positive(),
          runtimeOfferId: z.string().min(1),
          runtimeProfileId: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();
export type RuntimeConcurrencySettings = z.infer<
  typeof RuntimeConcurrencySettingsSchema
>;
