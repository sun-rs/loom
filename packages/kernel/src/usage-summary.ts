import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import {
  ProviderCostSourceSchema,
  ProviderUsageGapReasonSchema,
  USAGE_SUMMARY_GROUP_LIMIT,
  UsageSummaryRequestSchema,
  UsageSummaryResponseSchema,
  type ProviderCostSource,
  type ProviderUsageGapReason,
  type UsageSummaryGroup,
  type UsageSummaryRequest,
  type UsageSummaryResponse,
} from "@rah-os/protocol";

import { text, type Row } from "./sqlite-row.ts";

/**
 * evo §40: Role-instance usage for the Human, grouped by instance or by the
 * instance's Channel over RunAttempts started in `[from, to)`. Read only and
 * diagnostic: token figures are sums of recorded Provider generations, a run
 * without any is `unavailable` (never zero), and cost is only what the CLI
 * itself reported (no Loom price table, no estimate). Visibility: runs
 * whose executing room (`run_attempts.room_id`, e.g. a private box) the Human
 * is a member of, of instances in Channels the Human is a member of; the
 * Channel is only the grouping key, never the ACL (review 2026-09-26 P2-4).
 */
export function summarizeUsage(
  database: DatabaseSync,
  actorId: string,
  untrustedInput: UsageSummaryRequest,
): UsageSummaryResponse {
  const input = UsageSummaryRequestSchema.parse(untrustedInput);
  const from =
    input.from === undefined ? null : new Date(input.from).toISOString();
  const to = input.to === undefined ? null : new Date(input.to).toISOString();
  const scope = `WITH scope AS (
      SELECT ra.run_attempt_id, ra.started_at, ri.instance_id, ri.channel_id,
             ri.role_id,
             COALESCE((SELECT MAX(p.late_frame_count) FROM runtime_processes AS p
                        WHERE p.run_attempt_id = ra.run_attempt_id), 0)
               AS late_frame_count
        FROM run_attempts AS ra
        JOIN role_instances AS ri ON ri.instance_id = ra.participant_id
        JOIN memberships AS m
          ON m.room_id = ri.channel_id AND m.principal_id = ?
        JOIN principals AS human
          ON human.principal_id = m.principal_id AND human.kind = 'human'
        JOIN memberships AS seen
          ON seen.room_id = ra.room_id AND seen.principal_id = m.principal_id
       WHERE (? IS NULL OR ri.channel_id = ?)
         AND (? IS NULL OR ri.instance_id = ?)
         AND (? IS NULL OR ra.started_at >= ?)
         AND (? IS NULL OR ra.started_at < ?))`;
  const channelId = input.channelId ?? null;
  const instanceId = input.instanceId ?? null;
  const params: SQLInputValue[] = [
    actorId,
    channelId,
    channelId,
    instanceId,
    instanceId,
    from,
    from,
    to,
    to,
  ];
  const all = (sql: string) =>
    database.prepare(`${scope} ${sql}`).all(...params) as Row[];

  const runs = new Map<string, RunFacts>();
  for (const row of all(
    "SELECT * FROM scope ORDER BY started_at, run_attempt_id",
  ))
    runs.set(text(row, "run_attempt_id"), {
      channelId: text(row, "channel_id"),
      instanceId: text(row, "instance_id"),
      roleId: text(row, "role_id"),
      startedAt: text(row, "started_at"),
      lateFrames: Number(row.late_frame_count) > 0,
      providers: new Set(),
      generations: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      reasoningReported: 0,
      gaps: new Set(),
      costs: [],
      openCodeSteps: new Set(),
    });
  for (const row of all(
    `SELECT u.run_attempt_id, u.provider, COUNT(*) AS generations,
            SUM(u.input_tokens) AS input_tokens,
            SUM(u.cached_input_tokens) AS cached_input_tokens,
            SUM(u.output_tokens) AS output_tokens,
            COALESCE(SUM(u.reasoning_output_tokens), 0) AS reasoning_output_tokens,
            COUNT(u.reasoning_output_tokens) AS reasoning_reported
       FROM run_attempt_usage AS u JOIN scope USING (run_attempt_id)
      GROUP BY u.run_attempt_id, u.provider`,
  )) {
    const run = runs.get(text(row, "run_attempt_id"));
    if (run === undefined) continue;
    run.providers.add(text(row, "provider"));
    run.generations += Number(row.generations);
    run.inputTokens += Number(row.input_tokens);
    run.cachedInputTokens += Number(row.cached_input_tokens);
    run.outputTokens += Number(row.output_tokens);
    run.reasoningOutputTokens += Number(row.reasoning_output_tokens);
    run.reasoningReported += Number(row.reasoning_reported);
  }
  for (const row of all(
    `SELECT g.run_attempt_id, g.reason, g.provider
       FROM run_attempt_usage_gaps AS g JOIN scope USING (run_attempt_id)`,
  )) {
    const run = runs.get(text(row, "run_attempt_id"));
    if (run === undefined) continue;
    run.gaps.add(text(row, "reason") as ProviderUsageGapReason);
    run.providers.add(text(row, "provider"));
  }
  for (const row of all(
    `SELECT c.run_attempt_id, c.provider, c.source, c.cost_id, c.cost_usd
       FROM run_attempt_cli_costs AS c JOIN scope USING (run_attempt_id)`,
  )) {
    const run = runs.get(text(row, "run_attempt_id"));
    if (run === undefined) continue;
    run.providers.add(text(row, "provider"));
    run.costs.push({
      source: text(row, "source") as ProviderCostSource,
      costId: text(row, "cost_id"),
      costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    });
  }
  // OpenCode records usage and cost per step under the same step-finish part
  // id: the step identities of its usage, to prove per-step cost coverage.
  for (const row of all(
    `SELECT u.run_attempt_id, u.response_id
       FROM run_attempt_usage AS u JOIN scope USING (run_attempt_id)
      WHERE u.provider = '${OPENCODE_USAGE_PROVIDER}'`,
  ))
    runs
      .get(text(row, "run_attempt_id"))
      ?.openCodeSteps.add(text(row, "response_id"));

  const groups = new Map<string, RunFacts[]>();
  for (const run of runs.values()) {
    const key =
      input.groupBy === "instance"
        ? `${run.channelId}\0${run.instanceId}`
        : run.channelId;
    const list = groups.get(key) ?? [];
    list.push(run);
    groups.set(key, list);
  }
  const ordered = [...groups.values()].sort((left, right) =>
    groupKey(left[0]!, input.groupBy).localeCompare(
      groupKey(right[0]!, input.groupBy),
    ),
  );
  const rows: UsageSummaryGroup[] = ordered
    .slice(0, USAGE_SUMMARY_GROUP_LIMIT)
    .map((list) => ({
      channelId: list[0]!.channelId,
      instanceId: input.groupBy === "instance" ? list[0]!.instanceId : null,
      roleId:
        input.groupBy === "instance" ||
        list.every((run) => run.roleId === list[0]!.roleId)
          ? list[0]!.roleId
          : null,
      ...figures(list),
    }));
  return UsageSummaryResponseSchema.parse({
    groupBy: input.groupBy,
    from,
    to,
    groups: rows,
    truncated: ordered.length > rows.length,
    totals: figures([...runs.values()]),
  });
}

type RunFacts = {
  channelId: string;
  instanceId: string;
  roleId: string;
  startedAt: string;
  lateFrames: boolean;
  providers: Set<string>;
  generations: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  reasoningReported: number;
  gaps: Set<ProviderUsageGapReason>;
  costs: {
    source: ProviderCostSource;
    costId: string;
    costUsd: number | null;
  }[];
  /** Response ids of the run's OpenCode usage (step-finish part ids). */
  openCodeSteps: Set<string>;
};

const OPENCODE_USAGE_PROVIDER = "opencode-server/v1";

/**
 * Review 2026-09-26 P2-1: whether a run's CLI cost capture is proven
 * complete, not merely whether the records that arrived are known. Any
 * unknown record, usage capture gap or late frame leaves it unproven. OpenCode
 * reports a cost per step: the usage and cost step ids must match exactly.
 * Claude's cost is a cumulative difference per result and cannot be matched
 * per step, so only the record and gap conditions apply to it.
 */
function costCaptureComplete(run: RunFacts): boolean {
  if (run.costs.length === 0) return false;
  if (run.costs.some((entry) => entry.costUsd === null)) return false;
  if (run.gaps.size > 0 || run.lateFrames) return false;
  const stepCosts = new Set(
    run.costs
      .filter((entry) => entry.source === "opencode_step_finish_cost")
      .map((entry) => entry.costId),
  );
  if (stepCosts.size === 0 && run.openCodeSteps.size === 0) return true;
  if (stepCosts.size !== run.openCodeSteps.size) return false;
  for (const step of run.openCodeSteps) if (!stepCosts.has(step)) return false;
  return true;
}

function groupKey(run: RunFacts, groupBy: "instance" | "channel") {
  return groupBy === "instance"
    ? `${run.channelId}\0${run.instanceId}`
    : run.channelId;
}

/** Sums in integer nano-dollars so adding CLI values adds no float drift. */
const USD_SCALE = 1e9;
const toUnits = (usd: number) => Math.round(usd * USD_SCALE);
const fromUnits = (units: number) => units / USD_SCALE;

function figures(runs: RunFacts[]) {
  const providers = new Set<string>();
  const counts = { total: 0, complete: 0, partial: 0, unavailable: 0 };
  const tokens = {
    generations: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    reasoningReportedGenerations: 0,
  };
  const gapRuns = new Map<ProviderUsageGapReason, number>();
  const cost = {
    knownUnits: 0,
    anyKnown: false,
    runsComplete: 0,
    runsPartial: 0,
    runsUnknown: 0,
    runsUnreported: 0,
    runsAllRecordsKnown: 0,
  };
  const sources = new Map<
    ProviderCostSource,
    { units: number; records: number; unknown: number; zero: number }
  >();
  let first: string | null = null;
  let last: string | null = null;
  for (const run of runs) {
    for (const provider of run.providers) providers.add(provider);
    counts.total += 1;
    if (run.generations === 0) counts.unavailable += 1;
    else if (run.gaps.size > 0 || run.lateFrames) counts.partial += 1;
    else counts.complete += 1;
    tokens.generations += run.generations;
    tokens.inputTokens += run.inputTokens;
    tokens.cachedInputTokens += run.cachedInputTokens;
    tokens.outputTokens += run.outputTokens;
    tokens.reasoningOutputTokens += run.reasoningOutputTokens;
    tokens.reasoningReportedGenerations += run.reasoningReported;
    for (const reason of run.gaps)
      gapRuns.set(reason, (gapRuns.get(reason) ?? 0) + 1);
    const known = run.costs.filter((entry) => entry.costUsd !== null).length;
    if (run.costs.length > 0 && known === run.costs.length)
      cost.runsAllRecordsKnown += 1;
    if (run.costs.length === 0) cost.runsUnreported += 1;
    else if (costCaptureComplete(run)) cost.runsComplete += 1;
    else if (known > 0) cost.runsPartial += 1;
    else cost.runsUnknown += 1;
    for (const entry of run.costs) {
      const source = sources.get(entry.source) ?? {
        units: 0,
        records: 0,
        unknown: 0,
        zero: 0,
      };
      source.records += 1;
      if (entry.costUsd === null) source.unknown += 1;
      else {
        cost.anyKnown = true;
        source.units += toUnits(entry.costUsd);
        cost.knownUnits += toUnits(entry.costUsd);
        if (entry.costUsd === 0) source.zero += 1;
      }
      sources.set(entry.source, source);
    }
    if (first === null || run.startedAt < first) first = run.startedAt;
    if (last === null || run.startedAt > last) last = run.startedAt;
  }
  return {
    providers: [...providers].sort(),
    runs: counts,
    tokens: {
      ...tokens,
      reasoningOutputTokens:
        tokens.reasoningReportedGenerations === 0
          ? null
          : tokens.reasoningOutputTokens,
    },
    gaps: ProviderUsageGapReasonSchema.options
      .filter((reason) => gapRuns.has(reason))
      .map((reason) => ({ reason, runs: gapRuns.get(reason)! })),
    cliEstimatedCost: {
      basis: "cli_reported_estimate" as const,
      totalUsd: cost.anyKnown ? fromUnits(cost.knownUnits) : null,
      runsComplete: cost.runsComplete,
      runsPartial: cost.runsPartial,
      runsUnknown: cost.runsUnknown,
      runsUnreported: cost.runsUnreported,
      runsAllRecordsKnown: cost.runsAllRecordsKnown,
      sources: ProviderCostSourceSchema.options
        .filter((source) => sources.has(source))
        .map((source) => {
          const entry = sources.get(source)!;
          return {
            source,
            costUsd: fromUnits(entry.units),
            records: entry.records,
            unknownRecords: entry.unknown,
            zeroRecords: entry.zero,
          };
        }),
    },
    firstRunStartedAt: first,
    lastRunStartedAt: last,
  };
}
