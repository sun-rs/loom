import { z } from "zod";

/**
 * evo §37: the wake-guard and run-watchdog groups of the Human's runtime
 * settings. They live in the same daemon settings document, revision and API
 * as the concurrency caps (`runtime-concurrency-settings.ts`); this module only
 * declares their bounds, defaults and the Host-facing watchdog read.
 */
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const RUN_GUARD_DEFAULTS = Object.freeze({
  wakeGuard: Object.freeze({ instanceChainLimit: 10 }),
  watchdog: Object.freeze({
    maxRunMs: 4 * 60 * MINUTE_MS,
    noProgressWarnMs: 15 * MINUTE_MS,
    queuedStallTerminateMs: 15 * MINUTE_MS,
  }),
});

/**
 * Consecutive instance-to-instance wakes allowed in one Channel since its last
 * Human message; past it no Activation is derived until a Human speaks.
 */
const InstanceChainLimitSchema = z.number().int().min(1).max(1_000);
/** No-progress thresholds: one minute to one day. */
const WatchdogWindowSchema = z.number().int().min(MINUTE_MS).max(DAY_MS);
/** Hard cap on one run's total duration: one minute to seven days. */
const MaxRunSchema = z
  .number()
  .int()
  .min(MINUTE_MS)
  .max(7 * DAY_MS);

export const WakeGuardSettingsSchema = z
  .object({ instanceChainLimit: InstanceChainLimitSchema })
  .strict();
export const RunWatchdogSettingsSchema = z
  .object({
    /** A run without provider progress this long is reported, never killed. */
    noProgressWarnMs: WatchdogWindowSchema,
    /** ...and is terminated with proof when work for its instance is queued. */
    queuedStallTerminateMs: WatchdogWindowSchema,
    /** Total duration cap; at it the run is terminated with proof. */
    maxRunMs: MaxRunSchema,
  })
  .strict();
export type WakeGuardSettings = z.infer<typeof WakeGuardSettingsSchema>;
export type RunWatchdogSettings = z.infer<typeof RunWatchdogSettingsSchema>;

/** Partial updates of each group (only the given fields change). */
export const WakeGuardSettingsUpdateSchema = WakeGuardSettingsSchema.partial();
export const RunWatchdogSettingsUpdateSchema =
  RunWatchdogSettingsSchema.partial();

/**
 * What a Host needs to supervise one leased run: the live watchdog thresholds
 * and whether other work for the same instance is already queued.
 */
export const RunWatchdogContextSchema = RunWatchdogSettingsSchema.extend({
  queuedWorkWaiting: z.boolean(),
}).strict();
export type RunWatchdogContext = z.infer<typeof RunWatchdogContextSchema>;

export const RunWatchdogReadInputSchema = z
  .object({ activationId: z.string().trim().min(1) })
  .strict();
export type RunWatchdogReadInput = z.infer<typeof RunWatchdogReadInputSchema>;

export const RunWatchdogWarningInputSchema = z
  .object({
    runAttemptId: z.string().trim().min(1),
    thresholdMs: z.number().int().positive(),
  })
  .strict();
export type RunWatchdogWarningInput = z.infer<
  typeof RunWatchdogWarningInputSchema
>;
