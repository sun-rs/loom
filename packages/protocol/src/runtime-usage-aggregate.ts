import { z } from "zod";
import { IdentifierSchema, TimestampSchema } from "./common.ts";

const Count = z.number().int().nonnegative();
const NativeId = z.string().trim().min(1).max(512);
const shape = {
  provider: z.string().trim().min(1).max(128),
  kind: z.literal("compaction"),
  nativeSessionId: NativeId,
  entryId: NativeId,
  inputTokens: Count,
  outputTokens: Count,
  cachedInputTokens: Count.nullable(),
  reasoningOutputTokens: Count.nullable(),
  observedAt: TimestampSchema,
} as const;
function bounds(
  value: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number | null;
    reasoningOutputTokens: number | null;
  },
  context: z.RefinementCtx,
) {
  for (const [field, total] of [
    ["cachedInputTokens", "inputTokens"],
    ["reasoningOutputTokens", "outputTokens"],
  ] as const) {
    if (value[field] !== null && value[field] > value[total])
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field} exceeds ${total}`,
      });
  }
}
/** Native aggregate diagnostic, never a generation or HTTP request count.
 * Known successful summary usage does not prove complete capture of retries,
 * aborted requests, or optional dimensions. No totals are estimated.
 */
export const ProviderUsageAggregateFrameSchema = z
  .object({ protocol: z.literal("rah-provider-usage-aggregate/v1"), ...shape })
  .strict()
  .superRefine(bounds);
export type ProviderUsageAggregateFrame = z.infer<
  typeof ProviderUsageAggregateFrameSchema
>;
export const RunAttemptUsageAggregateRecordInputSchema = z
  .object({
    ...shape,
    runAttemptId: IdentifierSchema,
    runtimeRunId: IdentifierSchema,
  })
  .strict()
  .superRefine(bounds);
export type RunAttemptUsageAggregateRecordInput = z.infer<
  typeof RunAttemptUsageAggregateRecordInputSchema
>;
export const RunAttemptUsageAggregateSchema = z
  .object({ ...shape, recordedAt: TimestampSchema })
  .strict()
  .superRefine(bounds);
export type RunAttemptUsageAggregate = z.infer<
  typeof RunAttemptUsageAggregateSchema
>;
export const RUN_ATTEMPT_USAGE_AGGREGATE_LIMIT = 1000;
export const RunAttemptUsageAggregateSummarySchema = z
  .object({
    entries: z
      .array(RunAttemptUsageAggregateSchema)
      .max(RUN_ATTEMPT_USAGE_AGGREGATE_LIMIT),
    totals: z
      .object({
        entries: Count.nullable(),
        inputTokens: Count.nullable(),
        outputTokens: Count.nullable(),
        cachedInputTokens: Count.nullable(),
        reasoningOutputTokens: Count.nullable(),
      })
      .strict(),
    truncated: z.boolean(),
  })
  .strict();
export type RunAttemptUsageAggregateSummary = z.infer<
  typeof RunAttemptUsageAggregateSummarySchema
>;
