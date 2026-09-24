import { isEffectiveAnswer } from "./metrics.mjs";
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
  model,
  effort,
  bindingId,
  instructions,
  wait,
  measure,
} from "./common.mjs";
export async function rahArm({ kind, root, cwd, questions, arm, save }) {
  const stateDirectory = join(root, "state");
  const realCodex = execFileSync("which", ["codex"], {
    encoding: "utf8",
  }).trim();
  const shim = join(root, "guarded-codex.mjs");
  writeFileSync(
    shim,
    `#!/usr/bin/env node\nimport {runGuardedCodex} from ${JSON.stringify(new URL("./model-guard.mjs", import.meta.url).href)};\nawait runGuardedCodex(${JSON.stringify(realCodex)});\n`,
    { mode: 0o700 },
  );
  const spec = {
    ...localCliRuntimeSpec("codex", cwd),
    reasoning: effort,
    executable: shim,
  };
  const prepared = await prepareLocalWorkbench({
    runtimeSpecs: [spec],
    stateDirectory,
    workspaceCwd: cwd,
  });
  const configPath = join(root, "config.json");
  writeFileSync(configPath, JSON.stringify(prepared.config), { mode: 0o600 });
  let child, exit, origin, observer, participantId, roomId, actor, sessionId;
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
    if (kind === "role") {
      const role = (
        await post("/v3/client/roles/create", {
          controlRoomId: control,
          basedOnRoomSeq: await head(control),
          idempotencyKey: randomUUID(),
          configuration,
        })
      ).role;
      const instance = (
        await post("/v3/client/roles/instantiate", {
          roleId: role.roleId,
          channelId: roomId,
          basedOnRoomSeq: await head(roomId),
          idempotencyKey: randomUUID(),
        })
      ).instance;
      participantId = instance.instanceId;
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
      const actualCwd = agentExecutionWorkspacePath(
        join(stateDirectory, "agent-workspaces"),
        participantId,
      );
      mkdirSync(join(actualCwd, "scripts"), { recursive: true });
      for (const file of [
        "AGENTS.md",
        "scripts/workbench-launch-receipt.mjs",
        "scripts/workbench-launch-receipt.test.mjs",
      ]) {
        copyFileSync(join(cwd, file), join(actualCwd, file));
      }
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
      if (i === 2) {
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
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          state: r.state,
          exitCode: r.exitCode,
        }));
      assert.equal(round.runs.length, 1, "Unexpected follow-up Run");
      assert.equal(round.runs[0].exitCode, 0);
      round.queueSeconds =
        (Date.parse(round.runs[0].startedAt) - Date.parse(round.startedAt)) /
        1000;
      const records = globSync(
        join(stateDirectory, "supervisors/provider-sessions/*.json"),
      )
        .map((p) => JSON.parse(readFileSync(p)))
        .filter((s) => s.participantId === participantId);
      assert.equal(records.length, 1);
      const current = records[0].providerSessionId;
      if (sessionId) assert.equal(current, sessionId, "Session changed");
      sessionId = current;
      round.sessionId = sessionId;
      round.metrics = measure(sessionId, round, {
        replyAt: effective?.createdAt ?? null,
      });
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
      for (const file of [
        "AGENTS.md",
        "scripts/workbench-launch-receipt.mjs",
        "scripts/workbench-launch-receipt.test.mjs",
      ])
        assert.deepEqual(
          readFileSync(join(arm.actualCwd, file)),
          readFileSync(join(cwd, file)),
          "Actual workspace changed",
        );
    arm.status = "complete";
  } finally {
    await stop();
    observer?.close();
    save();
  }
}
