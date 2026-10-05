import test from "node:test";
import assert from "node:assert/strict";
import { runMultiProduct } from "./multi-channel-product.mjs";

function fixture({
  extraRun = false,
  badMention = false,
  stopCode = 0,
  memoryMode = "disabled",
  lateUsage = false,
  omitCanonicalMention = false,
} = {}) {
  const arm = { rounds: [], processes: [] };
  const messages = [],
    runs = [],
    activations = [],
    requests = [];
  let stopped = false,
    creations = 0,
    seq = 0;
  const evidence = () => ({
    runs: [...runs],
    activations: [...activations],
    messages: [...messages],
    markers: runs.map((r) => ({
      run_attempt_id: r.runAttemptId,
      submission_kind: "final-output",
      room_seq:
        messages[Number(r.runAttemptId.replace("run-", "")) * 2 + 1]?.roomSeq,
    })),
    runtimes: ["a", "b", "c"].map((s) => ({
      participant_id: s,
      instance_runtime_id: `rt-${s}`,
      native_session_id: `session-${s}`,
      state: "idle",
    })),
    usageRows: runs.map((r) => ({
      run_attempt_id: r.runAttemptId,
      input_tokens: stopped && lateUsage ? 2 : 1,
      cached_input_tokens: 0,
      output_tokens: 1,
    })),
    usageGaps: [],
  });
  const usage = (r) => ({
    runAttemptId: r.runAttemptId,
    completeness: "complete",
    gaps: [],
    totals: {
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      generations: 1,
    },
    execution: { instanceRuntimeId: `rt-${r.participantId}` },
    finalInterrupt: {},
  });
  const gate = {
    spec: { runtimeProfileId: "codex", reasoning: "low" },
    prepared: {
      humanAccessToken: "fake",
      metadata: { controlRoomId: "control", workspaceId: "w" },
      config: { workspace: { workspaceMountRevisionId: "mount" } },
    },
    stateDirectory: "/fake",
    start: async () => {},
    stop: async () => {
      stopped = true;
      return { code: stopCode };
    },
    head: async () => seq,
    assertNoGuardViolations() {},
    async post(path, body) {
      requests.push({ path, body });
      if (path.endsWith("runtimes/list"))
        return {
          runtimes: [
            {
              runtimeProfileId: "codex",
              runtimeOfferId: "offer",
              modelBindingDescriptors: [
                {
                  modelBindingId: "gpt-6-luna",
                  modelId: "gpt-6-luna",
                  supportedReasoning: ["low"],
                },
              ],
            },
          ],
        };
      if (path.endsWith("rooms/create")) return { room: { roomId: "room" } };
      if (path.endsWith("roles/create"))
        return { role: { roleId: body.configuration.handle } };
      if (path.endsWith("roles/instantiate")) {
        const s = ["a", "b", "c"][creations++];
        return {
          instance: { instanceId: s },
          agent: {
            handle: `multi-${s}-${"a".repeat(24)}`,
            definition: { agentId: `agent-${s}` },
          },
        };
      }
      if (path.endsWith("messages/post")) {
        const s = body.body.match(/^@multi-([abc])(?:-[a-f0-9]{24})? /)[1];
        const handle = `multi-${s}-${"a".repeat(24)}`;
        messages.push({
          messageId: `human-${seq}`,
          actorId: "human",
          body: body.body,
          mentions:
            !omitCanonicalMention && body.body.startsWith(`@${handle} `)
              ? [{ handle, principalId: s, start: 0, end: handle.length + 1 }]
              : [],
          roomSeq: ++seq,
          createdAt: new Date().toISOString(),
          roomId: "room",
        });
        const r = {
          runAttemptId: `run-${runs.length}`,
          participantId: s,
          state: "exited",
          exitCode: 0,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        };
        runs.push(r);
        if (extraRun)
          runs.push({ ...r, runAttemptId: "unexpected", participantId: "c" });
        activations.push({ state: "completed", participantId: s });
        messages.push({
          messageId: `reply-${seq}`,
          actorId: s,
          body: badMention ? "@multi-c wrong" : "审查结论：已核对。",
          roomSeq: ++seq,
          createdAt: new Date().toISOString(),
          roomId: "room",
        });
        return {};
      }
      if (path.endsWith("run-usage/get"))
        return usage(runs.find((r) => r.runAttemptId === body.runAttemptId));
      throw Error(path);
    },
  };
  class Observer {
    initialize() {}
    close() {}
    authenticateHumanAccessToken() {
      return { principalId: "human" };
    }
    runtimeOfferIsCurrentlyAvailable() {
      return true;
    }
    listTasks() {
      return [];
    }
    listPlacements() {
      return [{ resolvedModel: { modelId: "gpt-6-luna", reasoning: "low" } }];
    }
  }
  return {
    arm,
    requests,
    get stopped() {
      return stopped;
    },
    options: {
      root: "/fake",
      cwd: "/snapshot",
      config: {
        provider: "codex",
        model: "gpt-6-luna",
        effort: "low",
        bindingId: "gpt-6-luna",
      },
      steps: [
        { speaker: "a", body: "first" },
        { speaker: "b", body: "second" },
        { speaker: "a", body: "third" },
      ],
      arm,
      save() {},
    },
    dependencies: {
      prepareGateDaemon: async () => gate,
      RoomKernel: Observer,
      readEvidence: evidence,
      wait: async (fn) => {
        assert.ok(await fn(), "fixture did not settle");
      },
      transcript: () => [
        { type: "session_meta", payload: { memory_mode: memoryMode } },
      ],
      measure: () => ({ input: 1, cached: 0, output: 1, generations: 1 }),
    },
  };
}

test("one Channel has three instances; directed schedule retains true messages and per-instance sessions", async () => {
  const f = fixture();
  await runMultiProduct(f.options, f.dependencies);
  assert.equal(f.arm.status, "complete");
  assert.equal(f.arm.messages.length, 6);
  assert.deepEqual(
    f.arm.rounds.map((r) => r.sessionId),
    ["session-a", "session-b", "session-a"],
  );
  assert.deepEqual(
    f.requests
      .filter((r) => r.path.endsWith("messages/post"))
      .map((r) => r.body.body),
    [
      `@multi-a-${"a".repeat(24)} first`,
      `@multi-b-${"a".repeat(24)} second`,
      `@multi-a-${"a".repeat(24)} third`,
    ],
  );
  assert.equal(f.arm.runs.length, 3);
  assert.equal(f.arm.usageRows.length, 3);
  assert.equal(f.stopped, true);
});
test("unexpected Run stops further admission and preserves every Run and known usage after shutdown", async () => {
  const f = fixture({ extraRun: true });
  await assert.rejects(
    runMultiProduct(f.options, f.dependencies),
    /unexpected|Run/i,
  );
  assert.equal(
    f.requests.filter((r) => r.path.endsWith("messages/post")).length,
    1,
  );
  assert.equal(f.arm.runs.length, 2);
  assert.equal(f.arm.usageRows.length, 2);
  assert.equal(f.arm.status, "failed");
  assert.equal(f.stopped, true);
});
test("instance mention fails the arm without hiding the actual published reply", async () => {
  const f = fixture({ badMention: true });
  await assert.rejects(runMultiProduct(f.options, f.dependencies), /mention/i);
  assert.equal(f.arm.messages.at(-1).body, "@multi-c wrong");
  assert.equal(f.arm.rounds.length, 1);
});
test("non-Codex config and preaddressed business questions fail before daemon preparation", async () => {
  for (const bad of [
    { config: { provider: "kimi" } },
    { steps: [{ speaker: "a", body: "@multi-b wrong" }] },
  ]) {
    const f = fixture();
    let prepared = false;
    await assert.rejects(
      runMultiProduct(
        { ...f.options, ...bad },
        {
          ...f.dependencies,
          prepareGateDaemon: async () => {
            prepared = true;
            throw Error("unexpected spawn");
          },
        },
      ),
    );
    assert.equal(prepared, false);
  }
});

test("inventory queries real initialized Kernel schema and paginates Channel messages", async () => {
  const { RoomKernel } = await import("@rah-os/kernel");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readMultiEvidence } = await import("./multi-channel-product.mjs");
  const root = mkdtempSync(join(tmpdir(), "loom-multi-inventory-"));
  const kernel = new RoomKernel({ databasePath: join(root, "room.db") });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(actor, { name: "Test", slug: "test" });
    kernel.postMessage(actor, {
      roomId: room.roomId,
      body: "actual body",
      recipients: [],
      idempotencyKey: "post",
    });
    const evidence = readMultiEvidence({
      stateDirectory: root,
      observer: kernel,
      actor,
      roomId: room.roomId,
    });
    assert.equal(evidence.messages[0].body, "actual body");
    assert.deepEqual(evidence.runs, []);
    assert.deepEqual(evidence.presentedWindows, []);
  } finally {
    kernel.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("short nonempty review is valid; mismatched measured usage stops before another paid admission", async () => {
  const f = fixture();
  await assert.rejects(
    runMultiProduct(f.options, {
      ...f.dependencies,
      measure: () => ({ input: 2, cached: 0, output: 1, generations: 1 }),
    }),
    /usage/i,
  );
  assert.equal(
    f.requests.filter((r) => r.path.endsWith("messages/post")).length,
    1,
  );
});

test("daemon shutdown failure cannot retain complete status", async () => {
  const f = fixture({ stopCode: 1 });
  await assert.rejects(
    runMultiProduct(f.options, f.dependencies),
    /stop failed/,
  );
  assert.equal(f.arm.status, "failed");
  assert.equal(f.arm.usageRows.length, 3);
});
test("native memory evidence must be disabled before the next admission", async () => {
  const f = fixture({ memoryMode: "enabled" });
  await assert.rejects(runMultiProduct(f.options, f.dependencies), /memory/);
  assert.equal(f.arm.rounds.length, 1);
});

test("marker for another Room event cannot prove this reply final", async () => {
  const f = fixture();
  const read = f.dependencies.readEvidence;
  f.dependencies.readEvidence = () => {
    const x = read();
    x.markers = x.markers.map((m) => ({ ...m, room_seq: 999 }));
    return x;
  };
  await assert.rejects(runMultiProduct(f.options, f.dependencies), /marker/i);
  assert.equal(f.arm.rounds.length, 1);
});

test("late persisted usage survives shutdown and cannot leave stale complete totals", async () => {
  const f = fixture({ lateUsage: true });
  await assert.rejects(runMultiProduct(f.options, f.dependencies), /usage/i);
  assert.equal(f.arm.usageRows[0].input_tokens, 2);
  assert.equal(f.arm.status, "failed");
});

test("failure after metrics recovers each participant through post-stop capture without replacing metrics", async () => {
  const f = fixture();
  const read = f.dependencies.readEvidence;
  f.dependencies.readEvidence = () => {
    const x = read();
    x.markers = [];
    return x;
  };
  await assert.rejects(runMultiProduct(f.options, f.dependencies), /marker/i);
  const round = f.arm.rounds[0];
  assert.equal(round.metrics.input, 1);
  assert.equal(round.failedUsageByParticipant.length, 3);
  for (const row of round.failedUsageByParticipant) {
    // /fake deliberately has no SQLite file. Each participant must attempt
    // scoped recovery, rather than reuse the successful speaker's metrics.
    assert.notEqual(
      row.usageRecoveryEvidence?.source,
      "existing-metrics-preserved",
    );
    assert.ok(row.usageRecoveryError);
  }
  assert.ok(
    Date.parse(round.failedUsageCapturedAt) >= Date.parse(round.finishedAt),
  );
});

test("canonical mention must be durably bound to exactly the scheduled instance", async () => {
  const f = fixture({ omitCanonicalMention: true });
  await assert.rejects(
    runMultiProduct(f.options, f.dependencies),
    /canonical mention/i,
  );
  assert.equal(f.arm.rounds.length, 1);
  assert.deepEqual(f.arm.messages[0].mentions, []);
});

test("roles/create carries only the AGENTS reference, never duplicate business instructions", async () => {
  const { RoleConfigurationSchema } =
    await import("../../packages/protocol/src/role-catalog.ts");
  const f = fixture();
  // Caller no longer supplies business prose to the product harness.
  delete f.options.instructions;
  await runMultiProduct(f.options, f.dependencies);
  const configs = f.requests
    .filter((r) => r.path.endsWith("roles/create"))
    .map((r) => r.body.configuration);
  assert.equal(configs.length, 3);
  for (const config of configs) {
    assert.equal(config.instructions, "Follow the workspace AGENTS.md.");
    assert.equal(RoleConfigurationSchema.safeParse(config).success, true);
    assert.equal(
      RoleConfigurationSchema.safeParse({ ...config, instructions: "" })
        .success,
      false,
    );
  }
});
