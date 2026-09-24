// Paid long-session drift arm: one Role instance, one native session, the
// scripted Human sequence, forced compactions, and per-round ledger evidence.
// Bootstrap follows rah.mjs (isolated daemon.mjs process, prepared local
// workbench, guarded CLI shim, Role create/instantiate); nothing touches the
// formal workbench or its database.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RoomKernel } from "@rah-os/kernel";
import {
  localCliRuntimeSpec,
  prepareLocalWorkbench,
} from "../../packages/daemon/src/index.ts";
import { wait, transcript } from "./common.mjs";
import { createCodexRequestGuard } from "./model-guard.mjs";
import { createKimiRequestGuard } from "./drift-kimi-guard.mjs";
import {
  codexToolCalls,
  countCodexCompactions,
  evaluateRound,
} from "./drift-checks.mjs";
import {
  compactCodexPerTurn,
  compactCodexWarm,
  compactKimi,
} from "./drift-compaction.mjs";
import { DRIFT_ROLE_INSTRUCTIONS } from "./drift-scenario.mjs";

const ROUND_TIMEOUT_MS = 360_000;
const BODY_LIMIT = 400;

export async function runDriftArm({
  config,
  root,
  cwd,
  scenario,
  result,
  save,
}) {
  const { provider, model, effort, bindingId, mode } = config;
  const stateDirectory = join(root, "state");
  const dbPath = join(stateDirectory, "room.db");
  const query = (sql, ...args) => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return db
        .prepare(sql)
        .all(...args)
        .map((row) => ({ ...row }));
    } finally {
      db.close();
    }
  };
  const realCli = execFileSync("which", [provider], {
    encoding: "utf8",
  }).trim();
  const socketRecordPath = join(root, "warm-sockets.jsonl");
  const shim = join(root, `guarded-${provider}.mjs`);
  const guardModule = new URL(
    provider === "codex" ? "./model-guard.mjs" : "./drift-kimi-guard.mjs",
    import.meta.url,
  ).href;
  const shimCall =
    provider === "codex"
      ? `runGuardedCodex(${JSON.stringify(realCli)}, ${JSON.stringify({ model, effort, socketRecordPath })})`
      : `runGuardedKimi(${JSON.stringify(realCli)}, ${JSON.stringify({ model, effort })})`;
  writeFileSync(
    shim,
    `#!/usr/bin/env node\nimport {${provider === "codex" ? "runGuardedCodex" : "runGuardedKimi"}} from ${JSON.stringify(guardModule)};\nawait ${shimCall};\n`,
    { mode: 0o700 },
  );
  const validate =
    provider === "codex"
      ? createCodexRequestGuard({ model, effort })
      : createKimiRequestGuard({ model, effort });
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
  const daemonConfig =
    mode === "warm"
      ? { ...prepared.config, warmRuntimes: { codex: { enabled: true } } }
      : prepared.config;
  const configPath = join(root, "config.json");
  writeFileSync(configPath, JSON.stringify(daemonConfig), { mode: 0o600 });

  let child, exit, origin, observer;
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
    result.processes.push({
      pid: child.pid,
      startedAt: new Date().toISOString(),
    });
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
      result.processes.at(-1).finishedAt = new Date().toISOString();
      result.processes.at(-1).exit = s;
      child = undefined;
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
    assert.equal(
      r.status,
      200,
      `${path}: ${JSON.stringify(data).slice(0, 500)}`,
    );
    return data;
  }
  const head = async (id) =>
    (
      await post("/v3/client/rooms/sync", {
        roomId: id,
        consumerId: "drift-gate",
      })
    ).latestRoomSeq;

  // Native session of the instance: warm runtime row, else the provider
  // session record (both are opaque metadata; used only to prove continuity
  // and to address compaction).
  const sessionOf = (participantId, runs) => {
    const runtimeId = runs.find((r) => r.instanceRuntimeId)?.instanceRuntimeId;
    if (runtimeId) {
      const row = query(
        "SELECT native_session_id FROM instance_runtimes WHERE instance_runtime_id = ?",
        runtimeId,
      )[0];
      if (row?.native_session_id) return row.native_session_id;
    }
    const records = globSync(
      join(stateDirectory, "supervisors/provider-sessions/*.json"),
    )
      .map((p) => JSON.parse(readFileSync(p)))
      .filter((s) => s.participantId === participantId);
    return records.length === 1 ? records[0].providerSessionId : null;
  };

  try {
    await start();
    observer = new RoomKernel({ databasePath: dbPath });
    observer.initialize();
    const inv = await post("/v1/local/runtimes/list", {});
    const runtime = inv.runtimes.find(
      (r) => r.runtimeProfileId === spec.runtimeProfileId,
    );
    assert.ok(runtime?.runtimeOfferId, "Runtime offer missing");
    await wait(
      () => observer.runtimeOfferIsCurrentlyAvailable(runtime.runtimeOfferId),
      60000,
    );
    const binding = runtime.modelBindingDescriptors.find(
      (b) => b.modelBindingId === bindingId,
    );
    assert.equal(binding?.modelId, model, "Approved binding not offered");
    assert.ok(
      binding.supportedReasoning.includes(effort),
      "Approved effort not offered",
    );
    const control = prepared.metadata.controlRoomId;
    const roomId = (
      await post("/v3/client/rooms/create", {
        workspaceId: prepared.metadata.workspaceId,
        basedOnControlRoomSeq: await head(control),
        kind: "channel",
        name: "Isolated drift gate",
        slug: "drift",
        idempotencyKey: randomUUID(),
      })
    ).room.roomId;
    const role = (
      await post("/v3/client/roles/create", {
        controlRoomId: control,
        basedOnRoomSeq: await head(control),
        idempotencyKey: randomUUID(),
        configuration: {
          displayName: "Drift Assistant",
          handle: "drift-assistant",
          instructions: DRIFT_ROLE_INSTRUCTIONS,
          role: "Read-only assistant under a long session",
          executionWorkspace: {
            kind: "existing_mount",
            workspaceMountRevisionId:
              prepared.config.workspace.workspaceMountRevisionId,
          },
          runtimeOfferId: runtime.runtimeOfferId,
          modelIntent: {
            exactBindingIds: [bindingId],
            fallback: "disabled",
            reasoning: effort,
            serviceTier: "default",
          },
          toolAccessMode: "full_access",
        },
      })
    ).role;
    const created = await post("/v3/client/roles/instantiate", {
      roleId: role.roleId,
      channelId: roomId,
      basedOnRoomSeq: await head(roomId),
      idempotencyKey: randomUUID(),
    });
    const participantId = created.instance.instanceId;
    const agentId = created.agent.definition.agentId;
    Object.assign(result.arm, { roomId, participantId });
    save();

    let threadId;
    let sessionId;
    let compactedBefore = false;
    for (const step of scenario) {
      const baseline = await head(roomId);
      const startedAt = new Date().toISOString();
      const round = {
        round: step.round,
        template: step.template,
        kinds: step.kinds,
        startedAt,
        compactedBefore,
      };
      compactedBefore = false;
      result.rounds.push(round);
      save();
      const activationIds = new Set();
      for (const message of step.messages) {
        const response =
          message.target === "thread"
            ? await post("/v3/client/threads/reply", {
                roomId,
                threadId,
                basedOnRoomSeq: await head(roomId),
                body: message.body,
                recipientIds: [participantId],
                idempotencyKey: randomUUID(),
              })
            : await post("/v3/client/messages/post", {
                roomId,
                basedOnRoomSeq: await head(roomId),
                body: message.body,
                recipients: [],
                idempotencyKey: randomUUID(),
              });
        for (const id of response.activationIds) activationIds.add(id);
        round.humanMessageIds = [
          ...(round.humanMessageIds ?? []),
          response.event.aggregateId ?? response.event.payload?.messageId,
        ];
      }
      round.postedActivations = activationIds.size;
      console.log(`drift round ${step.round} (${step.template}) sent`);
      const lane = () =>
        query(
          `SELECT activation_id, state, attempt_count, from_seq, to_seq, updated_at
             FROM activations WHERE room_id = ? AND participant_id = ? AND to_seq > ?`,
          roomId,
          participantId,
          baseline,
        );
      const runsFor = (ids) =>
        ids.length
          ? query(
              `SELECT run_attempt_id, activation_id, attempt_number, state, exit_code,
                      started_at, finished_at, execution_mode, instance_runtime_id
                 FROM run_attempts WHERE activation_id IN (${ids.map(() => "?").join(",")})`,
              ...ids,
            )
          : [];
      let timedOut = false;
      try {
        await wait(() => {
          const acts = lane();
          if (acts.some((a) => a.state === "quarantined")) return true;
          const ids = acts.map((a) => a.activation_id);
          const runs = runsFor(ids);
          return (
            acts.length > 0 &&
            [...activationIds].every((id) => ids.includes(id)) &&
            acts.every((a) => ["completed", "cancelled"].includes(a.state)) &&
            runs.length > 0 &&
            runs.every((r) => r.finished_at !== null)
          );
        }, ROUND_TIMEOUT_MS);
      } catch {
        timedOut = true;
      }
      round.finishedAt = new Date().toISOString();
      const acts = lane();
      const ids = acts.map((a) => a.activation_id);
      const runs = runsFor(ids).map((r) => ({
        runAttemptId: r.run_attempt_id,
        activationId: r.activation_id,
        attemptNumber: r.attempt_number,
        state: r.state,
        exitCode: r.exit_code ?? undefined,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        executionMode: r.execution_mode ?? null,
        instanceRuntimeId: r.instance_runtime_id ?? null,
      }));
      const runIds = runs.map((r) => r.runAttemptId);
      const inList = (list) => list.map(() => "?").join(",");
      const replies = query(
        `SELECT m.message_id, m.room_id, m.thread_id, m.body, m.created_at,
                e.room_seq, e.event_id
           FROM messages m
           JOIN room_events e ON e.room_id = m.room_id
                             AND e.aggregate_type = 'message'
                             AND e.aggregate_id = m.message_id
          WHERE m.actor_id = ? AND (
                (m.room_id = ? AND e.room_seq > ?) OR
                (m.room_id <> ? AND m.created_at >= ?))
          ORDER BY m.created_at, e.room_seq`,
        participantId,
        roomId,
        baseline,
        roomId,
        startedAt,
      ).map((m) => ({
        messageId: m.message_id,
        roomId: m.room_id,
        threadId: m.thread_id ?? null,
        body: m.body,
        createdAt: m.created_at,
        roomSeq: m.room_seq,
        eventId: m.event_id,
      }));
      const finalReplies = runIds.length
        ? query(
            `SELECT run_attempt_id, event_id, room_seq, interrupt_sent, preempted_follow_up
               FROM run_attempt_final_replies WHERE run_attempt_id IN (${inList(runIds)})`,
            ...runIds,
          ).map((f) => ({
            runAttemptId: f.run_attempt_id,
            eventId: f.event_id,
            roomSeq: f.room_seq,
            interruptSent: f.interrupt_sent,
            preemptedFollowUp: f.preempted_follow_up,
          }))
        : [];
      const newTasks = query(
        "SELECT task_id, creator_id, room_id FROM tasks WHERE created_at >= ?",
        startedAt,
      ).map((t) => ({ taskId: t.task_id, creatorId: t.creator_id }));
      const trajectoryCompactions = runIds.length
        ? query(
            `SELECT COUNT(*) AS n FROM run_trajectory_entries
              WHERE run_attempt_id IN (${inList(runIds)})
                AND json_extract(entry_json, '$.kind') = 'compaction_finished'`,
            ...runIds,
          )[0].n
        : 0;
      // Product-recorded usage per RunAttempt, summed for the round.
      let usage = null;
      for (const r of runs) {
        const u = await post("/v3/client/agents/run-usage/get", {
          agentId,
          runAttemptId: r.runAttemptId,
        });
        const t = u.totals ?? {};
        usage ??= {
          generations: 0,
          input: 0,
          cached: 0,
          completeness: "complete",
        };
        for (const [k, f] of [
          ["generations", "generations"],
          ["input", "inputTokens"],
          ["cached", "cachedInputTokens"],
        ])
          usage[k] = usage[k] === null || t[f] == null ? null : usage[k] + t[f];
        if (u.completeness !== "complete") usage.completeness = u.completeness;
      }
      const current = sessionOf(participantId, runs);
      const sessionChanged = Boolean(
        sessionId && current && current !== sessionId,
      );
      sessionId ??= current;
      // Codex rollout (diagnostic only): Worker call kinds and natural
      // compactions inside this round's window.
      let toolCalls = null;
      let rolloutCompactions = null;
      if (provider === "codex" && current) {
        try {
          const events = transcript(current).filter(
            (e) => e.timestamp >= startedAt && e.timestamp <= round.finishedAt,
          );
          toolCalls = codexToolCalls(events);
          rolloutCompactions = countCodexCompactions(events);
        } catch (error) {
          round.transcriptError = String(error.message).slice(0, 200);
        }
      }
      const evaluation = evaluateRound(
        step,
        {
          replies,
          activations: acts.map((a) => ({
            activationId: a.activation_id,
            state: a.state,
            attemptCount: a.attempt_count,
          })),
          runs,
          finalReplies,
          newTasks,
          toolCalls,
          usage,
          compactionsInRound: trajectoryCompactions + (rolloutCompactions ?? 0),
        },
        { threadId, roomId, provider, mode },
      );
      if (timedOut) evaluation.failures.push("roundTimeout");
      if (sessionChanged) evaluation.failures.push("sessionChanged");
      Object.assign(round, {
        evaluation,
        activationIds: ids.length,
        windowSingleActivation:
          step.messages.length > 1 ? new Set(ids).size === 1 : null,
        runs: runs.map(({ instanceRuntimeId, ...r }) => r),
        finalReplies,
        replies: replies.map((m) => ({
          roomSeq: m.roomSeq,
          target:
            m.roomId !== roomId ? "elsewhere" : m.threadId ? "thread" : "room",
          chars: [...m.body.trim()].length,
          body: m.body.slice(0, BODY_LIMIT),
        })),
        toolCallKinds: toolCalls && toolCalls.map((c) => c.kind),
        firstReplySeconds: replies.length
          ? (Date.parse(replies[0].createdAt) - Date.parse(startedAt)) / 1000
          : null,
        settledSeconds:
          (Math.max(
            ...acts.map((a) => Date.parse(a.updated_at)),
            Date.parse(startedAt),
          ) -
            Date.parse(startedAt)) /
          1000,
      });
      save();
      console.log(
        `drift round ${step.round}: ${evaluation.failures.join(",") || "ok"}`,
      );
      if (timedOut || acts.some((a) => a.state === "quarantined"))
        throw new Error(
          `Round ${step.round} did not settle (timeout or quarantine)`,
        );

      if (step.round === 1) {
        // The thread used by later "reply inside thread" rounds is rooted at
        // round 1's Human message; creating it wakes nobody.
        const rootMessageId = round.humanMessageIds[0];
        assert.ok(rootMessageId, "Round 1 message id missing");
        threadId = (
          await post("/v3/client/threads/create", {
            roomId,
            rootMessageId,
            recipientIds: [],
            basedOnRoomSeq: await head(roomId),
            idempotencyKey: randomUUID(),
          })
        ).thread.threadId;
        result.arm.threadCreated = true;
      }
      if (config.compactAt.includes(step.round)) {
        assert.ok(current, "No native session to compact");
        console.log(
          `drift compaction after round ${step.round} (${provider}/${mode})`,
        );
        let record;
        if (provider === "codex" && mode === "warm") {
          const lines = existsSync(socketRecordPath)
            ? readFileSync(socketRecordPath, "utf8")
                .trim()
                .split("\n")
                .filter(Boolean)
            : [];
          assert.ok(
            lines.length,
            "Warm runtime socket was not recorded by the guard",
          );
          record = await compactCodexWarm({
            socketPath: JSON.parse(lines.at(-1)).listenPath,
            threadId: current,
            model,
            effort,
            validate,
          });
        } else if (provider === "codex") {
          record = await compactCodexPerTurn({
            codex: realCli,
            cwd,
            threadId: current,
            model,
            effort,
            validate,
          });
        } else {
          record = await compactKimi({
            kimi: realCli,
            cwd,
            sessionId: current,
            model,
            effort,
            validate,
          });
        }
        result.compactions.push({
          afterRound: step.round,
          provider,
          mode,
          ...record,
        });
        compactedBefore = true;
        save();
        console.log(
          `drift compaction after round ${step.round}: observed=${record.observed}` +
            (record.error ? ` error=${record.error}` : ""),
        );
      }
    }
    result.arm.sessionId = sessionId;
    result.arm.placements = observer.listPlacements({ roomId }).map((p) => ({
      modelId: p.resolvedModel.modelId,
      reasoning: p.resolvedModel.reasoning,
    }));
    for (const p of result.arm.placements) {
      assert.equal(p.modelId, model, "Placement used another model");
      assert.equal(p.reasoning, effort, "Placement used another effort");
    }
    result.arm.status = "complete";
  } finally {
    await stop().catch((e) => {
      result.arm.stopError = String(e);
    });
    observer?.close();
    save();
  }
}
