import { z } from "zod";

import { IdentifierSchema, TimestampSchema } from "./common.ts";
import {
  ProviderCostSourceSchema,
  ProviderUsageGapReasonSchema,
} from "./runtime-usage.ts";

export const USAGE_SUMMARY_GROUP_LIMIT = 500;

/**
 * Human read (evo §40): Role-instance usage grouped by instance or by the
 * instance's Channel, over RunAttempts that started in `[from, to)`. Only
 * Channels the Human is a member of are visible. Diagnostics only.
 */
export const UsageSummaryRequestSchema = z
  .object({
    groupBy: z.enum(["instance", "channel"]),
    channelId: IdentifierSchema.optional(),
    instanceId: IdentifierSchema.optional(),
    from: TimestampSchema.optional(),
    to: TimestampSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.from === undefined ||
      value.to === undefined ||
      Date.parse(value.from) < Date.parse(value.to),
    { message: "from must be before to", path: ["to"] },
  );
export type UsageSummaryRequest = z.infer<typeof UsageSummaryRequestSchema>;

const CountSchema = z.number().int().nonnegative();
const UsdSchema = z.number().finite().nonnegative().max(1_000_000);

/**
 * Observed sums over recorded generations only; RunAttempts without usage
 * are counted in `runs.unavailable`, never as zero-cost runs.
 */
const UsageSummaryTokensSchema = z
  .object({
    generations: CountSchema,
    inputTokens: CountSchema,
    cachedInputTokens: CountSchema,
    outputTokens: CountSchema,
    /** Sum over generations that report reasoning; `null` when none do. */
    reasoningOutputTokens: CountSchema.nullable(),
    reasoningReportedGenerations: CountSchema,
  })
  .strict();

const UsageSummaryCostSourceSchema = z
  .object({
    source: ProviderCostSourceSchema,
    /** Sum of the known `costUsd` values of this source. */
    costUsd: UsdSchema,
    records: CountSchema,
    /** Records whose cost could not be attributed (`costUsd` null). */
    unknownRecords: CountSchema,
    /** Records the CLI reported as exactly 0. */
    zeroRecords: CountSchema,
  })
  .strict();

const UsageSummaryCostSchema = z
  .object({
    /** Always the CLI's own estimate, never a Loom calculation. */
    basis: z.literal("cli_reported_estimate"),
    /** Sum of known values; `null` when no RunAttempt has a known value. */
    totalUsd: UsdSchema.nullable(),
    /**
     * The run's cost capture is proven complete: every received record has a
     * known value, the run has no usage capture gap or late frame, and (for
     * OpenCode's per-step costs) every step with recorded usage has a cost
     * record with the same step-finish part id and vice versa. Claude's
     * cumulative-difference costs cannot be matched per step; for them only
     * the record and gap conditions apply.
     */
    runsComplete: CountSchema,
    /**
     * Some value known but completeness not proven (an unknown record, a
     * capture gap, a late frame or an uncosted step): `totalUsd` may
     * undercount these runs; the missing amount is unknown, never filled in.
     */
    runsPartial: CountSchema,
    /** Records exist but none could be attributed. */
    runsUnknown: CountSchema,
    /**
     * Runs whose received cost records all carry a known value (attribution
     * of what arrived), whether or not the capture was complete: a superset of
     * `runsComplete`, never a coverage figure by itself.
     */
    runsAllRecordsKnown: CountSchema,
    /** The CLI reported no cost at all (Codex, Kimi, or no result). */
    runsUnreported: CountSchema,
    sources: z
      .array(UsageSummaryCostSourceSchema)
      .max(ProviderCostSourceSchema.options.length),
  })
  .strict();

const UsageSummaryFigureShape = {
  providers: z.array(z.string().min(1).max(128)).max(64),
  runs: z
    .object({
      total: CountSchema,
      complete: CountSchema,
      partial: CountSchema,
      unavailable: CountSchema,
    })
    .strict(),
  tokens: UsageSummaryTokensSchema,
  gaps: z
    .array(
      z
        .object({ reason: ProviderUsageGapReasonSchema, runs: CountSchema })
        .strict(),
    )
    .max(ProviderUsageGapReasonSchema.options.length),
  cliEstimatedCost: UsageSummaryCostSchema,
  firstRunStartedAt: TimestampSchema.nullable(),
  lastRunStartedAt: TimestampSchema.nullable(),
} as const;

export const UsageSummaryGroupSchema = z
  .object({
    channelId: IdentifierSchema,
    /** `null` when grouped by Channel. */
    instanceId: IdentifierSchema.nullable(),
    roleId: IdentifierSchema.nullable(),
    ...UsageSummaryFigureShape,
  })
  .strict();
export type UsageSummaryGroup = z.infer<typeof UsageSummaryGroupSchema>;

export const UsageSummaryResponseSchema = z
  .object({
    groupBy: z.enum(["instance", "channel"]),
    from: TimestampSchema.nullable(),
    to: TimestampSchema.nullable(),
    groups: z.array(UsageSummaryGroupSchema).max(USAGE_SUMMARY_GROUP_LIMIT),
    /** More groups matched than returned. */
    truncated: z.boolean(),
    totals: z.object(UsageSummaryFigureShape).strict(),
  })
  .strict();
export type UsageSummaryResponse = z.infer<typeof UsageSummaryResponseSchema>;
