import { isEffectiveAnswer, summarizeGenerations } from "./metrics.mjs";
import { mergeRoundProductUsage, roundRunVerdict } from "./round-retry.mjs";
import {
  runSucceeded,
  replyTurnHandle,
  warmExecutionFailures,
} from "./warm.mjs";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { readFileSync, globSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { agentExecutionWorkspacePath } from "../../packages/agent-host/src/agent-execution-workspace.ts";
import { RoomKernel } from "@rah-os/kernel";
import { instructions, wait, measure } from "./common.mjs";
import { prepareGateDaemon } from "./gate-daemon.mjs";
import { claudeTranscriptRound } from "./claude-usage.mjs";
import { assertClaudeTranscriptModel } from "./native-claude.mjs";
import { measureKimiWire } from "./native-kimi.mjs";
import {
  assertOpenCodeAssistants,
  readOpenCodeRound,
} from "./drift-opencode-guard.mjs";
import { readOpenCodeToolCalls } from "./opencode-usage.mjs";
import { readClaudeTranscriptWithSubagents } from "./provider-files.mjs";
// config: parseEfficiencyEnv() result (required: the approval table admitted
// its model/effort before any paid call).
export async function rahArm({
  kind,
  root,
  cwd,
  questions,
  arm,
  save,
  config,
}) {
  assert.ok(config?.provider && config.model, "rahArm needs the gate config");
  const { provider, model, effort, bindingId } = config;
  const workspaceFiles = [
    config.instructionFile,
    "scripts/workbench-launch-receipt.mjs",
    "scripts/workbench-launch-receipt.test.mjs",
  ];
  // role-warm: the S2-a warm Codex / S2-c1 warm Claude / S2-c3 warm OpenCode
  // runtime (Codex and OpenCode are warm by default in the product, Claude
  // is opt-in); the per-turn arms switch warm runtimes off explicitly.
  // Its daemon restart before round 3 is skipped unless
  // RAH_EFFICIENCY_WARM_RESTART=1, which instead expects a measured cold
  // resume at round 3; the per-turn arms keep the restart.
  const warm = kind === "role-warm";
  const gate = await prepareGateDaemon({
    provider,
    model,
    effort,
    root,
    cwd,
    warm,
    processes: arm.processes,
    save,
    consumerId: "efficiency-gate",
  });
  const { spec, prepared, stateDirectory, post, head } = gate;
  // OpenCode: the compaction options the guarded serve was given (evidence).
  if (gate.compactionOptions) arm.compactionOptions = gate.compactionOptions;
  // Every instance runtime of the participant owning `instanceRuntimeId`
  // (read-only; no secrets, handles or paths).
  const runtimeRows = (instanceRuntimeId) => {
    const db = new DatabaseSync(join(stateDirectory, "room.db"), {
      readOnly: true,
    });
    try {
      return db
        .prepare(
          `SELECT instance_runtime_id, pid, native_session_id, session_resume_ms,
                  state, turn_count, terminated_reason, started_at
             FROM instance_runtimes
            WHERE participant_id = (SELECT participant_id FROM instance_runtimes
                                     WHERE instance_runtime_id = ?)
            ORDER BY started_at`,
        )
        .all(instanceRuntimeId)
        .map((row) => ({ ...row }));
    } finally {
      db.close();
    }
  };
  const restartBeforeRound =
    warm && process.env.RAH_EFFICIENCY_WARM_RESTART !== "1" ? undefined : 3;
  Object.assign(arm, { warmRuntimes: warm, restartBeforeRound });
  let observer, participantId, agentId, roomId, actor;
  let sessionId;
  const start = gate.start;
  async function stop() {
    const status = await gate.stop();
    if (status !== undefined) assert.equal(status.code, 0);
  }
  try {
    await start();
    observer = new RoomKernel({
      databasePath: join(stateDirectory, "room.db"),
    });
    observer.initialize();
    actor = observer.authenticateHumanAccessToken(prepared.humanAccessToken);
    const inv = await post("/v1/local/runtimes/list", {});
    const runtime = inv.runtimes.find(
      (r) => r.runtimeProfileId === spec.runtimeProfileId,
    );
    assert.ok(runtime?.runtimeOfferId);
    await wait(
      () => observer.runtimeOfferIsCurrentlyAvailable(runtime.runtimeOfferId),
      60000,
    );
    const binding = runtime.modelBindingDescriptors.find(
      (b) => b.modelBindingId === bindingId,
    );
    assert.equal(binding?.modelId, model);
    if (effort === null)
      assert.deepEqual(
        binding.supportedReasoning,
        [],
        "Effortless binding offers effort levels",
      );
    else assert.ok(binding.supportedReasoning.includes(effort));
    arm.binding = bindingId;
    const control = prepared.metadata.controlRoomId;
    const mount = prepared.config.workspace.workspaceMountRevisionId;
    const configuration = {
      displayName: "Efficiency Reviewer",
      handle: "efficiency-reviewer",
      instructions,
      role: "Bounded code reviewer",
      executionWorkspace: {
        kind: "existing_mount",
        workspaceMountRevisionId: mount,
      },
      runtimeOfferId: runtime.runtimeOfferId,
      modelIntent: {
        exactBindingIds: [bindingId],
        fallback: "disabled",
        reasoning: spec.reasoning,
        serviceTier: "default",
      },
      toolAccessMode: "full_access",
    };
    roomId = (
      await post("/v3/client/rooms/create", {
        workspaceId: prepared.metadata.workspaceId,
        basedOnControlRoomSeq: await head(control),
        kind: "channel",
        name: "Isolated efficiency gate",
        slug: "efficiency",
        idempotencyKey: randomUUID(),
      })
    ).room.roomId;
    if (kind === "role" || warm) {
      const role = (
        await post("/v3/client/roles/create", {
          controlRoomId: control,
          basedOnRoomSeq: await head(control),
          idempotencyKey: randomUUID(),
          configuration,
        })
      ).role;
      const created = await post("/v3/client/roles/instantiate", {
        roleId: role.roleId,
        channelId: roomId,
        basedOnRoomSeq: await head(roomId),
        idempotencyKey: randomUUID(),
      });
      participantId = created.instance.instanceId;
      agentId = created.agent.definition.agentId;
    } else {
      const agent = (
        await post("/v3/client/agents/list", { controlRoomId: control })
      ).agents.find((a) => a.handle === spec.agentHandle);
      assert.ok(agent);
      await post("/v3/client/agents/manage", {
        ...configuration,
        action: "configure",
        agentId: agent.definition.agentId,
        basedOnRoomSeq: await head(control),
        idempotencyKey: randomUUID(),
      });
      participantId = agent.definition.participantId;
      agentId = agent.definition.agentId;
      const actualCwd = agentExecutionWorkspacePath(
        join(stateDirectory, "agent-workspaces"),
        participantId,
      );
      mkdirSync(join(actualCwd, "scripts"), { recursive: true });
      for (const file of workspaceFiles)
        copyFileSync(join(cwd, file), join(actualCwd, file));
      arm.actualCwd = actualCwd;

      await post("/v3/client/rooms/members/add", {
        roomId,
        basedOnRoomSeq: await head(roomId),
        principalId: participantId,
        role: "member",
        idempotencyKey: randomUUID(),
      });
    }
    Object.assign(arm, { participantId, roomId });
    save();
    for (let i = 0; i < questions.length; i++) {
      if (i + 1 === restartBeforeRound) {
        await stop();
        await start();
      }
      const old = new Set(
        observer
          .listMessages(actor, { roomId })
          .messages.map((m) => m.messageId),
      );
      const oldRuns = new Set(
        observer.listRunAttempts({ roomId }).map((r) => r.runAttemptId),
      );
      const round = { round: i + 1, startedAt: new Date().toISOString() };
      arm.rounds.push(round);
      save();
      await post("/v3/client/messages/post", {
        roomId,
        basedOnRoomSeq: await head(roomId),
        body: questions[i],
        idempotencyKey: randomUUID(),
        recipients: [],
      });
      console.log(`${kind} round ${i + 1} sent`);
      await wait(() => {
        const acts = observer.listActivations({ roomId });
        assert.ok(
          acts.every((a) => a.state !== "quarantined"),
          "Activation quarantined",
        );
        round.replies = observer
          .listMessages(actor, { roomId })
          .messages.filter(
            (m) => m.actorId === participantId && !old.has(m.messageId),
          );
        return (
          round.replies.length && acts.every((a) => a.state === "completed")
        );
      });
      round.finishedAt = new Date().toISOString();
      round.firstMessageSeconds =
        (Date.parse(round.replies[0].createdAt) - Date.parse(round.startedAt)) /
        1000;
      const effective = round.replies.find((m) => isEffectiveAnswer(m.body));
      round.replySeconds = effective
        ? (Date.parse(effective.createdAt) - Date.parse(round.startedAt)) / 1000
        : null;
      round.runs = observer
        .listRunAttempts({ roomId })
        .filter((r) => !oldRuns.has(r.runAttemptId))
        .sort((a, b) => a.attemptNumber - b.attemptNumber)
        .map((r) => ({
          runAttemptId: r.runAttemptId,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          state: r.state,
          exitCode: r.exitCode,
        }));
      // Product-recorded usage of every attempt; compareRounds requires it
      // complete and cross-checks it against the transcript-derived usage.
      const usages = [];
      for (const run of round.runs)
        usages.push(
          await post("/v3/client/agents/run-usage/get", {
            agentId,
            runAttemptId: run.runAttemptId,
          }),
        );
      for (const [index, run] of round.runs.entries())
        run.succeeded = runSucceeded(run, usages[index].execution ?? null);
      // A Kernel retry within the round is a counted soft item only when
      // the round still ends with exactly one on-target final reply and a
      // completed ACK (round-retry.mjs); anything else fails the arm.
      const verdict = roundRunVerdict({
        runs: round.runs,
        replies: round.replies,
        activations: observer.listActivations({ roomId }),
        finalInterrupts: usages.map((u) => u.finalInterrupt),
        roomId,
      });
      round.attempts = verdict.attempts;
      if (verdict.retried) round.retried = true;
      round.runVerdict = verdict.failures;
      save();
      assert.deepEqual(verdict.failures, [], "Round run verdict");
      const productUsage = mergeRoundProductUsage(usages);
      // S2-a execution record: null for per-turn runs.
      round.execution = productUsage.execution ?? null;
      // S2-b: measured native session resume, per-turn runs included.
      round.sessionResumeMs = productUsage.sessionResumeMs ?? null;
      save();
      round.queueSeconds =
        (Date.parse(round.runs[0].startedAt) - Date.parse(round.startedAt)) /
        1000;
      const records = globSync(
        join(stateDirectory, "supervisors/provider-sessions/*.json"),
      )
        .map((p) => JSON.parse(readFileSync(p)))
        .filter((s) => s.participantId === participantId);
      // Warm turns: the instance runtime's native thread is authoritative;
      // a provider-session record, when present, must agree with it.
      const runtimeThread = round.execution
        ? runtimeRows(round.execution.instanceRuntimeId).find(
            (r) => r.instance_runtime_id === round.execution.instanceRuntimeId,
          )?.native_session_id
        : undefined;
      if (!round.execution) assert.equal(records.length, 1);
      else
        assert.ok(
          records.length <= 1 && (runtimeThread || records.length),
          "Warm turn has no native thread evidence",
        );
      const current = runtimeThread ?? records[0].providerSessionId;
      if (runtimeThread && records.length)
        assert.equal(records[0].providerSessionId, runtimeThread);
      if (sessionId) assert.equal(current, sessionId, "Session changed");
      sessionId = current;
      round.sessionId = sessionId;
      round.metrics = measureRah({
        config,
        sessionId,
        round,
        replyAt: effective?.createdAt ?? null,
        productUsage,
      });
      // Before-reply work-path split (metrics.mjs workPathOf, owner A).
      round.metrics.replyAt = effective?.createdAt ?? null;
      if (round.retried) {
        round.metrics.retried = true;
        round.metrics.attempts = round.attempts;
      }
      round.replyTurnHandle = replyTurnHandle(round.metrics.toolCalls);
      round.metrics.productUsage = {
        completeness: productUsage.completeness,
        gaps: productUsage.gaps,
        totals: productUsage.totals,
      };
      // Final-reply turn end: null when no `final` post committed.
      round.metrics.finalInterrupt = productUsage.finalInterrupt ?? null;
      round.answer = round.replies.map((m) => m.body).join("\n");
      delete round.replies;
      save();
      assert.ok(
        effective,
        "No effective Room answer; progress is not completion",
      );
      for (const p of observer.listPlacements({ roomId })) {
        assert.equal(p.resolvedModel.modelId, model);
        assert.equal(p.resolvedModel.reasoning, effort ?? undefined);
      }
      // A guard that saw another model after forwarding fails the arm.
      gate.assertNoGuardViolations();
      assert.deepEqual(observer.listTasks(actor, { roomId }), []);
      save();
      console.log(`${kind} round ${i + 1}: ${round.replySeconds}s`);
    }
    if (arm.actualCwd)
      for (const file of workspaceFiles)
        assert.deepEqual(
          readFileSync(join(arm.actualCwd, file)),
          readFileSync(join(cwd, file)),
          "Actual workspace changed",
        );
    if (warm) {
      const first = arm.rounds[0].execution?.instanceRuntimeId;
      arm.instanceRuntimes = first ? runtimeRows(first) : [];
      arm.warmFailures = warmExecutionFailures(arm.rounds, {
        restartBeforeRound,
        runtimeCount: arm.instanceRuntimes.length,
      });
      save();
      assert.deepEqual(arm.warmFailures, [], "Warm execution contract");
    }
    arm.status = "complete";
  } finally {
    await stop();
    observer?.close();
    save();
  }
}

// Per-provider RAH round metrics (same shape as common.mjs `measure`):
// - codex: the rollout transcript (cross-checked against product usage);
// - claude: the product-recorded generations (the same stream tracker as the
//   native arm), cross-checked against the session transcript (sub-agent
//   files included), which also proves the model family and effort;
// - opencode: the product-recorded generations (the same step-finish
//   accounting as the native arm); the CLI database proves model and variant;
// - kimi: the session wire (the product records no Kimi usage).
function measureRah({ config, sessionId, round, replyAt, productUsage }) {
  if (config.provider === "codex")
    return measure(sessionId, round, { replyAt }, config, {
      turns: round.runs.length,
    });
  if (config.provider === "kimi")
    return measureKimiWire(sessionId, round, config, { replyAt });
  const records = productUsage.generations ?? [];
  const usable =
    productUsage.completeness === "complete" &&
    !productUsage.truncated &&
    records.length > 0;
  if (config.provider === "opencode") {
    const from = Date.parse(round.startedAt);
    const to = Date.parse(round.finishedAt);
    const stored = assertOpenCodeAssistants(
      readOpenCodeRound(sessionId, from, to),
      config,
    );
    assert.ok(stored.assistants > 0, "No stored OpenCode model evidence");
    round.openCodeAssistants = stored.assistants;
    const toolCalls = readOpenCodeToolCalls(sessionId, from, to);
    // Product usage incomplete: no substitute token source, so the round
    // carries no token counts and the comparison fails usageEvidenceMissing.
    if (!usable)
      return {
        replySeconds: round.replySeconds,
        toolCalls,
        usageSource: "unavailable",
      };
    return {
      ...summarizeGenerations(records, { replyAt }),
      replySeconds: round.replySeconds,
      toolCalls,
      usageSource: "product",
    };
  }
  const transcript = claudeTranscriptRound(
    readClaudeTranscriptWithSubagents(sessionId),
    {
      from: round.startedAt,
      to: round.finishedAt,
    },
  );
  assert.ok(
    assertClaudeTranscriptModel(transcript, config) > 0,
    "No transcript model evidence",
  );
  return {
    // Product usage incomplete: report the transcript view, still failing
    // the comparison as usageEvidenceMissing.
    ...summarizeGenerations(usable ? records : transcript.generations, {
      replyAt,
    }),
    replySeconds: round.replySeconds,
    toolCalls: transcript.toolCalls,
    transcriptUsage: {
      generations: transcript.totals.generations,
      inputTokens: transcript.totals.inputTokens,
      cachedInputTokens: transcript.totals.cachedInputTokens,
    },
    usageSource: usable ? "product" : "transcript",
  };
}
