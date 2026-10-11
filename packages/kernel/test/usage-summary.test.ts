import assert from "node:assert/strict";
import test from "node:test";
import { ClientApplicationService } from "../../application-service/src/index.ts";
import { HttpRahClient } from "../../client-sdk/src/index.ts";
import {
  ConflictError,
  KERNEL_SCHEMA_VERSION,
  createHumanApplicationPort,
} from "../src/index.ts";
import {
  roleInstanceFixture,
  startInstanceRun,
  startInstanceRunFromQueue,
  type RoleInstanceFixture,
} from "./role-instance-fixture.ts";

/**
 * evo §40: CLI-reported cost facts per RunAttempt and the Human usage
 * summary by instance / Channel / time window. Fake Host, temporary
 * database; every figure is read back from durable Kernel rows.
 */

type Run = ReturnType<typeof startInstanceRun>;

function usage(run: Run, responseId: string, extra: Record<string, unknown>) {
  return {
    provider: "codex-app-server/v1",
    responseId,
    inputTokens: 1000,
    cachedInputTokens: 600,
    outputTokens: 50,
    reasoningOutputTokens: 10,
    contextWindow: null,
    contextUsedTokens: null,
    observedAt: "2026-09-26T01:00:00.000Z",
    runAttemptId: run.run.runAttemptId,
    runtimeRunId: run.runtime.runtimeRunId,
    ...extra,
  };
}

function cost(run: Run, costId: string, extra: Record<string, unknown>) {
  return {
    provider: "claude-stream-json/v1",
    costId,
    source: "claude_result_total_cost_usd" as const,
    reportedTotalUsd: 0.5,
    costUsd: 0.5,
    observedAt: "2026-09-26T01:00:01.000Z",
    runAttemptId: run.run.runAttemptId,
    runtimeRunId: run.runtime.runtimeRunId,
    ...extra,
  };
}

function setStartedAt(f: RoleInstanceFixture, run: Run, at: string) {
  f.db
    .prepare("UPDATE run_attempts SET started_at=? WHERE run_attempt_id=?")
    .run(at, run.run.runAttemptId);
}

test("schema 73 stores CLI-reported cost facts", () => {
  assert.equal(KERNEL_SCHEMA_VERSION, 85);
});

test("a CLI cost fact is recorded once per cost id and shown on the RunAttempt read", () => {
  const f = roleInstanceFixture();
  try {
    const run = startInstanceRun(f);
    const recorded = f.kernel.runAttemptUsage.recordCost(
      f.host,
      cost(run, "result-1", {}),
    );
    assert.equal(recorded.costUsd, 0.5);
    // Replay of the same fact is idempotent; a different fact conflicts.
    f.kernel.runAttemptUsage.recordCost(f.host, cost(run, "result-1", {}));
    assert.throws(
      () =>
        f.kernel.runAttemptUsage.recordCost(
          f.host,
          cost(run, "result-1", { costUsd: 0.7 }),
        ),
      ConflictError,
    );
    // The first result of a resumed Claude process: raw cumulative only.
    f.kernel.runAttemptUsage.recordCost(
      f.host,
      cost(run, "result-2", { reportedTotalUsd: 1.25, costUsd: null }),
    );
    const read = f.kernel.runAttemptUsage.get(f.actor, {
      agentId: f.agentId,
      runAttemptId: run.run.runAttemptId,
    });
    assert.deepEqual(
      read.cliCosts?.map((entry) => [
        entry.costId,
        entry.source,
        entry.reportedTotalUsd,
        entry.costUsd,
      ]),
      [
        ["result-1", "claude_result_total_cost_usd", 0.5, 0.5],
        ["result-2", "claude_result_total_cost_usd", 1.25, null],
      ],
    );
    run.finish(0);
    assert.throws(
      () => f.kernel.runAttemptUsage.recordCost(f.host, cost(run, "late", {})),
      ConflictError,
      "a finished run accepts no new cost facts",
    );
  } finally {
    f.close();
  }
});

test("usage summary by instance: observed token sums, completeness, gaps and CLI cost coverage", () => {
  const f = roleInstanceFixture();
  try {
    // Run A: Codex, two generations, one capture gap, no cost reported.
    const a = startInstanceRun(f);
    f.kernel.runAttemptUsage.record(f.host, usage(a, "a:1", {}));
    f.kernel.runAttemptUsage.record(
      f.host,
      usage(a, "a:2", { inputTokens: 500, cachedInputTokens: 0 }),
    );
    f.kernel.runAttemptUsage.recordGap(f.host, {
      provider: "codex-app-server/v1",
      reason: "inconsistent_total",
      observedAt: "2026-09-26T01:00:02.000Z",
      runAttemptId: a.run.runAttemptId,
      runtimeRunId: a.runtime.runtimeRunId,
    });
    a.finish(0);
    // Run B: Claude, one generation without reasoning, known + unknown cost.
    const b = startInstanceRun(f);
    f.kernel.runAttemptUsage.record(
      f.host,
      usage(b, "b:1", {
        provider: "claude-stream-json/v1",
        inputTokens: 2000,
        cachedInputTokens: 1500,
        outputTokens: 80,
        reasoningOutputTokens: null,
      }),
    );
    f.kernel.runAttemptUsage.recordCost(f.host, cost(b, "b:r1", {}));
    f.kernel.runAttemptUsage.recordCost(
      f.host,
      cost(b, "b:r0", { reportedTotalUsd: 3, costUsd: null }),
    );
    b.finish(0);
    // Run C: nothing recorded (Kimi without a readable wire, lost frames).
    const c = startInstanceRun(f);
    c.finish(0);
    // Run D: OpenCode per-step costs, one of them reported as 0.
    const d = startInstanceRun(f);
    // Each step's usage and cost share the step-finish part id.
    for (const id of ["prt_1", "prt_2"])
      f.kernel.runAttemptUsage.record(
        f.host,
        usage(d, id, {
          provider: "opencode-server/v1",
          inputTokens: 300,
          cachedInputTokens: 0,
          outputTokens: 30,
          reasoningOutputTokens: 5,
        }),
      );
    for (const [id, usd] of [
      ["prt_1", 0.01],
      ["prt_2", 0],
    ] as const)
      f.kernel.runAttemptUsage.recordCost(
        f.host,
        cost(d, id, {
          provider: "opencode-server/v1",
          source: "opencode_step_finish_cost",
          reportedTotalUsd: null,
          costUsd: usd,
        }),
      );
    d.finish(0);

    const summary = f.kernel.runAttemptUsage.summary(f.actor, {
      groupBy: "instance",
    });
    assert.equal(summary.groups.length, 1);
    const [group] = summary.groups;
    assert.equal(group!.instanceId, f.instance.instanceId);
    assert.equal(group!.channelId, f.home.roomId);
    assert.equal(group!.roleId, f.role.roleId);
    assert.deepEqual(group!.providers, [
      "claude-stream-json/v1",
      "codex-app-server/v1",
      "opencode-server/v1",
    ]);
    assert.deepEqual(group!.runs, {
      total: 4,
      complete: 2,
      partial: 1,
      unavailable: 1,
    });
    assert.deepEqual(group!.tokens, {
      generations: 5,
      inputTokens: 1000 + 500 + 2000 + 300 + 300,
      cachedInputTokens: 600 + 0 + 1500 + 0 + 0,
      outputTokens: 50 + 50 + 80 + 30 + 30,
      reasoningOutputTokens: 10 + 10 + 5 + 5,
      reasoningReportedGenerations: 4,
    });
    assert.deepEqual(group!.gaps, [{ reason: "inconsistent_total", runs: 1 }]);
    const spend = group!.cliEstimatedCost;
    assert.equal(spend.basis, "cli_reported_estimate");
    assert.equal(spend.totalUsd, 0.51);
    // D: every step's usage has its known cost and no gap: complete. B: a
    // record of unknown value: partial.
    assert.deepEqual(
      [spend.runsComplete, spend.runsPartial, spend.runsUnknown],
      [1, 1, 0],
    );
    assert.equal(spend.runsAllRecordsKnown, 1);
    assert.equal(spend.runsUnreported, 2, "Codex run and empty run");
    assert.deepEqual(spend.sources, [
      {
        source: "claude_result_total_cost_usd",
        costUsd: 0.5,
        records: 2,
        unknownRecords: 1,
        zeroRecords: 0,
      },
      {
        source: "opencode_step_finish_cost",
        costUsd: 0.01,
        records: 2,
        unknownRecords: 0,
        zeroRecords: 1,
      },
    ]);
    assert.deepEqual(summary.totals.runs, group!.runs);
    assert.deepEqual(summary.totals.tokens, group!.tokens);
  } finally {
    f.close();
  }
});

/**
 * Review 2026-09-26 P2-1: a run whose received cost records are all known is
 * not a run whose cost was captured completely. A capture gap, a late frame
 * or an OpenCode step whose usage has no cost (by step-finish part id) keeps
 * the run partial; the known subtotal stays, nothing is filled in.
 */
test("cost coverage: known cost records do not make a run complete when its capture has gaps or uncosted steps", () => {
  const f = roleInstanceFixture();
  try {
    const opencode = {
      provider: "opencode-server/v1",
      source: "opencode_step_finish_cost" as const,
      reportedTotalUsd: null,
    };
    const openUsage = {
      provider: "opencode-server/v1",
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 10,
      reasoningOutputTokens: null,
    };
    // Gap run: one step with usage and cost, then a step that did not parse.
    const gap = startInstanceRun(f);
    f.kernel.runAttemptUsage.record(f.host, usage(gap, "prt_g1", openUsage));
    f.kernel.runAttemptUsage.recordGap(f.host, {
      provider: "opencode-server/v1",
      reason: "parse_error",
      observedAt: "2026-09-26T01:00:02.000Z",
      runAttemptId: gap.run.runAttemptId,
      runtimeRunId: gap.runtime.runtimeRunId,
    });
    f.kernel.runAttemptUsage.recordCost(
      f.host,
      cost(gap, "prt_g1", { ...opencode, costUsd: 0.1 }),
    );
    gap.finish(0);
    // Uncosted step: two steps' usage, only one step's cost.
    const uncosted = startInstanceRun(f);
    for (const id of ["prt_u1", "prt_u2"])
      f.kernel.runAttemptUsage.record(f.host, usage(uncosted, id, openUsage));
    f.kernel.runAttemptUsage.recordCost(
      f.host,
      cost(uncosted, "prt_u1", { ...opencode, costUsd: 0.2 }),
    );
    uncosted.finish(0);
    // Claude: a known cumulative increase, but a usage capture gap.
    const claude = startInstanceRun(f);
    f.kernel.runAttemptUsage.record(
      f.host,
      usage(claude, "msg_1", {
        provider: "claude-stream-json/v1",
        reasoningOutputTokens: null,
      }),
    );
    f.kernel.runAttemptUsage.recordGap(f.host, {
      provider: "claude-stream-json/v1",
      reason: "correction_frame",
      observedAt: "2026-09-26T01:00:02.000Z",
      runAttemptId: claude.run.runAttemptId,
      runtimeRunId: claude.runtime.runtimeRunId,
    });
    f.kernel.runAttemptUsage.recordCost(f.host, cost(claude, "result-c", {}));
    claude.finish(0);

    const spend = f.kernel.runAttemptUsage.summary(f.actor, {
      groupBy: "instance",
    }).totals.cliEstimatedCost;
    assert.equal(spend.runsComplete, 0, "no run's cost capture is complete");
    assert.equal(spend.runsPartial, 3);
    assert.equal(spend.runsAllRecordsKnown, 3, "every received record known");
    assert.equal(spend.totalUsd, 0.8, "known subtotal kept, nothing filled in");
  } finally {
    f.close();
  }
});

test("usage summary groups by Channel, filters by window and instance, and never estimates missing data", () => {
  const f = roleInstanceFixture();
  try {
    const second = f.kernel.roles.instantiate(f.actor, {
      roleId: f.role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "second-instance",
    }).instance;
    const early = startInstanceRun(f);
    f.kernel.runAttemptUsage.record(f.host, usage(early, "e:1", {}));
    early.finish(0);
    setStartedAt(f, early, "2026-09-20T00:00:00.000Z");
    const late = startInstanceRun(f);
    f.kernel.runAttemptUsage.record(
      f.host,
      usage(late, "l:1", {
        provider: "claude-stream-json/v1",
        reasoningOutputTokens: null,
      }),
    );
    late.finish(0);
    setStartedAt(f, late, "2026-09-25T00:00:00.000Z");

    const byChannel = f.kernel.runAttemptUsage.summary(f.actor, {
      groupBy: "channel",
    });
    assert.equal(byChannel.groups.length, 1);
    assert.equal(byChannel.groups[0]!.instanceId, null);
    assert.equal(byChannel.groups[0]!.channelId, f.home.roomId);
    assert.equal(byChannel.groups[0]!.runs.total, 2);
    assert.equal(byChannel.groups[0]!.tokens.reasoningOutputTokens, 10);
    assert.equal(byChannel.groups[0]!.tokens.reasoningReportedGenerations, 1);
    assert.equal(
      byChannel.groups[0]!.cliEstimatedCost.totalUsd,
      null,
      "no CLI cost reported: unknown, never 0",
    );
    assert.equal(byChannel.groups[0]!.cliEstimatedCost.runsUnreported, 2);

    const windowed = f.kernel.runAttemptUsage.summary(f.actor, {
      groupBy: "instance",
      from: "2026-09-24T00:00:00.000Z",
      to: "2026-09-26T00:00:00.000Z",
    });
    assert.equal(windowed.from, "2026-09-24T00:00:00.000Z");
    assert.equal(windowed.groups.length, 1);
    assert.equal(windowed.groups[0]!.runs.total, 1);
    assert.equal(
      windowed.groups[0]!.firstRunStartedAt,
      "2026-09-25T00:00:00.000Z",
    );
    assert.equal(windowed.groups[0]!.tokens.reasoningOutputTokens, null);

    // An instance with no runs in scope has no group; filters narrow.
    const none = f.kernel.runAttemptUsage.summary(f.actor, {
      groupBy: "instance",
      instanceId: second.instanceId,
    });
    assert.deepEqual(none.groups, []);
    assert.equal(none.totals.runs.total, 0);
    assert.equal(none.totals.tokens.reasoningOutputTokens, null);
    assert.equal(none.totals.cliEstimatedCost.totalUsd, null);
    assert.throws(
      () =>
        f.kernel.runAttemptUsage.summary(f.actor, {
          groupBy: "instance",
          from: "2026-09-26T00:00:00.000Z",
          to: "2026-09-24T00:00:00.000Z",
        }),
      /from must be before to/,
    );
  } finally {
    f.close();
  }
});

test("usage summary shows only Channels the Human belongs to", () => {
  const f = roleInstanceFixture();
  try {
    const run = startInstanceRun(f);
    f.kernel.runAttemptUsage.record(f.host, usage(run, "v:1", {}));
    run.finish(0);
    const outsider = f.kernel.provisionPrincipal({
      handle: "outsider",
      kind: "human",
    });
    const outsiderActor = f.kernel.authenticateAccessToken(
      outsider.accessToken,
    );
    const hidden = f.kernel.runAttemptUsage.summary(outsiderActor, {
      groupBy: "channel",
      channelId: f.home.roomId,
    });
    assert.deepEqual(hidden.groups, []);
    assert.equal(hidden.totals.runs.total, 0);
  } finally {
    f.close();
  }
});

// Review 2026-09-26 P2-4: Channel membership groups the figures but is not
// the ACL: a run is counted only when the Human can see the room it actually
// executed in, so another Channel member never sees private-box usage.
test("usage summary counts only runs whose executing room the Human can see", () => {
  const f = roleInstanceFixture();
  try {
    f.kernel.postMessage(f.actor, {
      roomId: f.privateBox.roomId,
      body: "private question",
      idempotencyKey: "private-wake",
      recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
    });
    const privateRun = startInstanceRunFromQueue(f);
    f.kernel.runAttemptUsage.record(
      f.host,
      usage(privateRun, "p:1", { inputTokens: 123, cachedInputTokens: 0 }),
    );
    privateRun.finish(0);
    const channelRun = startInstanceRun(f);
    f.kernel.runAttemptUsage.record(
      f.host,
      usage(channelRun, "c:1", { inputTokens: 7, cachedInputTokens: 0 }),
    );
    channelRun.finish(0);
    const colleague = f.kernel.provisionPrincipal({
      handle: "colleague",
      kind: "human",
    });
    f.kernel.addMember(f.actor, {
      principalId: colleague.principal.principalId,
      roomId: f.home.roomId,
    });
    const seen = f.kernel.runAttemptUsage.summary(
      f.kernel.authenticateAccessToken(colleague.accessToken),
      { groupBy: "instance" },
    );
    assert.equal(seen.totals.runs.total, 1, "only the Channel run");
    assert.equal(seen.totals.tokens.inputTokens, 7);
    assert.equal(seen.groups[0]!.channelId, f.home.roomId);
    const own = f.kernel.runAttemptUsage.summary(f.actor, {
      groupBy: "channel",
    });
    assert.equal(own.groups.length, 1, "grouped under the instance's Channel");
    assert.equal(own.groups[0]!.channelId, f.home.roomId);
    assert.equal(own.totals.tokens.inputTokens, 130);
  } finally {
    f.close();
  }
});

test("usage summary is served on the authenticated client route", async () => {
  const f = roleInstanceFixture();
  const service = new ClientApplicationService({
    human: createHumanApplicationPort(f.kernel),
    health: () => {
      throw new Error("health not used by this test");
    },
  });
  try {
    await service.start();
    const run = startInstanceRun(f);
    f.kernel.runAttemptUsage.record(f.host, usage(run, "h:1", {}));
    run.finish(0);
    const client = new HttpRahClient({
      baseUrl: service.origin,
      accessToken: () => f.owner.accessToken,
    });
    const summary = await client.request("usage.summary", {
      groupBy: "instance",
    });
    assert.equal(summary.groups[0]!.instanceId, f.instance.instanceId);
    assert.equal(summary.groups[0]!.tokens.inputTokens, 1000);
    const anonymous = new HttpRahClient({
      baseUrl: service.origin,
      accessToken: () => "not-a-token",
    });
    await assert.rejects(
      anonymous.request("usage.summary", { groupBy: "instance" }),
    );
  } finally {
    await service.close();
    f.close();
  }
});
