import { z } from "zod";

import {
  RunWatchdogSettingsSchema,
  RunWatchdogSettingsUpdateSchema,
  WakeGuardSettingsSchema,
  WakeGuardSettingsUpdateSchema,
} from "./run-watchdog.ts";

/**
 * Human-owned daemon runtime settings (formerly "runtime concurrency"). The
 * concurrency group (contract §3: instances run in parallel, one lane each)
 * has two run caps — all instances on this Host, and the instances of one CLI
 * (RuntimeProfile) — plus the start-rate gate. A change
 * applies to the next scheduling decision; running work is never interrupted.
 * The same document, revision and API also carry the evo §37 groups
 * `wakeGuard` (instance-to-instance wake chain limit) and `watchdog` (run
 * no-progress and duration thresholds), declared in `run-watchdog.ts`.
 */
const RunCapSchema = z.number().int().min(1).max(64);

/**
 * Owner 2026-09-27 (contract §6a): the Host starts a Role instance's warm
 * runtime when the instance is created, and after a daemon start for the
 * instances with a RunAttempt in the last `recentActiveHours` (0: none).
 * Switching it off stops new prewarms; runtimes already started keep the
 * pool's normal idle rules.
 */
export const InstancePrewarmSettingsSchema = z
  .object({
    enabled: z.boolean(),
    recentActiveHours: z.number().int().min(0).max(720),
  })
  .strict();
export type InstancePrewarmSettingsView = z.infer<
  typeof InstancePrewarmSettingsSchema
>;
export const InstancePrewarmSettingsUpdateSchema =
  InstancePrewarmSettingsSchema.partial();
export const INSTANCE_PREWARM_DEFAULTS: InstancePrewarmSettingsView =
  Object.freeze({ enabled: true, recentActiveHours: 24 });

export const RuntimeSettingsReadSchema = z.object({}).strict();
export type RuntimeSettingsRead = z.infer<typeof RuntimeSettingsReadSchema>;

export const RuntimeSettingsUpdateSchema = z
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
    wakeGuard: WakeGuardSettingsUpdateSchema.optional(),
    watchdog: RunWatchdogSettingsUpdateSchema.optional(),
    prewarm: InstancePrewarmSettingsUpdateSchema.optional(),
  })
  .strict();
export type RuntimeSettingsUpdate = z.infer<typeof RuntimeSettingsUpdateSchema>;

export const RuntimeSettingsSchema = z
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
    wakeGuard: WakeGuardSettingsSchema,
    watchdog: RunWatchdogSettingsSchema,
    prewarm: InstancePrewarmSettingsSchema,
  })
  .strict();
export type RuntimeSettings = z.infer<typeof RuntimeSettingsSchema>;
