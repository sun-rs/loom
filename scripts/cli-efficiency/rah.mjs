import { isEffectiveAnswer, summarizeGenerations } from "./metrics.mjs";
import {
  runSucceeded,
  replyTurnHandle,
  warmExecutionFailures,
} from "./warm.mjs";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  writeFileSync,
  readFileSync,
  globSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { agentExecutionWorkspacePath } from "../../packages/agent-host/src/agent-execution-workspace.ts";
import { RoomKernel } from "@rah-os/kernel";
import {
  localCliRuntimeSpec,
  prepareLocalWorkbench,
} from "../../packages/daemon/src/index.ts";
import {
  model as codexModel,
  effort as codexEffort,
  instructions,
  wait,
  measure,
} from "./common.mjs";
import { writeGuardedShim } from "./guarded-shim.mjs";
import { claudeTranscriptRound } from "./claude-usage.mjs";
import { assertClaudeTranscriptModel } from "./native-claude.mjs";
import { measureKimiWire } from "./native-kimi.mjs";
import { readClaudeTranscript } from "./provider-files.mjs";
const CODEX = {
  provider: "codex",
  model: codexModel,
  effort: codexEffort,
  bindingId: `local:codex-cli/v1:${codexModel}`,
  instructionFile: "AGENTS.md",
};
// config: parseEfficiencyEnv() result (default: the historical Codex arm).
export async function rahArm({
  kind,
  root,
  cwd,
  questions,
  arm,
  save,
  config = CODEX,
}) {
  const { provider, model, effort, bindingId } = config;
  const workspaceFiles = [
    config.instructionFile,
    "scripts/workbench-launch-receipt.mjs",
    "scripts/workbench-launch-receipt.test.mjs",
  ];
  const stateDirectory = join(root, "state");
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
  const realCli = execFileSync("which", [provider], {
    encoding: "utf8",
  }).trim();
  const shim = writeGuardedShim({
    provider,
    path: join(root, `guarded-${provider}.mjs`),
    realCli,
    model,
    effort,
  });
  const spec = {
    ...localCliRuntimeSpec(provider, cwd),
    reasoning: effort,
    executable: shim,
  };
  const prepared = await prepareLocalWorkbench({
    runtimeSpecs: [spec],
    stateDirectory,
    workspaceCwd: cwd,
  });
  // role-warm: the S2-a warm Codex / S2-c1 warm Claude runtime (off by
  // default in the product).
  // Its daemon restart before round 3 is skipped unless
  // RAH_EFFICIENCY_WARM_RESTART=1, which instead expects a measured cold
  // resume at round 3; the per-turn arms keep the restart.
  const warm = kind === "role-warm";
  const daemonConfig = warm
    ? { ...prepared.config, warmRuntimes: { [provider]: { enabled: true } } }
    : prepared.config;
  const restartBeforeRound =
    warm && process.env.RAH_EFFICIENCY_WARM_RESTART !== "1" ? undefined : 3;
  Object.assign(arm, { warmRuntimes: warm, restartBeforeRound });
  const configPath = join(root, "config.json");
  writeFileSync(configPath, JSON.stringify(daemonConfig), { mode: 0o600 });
  let child, exit, origin, observer, participantId, agentId, roomId, actor;
  let sessionId;
  async function start() {
    let out = "";
    child = spawn(
      process.execPath,
      [new URL("./daemon.mjs", import.meta.url).pathname, configPath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    exit = new Promise((r) =>
      child.once("close", (code, signal) => r({ code, signal })),
    );
    child.stdout.on("data", (b) => {
      out = (out + b).slice(-10000);
      const m = out.match(/GATE_READY (.*)\n/);
      if (m) origin = JSON.parse(m[1]).origin;
    });
    child.stderr.on("data", (b) =>
      writeFileSync(join(root, "daemon.log"), b, { flag: "a", mode: 0o600 }),
    );
    await wait(() => {
      assert.equal(child.exitCode, null, "Daemon startup failed");
      return origin;
    }, 60000);
    arm.processes.push({ pid: child.pid, startedAt: new Date().toISOString() });
    save();
  }
  async function stop() {
    if (!child) return;
    child.kill("SIGTERM");
    let timer;
    try {
      const s = await Promise.race([
        exit,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Graceful drain timed out")),
            45000,
          );
        }),
      ]);
      assert.equal(s.code, 0);
      arm.processes.at(-1).finishedAt = new Date().toISOString();
      child = undefined;
      origin = undefined;
      save();
    } finally {
      clearTimeout(timer);
    }
  }
  async function post(path, body) {
    const r = await fetch(origin + path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${prepared.humanAccessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    assert.equal(r.status, 200, JSON.stringify(data));
    return data;
  }
  const head = async (id) =>
    (
      await post("/v3/client/rooms/sync", {
        roomId: id,
        consumerId: "efficiency-gate",
      })
    ).latestRoomSeq;
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
    assert.ok(binding.supportedReasoning.includes(effort));
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
        reasoning: effort,
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
        .map((r) => ({
          runAttemptId: r.runAttemptId,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          state: r.state,
          exitCode: r.exitCode,
        }));
      assert.equal(round.runs.length, 1, "Unexpected follow-up Run");
      // Product-recorded usage; compareRounds requires it complete and
      // cross-checks it against the transcript-derived RAH usage.
      const productUsage = await post("/v3/client/agents/run-usage/get", {
        agentId,
        runAttemptId: round.runs[0].runAttemptId,
      });
      // S2-a execution record: null for per-turn runs.
      round.execution = productUsage.execution ?? null;
      // S2-b: measured native session resume, per-turn runs included.
      round.sessionResumeMs = productUsage.sessionResumeMs ?? null;
      save();
      assert.ok(
        runSucceeded(round.runs[0], round.execution),
        "RunAttempt did not succeed",
      );
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
        assert.equal(p.resolvedModel.reasoning, effort);
      }
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
//   native arm), cross-checked against the session transcript, which also
//   proves the model family and effort;
// - kimi: the session wire (the product records no Kimi usage).
function measureRah({ config, sessionId, round, replyAt, productUsage }) {
  if (config.provider === "codex")
    return measure(sessionId, round, { replyAt }, config);
  if (config.provider === "kimi")
    return measureKimiWire(sessionId, round, config, { replyAt });
  const transcript = claudeTranscriptRound(readClaudeTranscript(sessionId), {
    from: round.startedAt,
    to: round.finishedAt,
  });
  assertClaudeTranscriptModel(transcript, config);
  const records = productUsage.generations ?? [];
  const usable =
    productUsage.completeness === "complete" &&
    !productUsage.truncated &&
    records.length > 0;
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
