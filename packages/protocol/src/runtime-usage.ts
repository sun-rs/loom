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

export const RUN_ATTEMPT_USAGE_GENERATION_LIMIT = 1000;

export const ClientRunAttemptUsageGetRequestSchema = z
  .object({ agentId: IdentifierSchema, runAttemptId: IdentifierSchema })
  .strict();
export type ClientRunAttemptUsageGetRequest = z.infer<
  typeof ClientRunAttemptUsageGetRequestSchema
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
  })
  .strict();
export type ClientRunAttemptUsageGetResponse = z.infer<
  typeof ClientRunAttemptUsageGetResponseSchema
>;
