import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";

/**
 * Native per-generation Provider token usage. Diagnostics adjacent to the Room
 * ledger: it never becomes a Room event, trajectory entry or business status.
 *
 * Field semantics are normalized across Providers:
 * - `inputTokens` is the whole prompt of that one generation, including
 *   cached reads and cache writes;
 * - `cachedInputTokens` is the cached-read portion of `inputTokens`;
 * - `outputTokens` is the whole completion, including reasoning;
 * - `reasoningOutputTokens` is the reasoning portion, `null` when the Provider
 *   does not report it separately;
 * - context fields are `null` unless the Provider reports them natively.
 * Values are copied from Provider data only; they are never estimated.
 */
const TokenCountSchema = z.number().int().nonnegative();
const NullableTokenCountSchema = TokenCountSchema.nullable();

const ProviderUsageShape = {
  provider: z.string().trim().min(1).max(128),
  responseId: z.string().trim().min(1).max(512),
  inputTokens: TokenCountSchema,
  cachedInputTokens: TokenCountSchema,
  outputTokens: TokenCountSchema,
  reasoningOutputTokens: NullableTokenCountSchema,
  contextWindow: z.number().int().positive().nullable(),
  contextUsedTokens: NullableTokenCountSchema,
  observedAt: TimestampSchema,
} as const;

type UsageCounts = {
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number | null;
};

function checkUsageBounds(value: UsageCounts, context: z.RefinementCtx) {
  if (value.cachedInputTokens > value.inputTokens) {
    context.addIssue({
      code: "custom",
      message: "cachedInputTokens exceeds inputTokens",
      path: ["cachedInputTokens"],
    });
  }
  if (
    value.reasoningOutputTokens !== null &&
    value.reasoningOutputTokens > value.outputTokens
  ) {
    context.addIssue({
      code: "custom",
      message: "reasoningOutputTokens exceeds outputTokens",
      path: ["reasoningOutputTokens"],
    });
  }
}

/** Host-private fd3 frame emitted by a native driver, once per generation. */
export const ProviderUsageFrameSchema = z
  .object({
    protocol: z.literal("rah-provider-usage/v1"),
    ...ProviderUsageShape,
  })
  .strict()
  .superRefine(checkUsageBounds);
export type ProviderUsageFrame = z.infer<typeof ProviderUsageFrameSchema>;

/**
 * Why a RunAttempt's usage capture is incomplete. A gap never invents a
 * generation; it only marks the observed sums as partial (or, with no rows,
 * the usage as unavailable).
 * - `inconsistent_total`: a cumulative total moved by other than `last`;
 * - `correction_frame`: the Provider revised an already reported total;
 * - `parse_error`: a usage payload could not be proven;
 * - `unsupported_provider`: the runtime exposes no native per-generation usage.
 */
export const ProviderUsageGapReasonSchema = z.enum([
  "inconsistent_total",
  "correction_frame",
  "parse_error",
  "unsupported_provider",
]);
export type ProviderUsageGapReason = z.infer<
  typeof ProviderUsageGapReasonSchema
>;

const ProviderUsageGapShape = {
  provider: z.string().trim().min(1).max(128),
  reason: ProviderUsageGapReasonSchema,
  observedAt: TimestampSchema,
} as const;

/** Host-private fd3 frame: the driver could not capture complete usage. */
export const ProviderUsageGapFrameSchema = z
  .object({
    protocol: z.literal("rah-provider-usage-gap/v1"),
    ...ProviderUsageGapShape,
  })
  .strict();
export type ProviderUsageGapFrame = z.infer<typeof ProviderUsageGapFrameSchema>;

export const RunAttemptUsageGapRecordInputSchema = z
  .object({
    ...ProviderUsageGapShape,
    runAttemptId: IdentifierSchema,
    runtimeRunId: IdentifierSchema,
  })
  .strict();
export type RunAttemptUsageGapRecordInput = z.infer<
  typeof RunAttemptUsageGapRecordInputSchema
>;

export const RunAttemptUsageGapSchema = z
  .object({
    reason: ProviderUsageGapReasonSchema,
    provider: z.string().trim().min(1).max(128),
    occurrences: z.number().int().positive(),
    firstObservedAt: TimestampSchema,
    lastObservedAt: TimestampSchema,
  })
  .strict();
export type RunAttemptUsageGap = z.infer<typeof RunAttemptUsageGapSchema>;

/** The Host's authenticated write, bound to one RunAttempt runtime. */
export const RunAttemptUsageRecordInputSchema = z
  .object({
    ...ProviderUsageShape,
    runAttemptId: IdentifierSchema,
    runtimeRunId: IdentifierSchema,
  })
  .strict()
  .superRefine(checkUsageBounds);
export type RunAttemptUsageRecordInput = z.infer<
  typeof RunAttemptUsageRecordInputSchema
>;

export const RunAttemptUsageGenerationSchema = z
  .object({ ...ProviderUsageShape, recordedAt: TimestampSchema })
  .strict()
  .superRefine(checkUsageBounds);
export type RunAttemptUsageGeneration = z.infer<
  typeof RunAttemptUsageGenerationSchema
>;

export const RunAttemptUsageRecordSchema = z
  .object({
    ...ProviderUsageShape,
    recordedAt: TimestampSchema,
    runAttemptId: IdentifierSchema,
  })
  .strict();
export type RunAttemptUsageRecord = z.infer<typeof RunAttemptUsageRecordSchema>;

/**
 * S2-0 leftover-process cleanup (S2 spec §6a). The Host sweeps processes that
 * carry a dead runtime's `LOOM_RUNTIME_ID` tag (plus their descendants and
 * tagged-led process groups) and records the counts here. Diagnostics next to
 * the ledger: no Room event, Inbox, Task or trajectory effect. Every record
 * names its runtime; the participant is admitted only when no runtime of it
 * is unresolved (processes remaining or unverifiable, a sweep error, a
 * resource-cap alert, or a cleanup marked pending and not yet recorded).
 * `releasedPorts` are ports held by swept processes that are no longer alive
 * (and, when the post-kill check ran, have no listener now); `portsObserved`
 * is false when ports could not be queried (unknown, not empty).
 */
export const RuntimeProcessCleanupTriggerSchema = z.enum([
  "run_end",
  "runtime_crash",
  "run_cancelled",
  "host_start",
  "janitor",
  "resource_cap",
]);
export type RuntimeProcessCleanupTrigger = z.infer<
  typeof RuntimeProcessCleanupTriggerSchema
>;
export const RuntimeResourceCapSchema = z.enum([
  "process_count",
  "rss",
  "listening_ports",
]);
export type RuntimeResourceCap = z.infer<typeof RuntimeResourceCapSchema>;
const PortListSchema = z.array(z.number().int().min(1).max(65_535)).max(256);
const CleanupCountSchema = z.number().int().nonnegative().max(1_000_000);

const RuntimeProcessCleanupShape = {
  cleanupId: IdentifierSchema,
  runAttemptId: IdentifierSchema.optional(),
  runtimeRunId: IdentifierSchema.optional(),
  trigger: RuntimeProcessCleanupTriggerSchema,
  foundCount: CleanupCountSchema,
  killedCount: CleanupCountSchema,
  remainingCount: CleanupCountSchema,
  releasedPorts: PortListSchema,
  remainingPorts: PortListSchema,
  capExceeded: z.array(RuntimeResourceCapSchema).max(3),
  error: z.string().trim().min(1).max(2_000).optional(),
  observedAt: TimestampSchema,
} as const;

/** The Host's authenticated write for one runtime of its participants. */
export const RuntimeProcessCleanupRecordInputSchema = z
  .object({
    ...RuntimeProcessCleanupShape,
    participantId: IdentifierSchema,
    runtimeRunId: IdentifierSchema,
    unknownCount: CleanupCountSchema.default(0),
    portsObserved: z.boolean().default(true),
  })
  .strict();
export type RuntimeProcessCleanupRecordInput = z.input<
  typeof RuntimeProcessCleanupRecordInputSchema
>;

export const RuntimeProcessCleanupSchema = z
  .object({
    ...RuntimeProcessCleanupShape,
    unknownCount: CleanupCountSchema,
    portsObserved: z.boolean(),
    blocking: z.boolean(),
    recordedAt: TimestampSchema,
  })
  .strict();
export type RuntimeProcessCleanup = z.infer<typeof RuntimeProcessCleanupSchema>;

export const RUNTIME_PROCESS_CLEANUP_READ_LIMIT = 32;

export const RUN_ATTEMPT_USAGE_GENERATION_LIMIT = 1000;

export const ClientRunAttemptUsageGetRequestSchema = z
  .object({ agentId: IdentifierSchema, runAttemptId: IdentifierSchema })
  .strict();
export type ClientRunAttemptUsageGetRequest = z.infer<
  typeof ClientRunAttemptUsageGetRequestSchema
>;

/**
 * S2-a measurement hook: how this turn executed. `warm` reused a live
 * instance runtime; `cold` started one (and `sessionResumeMs` is the native
 * session resume duration when the start resumed a session). `lateFrameCount`
 * counts this turn's frames that arrived after it quiesced: they were not
 * recorded, so usage is at most `partial`. `null` for per-turn (legacy) runs.
 */
export const RunAttemptExecutionSchema = z
  .object({
    instanceRuntimeId: IdentifierSchema,
    mode: z.enum(["warm", "cold"]),
    sessionResumeMs: z.number().int().nonnegative().nullable(),
    lateFrameCount: z.number().int().nonnegative(),
  })
  .strict();
export type RunAttemptExecution = z.infer<typeof RunAttemptExecutionSchema>;

/**
 * Final-reply turn end: a `final` Worker post committed in this RunAttempt,
 * and whether the Host's native interrupt landed. `sent` is false until the
 * runtime reports an interrupt it issued (unsupported, failed or lost report:
 * the turn ran on as before). `preemptedFollowUp` is true when no model
 * output or usage was observed after the final post's tool call finished,
 * false when some was, `unknown` when it could not be observed.
 */
export const FinalInterruptPreemptionSchema = z.union([
  z.boolean(),
  z.literal("unknown"),
]);
export const RunAttemptFinalInterruptSchema = z
  .object({
    committedRoomSeq: z.number().int().positive(),
    sent: z.boolean(),
    preemptedFollowUp: FinalInterruptPreemptionSchema,
  })
  .strict();
export type RunAttemptFinalInterrupt = z.infer<
  typeof RunAttemptFinalInterruptSchema
>;
export const RunAttemptFinalInterruptRecordInputSchema = z
  .object({
    runAttemptId: IdentifierSchema,
    sent: z.boolean(),
    preemptedFollowUp: FinalInterruptPreemptionSchema,
  })
  .strict();
export type RunAttemptFinalInterruptRecordInput = z.infer<
  typeof RunAttemptFinalInterruptRecordInputSchema
>;

export const ClientRunAttemptUsageGetResponseSchema = z
  .object({
    runAttemptId: IdentifierSchema,
    /**
     * `complete`: generations recorded and no capture gap; `partial`: some
     * generations recorded but a gap exists, so `totals` are observed sums,
     * not the full cost; `unavailable`: nothing recorded, `totals` unknown.
     */
    completeness: z.enum(["complete", "partial", "unavailable"]),
    gaps: z
      .array(RunAttemptUsageGapSchema)
      .max(ProviderUsageGapReasonSchema.options.length),
    /** Oldest first; bounded. `totals` always cover every generation. */
    generations: z
      .array(RunAttemptUsageGenerationSchema)
      .max(RUN_ATTEMPT_USAGE_GENERATION_LIMIT),
    /** All `null` (unknown, not zero) when completeness is `unavailable`. */
    totals: z
      .object({
        generations: NullableTokenCountSchema,
        inputTokens: NullableTokenCountSchema,
        cachedInputTokens: NullableTokenCountSchema,
        outputTokens: NullableTokenCountSchema,
        /** `null` when any generation lacks a native reasoning count. */
        reasoningOutputTokens: NullableTokenCountSchema,
      })
      .strict(),
    truncated: z.boolean(),
    /** S2-0: leftover-process cleanups recorded for this RunAttempt. */
    processCleanups: z
      .array(RuntimeProcessCleanupSchema)
      .max(RUNTIME_PROCESS_CLEANUP_READ_LIMIT),
    /** S2-a: warm/cold execution evidence; absent before schema 65 readers. */
    execution: RunAttemptExecutionSchema.nullable().optional(),
    /** Final-reply turn end; `null` when no `final` post committed. */
    finalInterrupt: RunAttemptFinalInterruptSchema.nullable().optional(),
  })
  .strict();
export type ClientRunAttemptUsageGetResponse = z.infer<
  typeof ClientRunAttemptUsageGetResponseSchema
>;
