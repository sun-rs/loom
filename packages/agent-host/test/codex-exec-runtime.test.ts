import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeImplementationRegistry } from "../src/index.ts";
import { codexExecHarness, sql, waitFor } from "./codex-exec-test-harness.ts";

// Real Host/Kernel/Worker path, fake ordinary exec process; no paid provider.
test("ordinary Codex: two native finals publish once each, exec then resume same session with memory off", async () => {
  const state = await codexExecHarness();
  const fetcher = globalThis.fetch;
  let publications = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/v1/worker/messages/final-output")) {
      publications++;
      assert.equal(state.credentialEvents.at(-1), "issued");
    }
    return fetcher(input, init);
  };
  try {
    for (let i = 1; i <= 2; i++) {
      state.post(`ordinary question ${i}`);
      const result = await state.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
      assert.equal(state.credentialEvents.at(-1), "revoked");
      const revoked = await fetcher(
        `${state.workerOrigin}/v1/worker/messages/final-output`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${state.credentials.at(-1)}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ body: "must not publish", basedOnRoomSeq: 0 }),
        },
      );
      assert.equal(revoked.status, 401);
    }
    const launches = state.records().filter((r) => r.event === "launch");
    assert.equal(launches.length, 2, "one ordinary CLI launch per user turn");
    assert.equal(new Set(launches.map((r) => r.session)).size, 1);
    assert.equal((launches[0]!.args as string[]).includes("resume"), false);
    assert.equal((launches[1]!.args as string[]).includes("resume"), true);
    for (const launch of launches) {
      const argv = launch.args as string[];
      assert.equal(argv[0], "exec");
      assert.equal(argv.includes("app-server"), false);
      assert.ok(argv.includes("--json"));
      assert.ok(argv.includes("--output-last-message"));
      for (const setting of [
        "features.memories=false",
        "memories.generate_memories=false",
        "memories.use_memories=false",
      ])
        assert.ok(
          argv.includes(setting),
          `native automatic memory disabled on every launch: ${setting}`,
        );
      assert.match(String(launch.wake), /native-final-text/);
    }
    assert.equal(state.records().filter((r) => r.event === "worker").length, 0);
    assert.equal(publications, 2);
    assert.deepEqual(
      sql(
        state,
        "SELECT body FROM messages WHERE actor_id=? ORDER BY rowid",
        state.participantId,
      ).map((r) => r.body),
      ["FAKE ORDINARY CODEX ANSWER 1", "FAKE ORDINARY CODEX ANSWER 2"],
    );
    assert.deepEqual(
      sql(state, "SELECT submission_kind FROM run_attempt_final_replies").map(
        (r) => r.submission_kind,
      ),
      ["final-output", "final-output"],
    );
  } finally {
    globalThis.fetch = fetcher;
    await state.cleanup();
  }
});

for (const directive of ["missing-final", "wrong-session"]) {
  test(`ordinary Codex: ${directive} never publishes or silently retries`, async () => {
    const state = await codexExecHarness();
    try {
      state.post(`[fake:${directive}] question`);
      assert.equal((await state.agentHost.reconcileOnce()).state, "failed");
      assert.equal(
        sql(state, "SELECT retry_disposition FROM activation_retry_fences")[0]
          ?.retry_disposition,
        "action_required",
      );
      assert.equal((await state.agentHost.reconcileOnce()).state, "idle");
      assert.equal(
        sql(
          state,
          "SELECT * FROM messages WHERE actor_id=?",
          state.participantId,
        ).length,
        0,
      );
      assert.equal(
        sql(state, "SELECT * FROM run_attempt_final_replies").length,
        0,
      );
      assert.equal(
        state.records().filter((r) => r.event === "launch").length,
        1,
      );
    } finally {
      await state.cleanup();
    }
  });
}

test("ordinary Codex: cancellation before native final publishes nothing", async () => {
  const state = await codexExecHarness();
  const controller = new AbortController();
  let running: Promise<void> | undefined;
  try {
    state.post("[fake:hang] cancel me");
    running = state.agentHost.run({ signal: controller.signal });
    await waitFor(
      () => state.records().some((r) => r.event === "launch"),
      "ordinary exec launch",
    );
    const cancelledAt = Date.now();
    controller.abort();
    await running;
    assert.ok(
      Date.now() - cancelledAt < 5000,
      "explicit short test drain actually ends the hanging process",
    );
    const pid = Number(state.records().find((r) => r.event === "launch")?.pid);
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    assert.equal(
      state.kernel.listRunAttempts({ roomId: state.roomId })[0]?.state,
      "cancelled",
    );
    assert.equal(
      sql(state, "SELECT * FROM messages WHERE actor_id=?", state.participantId)
        .length,
      0,
    );
    assert.equal(
      sql(state, "SELECT * FROM run_attempt_final_replies").length,
      0,
    );
    assert.equal(
      sql(state, "SELECT * FROM activations WHERE state='completed'").length,
      0,
    );
    assert.equal(state.credentialEvents.at(-1), "revoked");
    assert.equal(state.records().filter((r) => r.event === "launch").length, 1);
  } finally {
    controller.abort();
    await running;
    await state.cleanup();
  }
});

test("ordinary Codex: Task fallback retains Worker ACK but never completes explicit work from native text", async () => {
  const state = await codexExecHarness();
  try {
    state.kernel.createTask(state.actor, {
      assigneeId: state.participantId,
      idempotencyKey: "ordinary-task",
      reviewerIds: [],
      roomId: state.roomId,
      title: "[fake:ack] explicit work stays open",
    });
    const result = await state.agentHost.reconcileOnce();
    assert.equal(result.state, "failed", JSON.stringify(result));
    assert.match(JSON.stringify(result), /task|obligation/i);
    assert.doesNotMatch(JSON.stringify(result), /Final output was not/);
    assert.equal(sql(state, "SELECT state FROM tasks")[0]?.state, "todo");
    assert.equal(
      sql(state, "SELECT * FROM run_attempt_final_replies").length,
      0,
    );
    const launches = state.records().filter((r) => r.event === "launch");
    assert.equal(launches.length, 1);
    assert.doesNotMatch(
      String(launches[0]?.wake),
      /Reply transport: native-final-text/,
    );
    assert.deepEqual(
      state
        .records()
        .filter((r) => r.event === "worker")
        .map((r) => r.status),
      [0],
    );
  } finally {
    await state.cleanup();
  }
});

test("ordinary Codex: a newer Human fact holds the reply with no extra model launch", async () => {
  const state = await codexExecHarness();
  const fetcher = globalThis.fetch;
  let publications = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/v1/worker/messages/final-output")) {
      publications++;
      state.post("new Human correction");
    }
    return fetcher(input, init);
  };
  try {
    state.post("original question");
    assert.equal((await state.agentHost.reconcileOnce()).state, "failed");
    assert.equal(publications, 1);
    assert.equal(
      sql(state, "SELECT retry_disposition FROM activation_retry_fences")[0]
        ?.retry_disposition,
      "action_required",
    );
    assert.equal(
      sql(state, "SELECT * FROM messages WHERE actor_id=?", state.participantId)
        .length,
      0,
    );
    assert.deepEqual(
      sql(state, "SELECT body,state FROM held_message_drafts").map((r) => ({
        ...r,
      })),
      [{ body: "FAKE ORDINARY CODEX ANSWER 1", state: "held" }],
    );
    assert.equal(state.records().filter((r) => r.event === "launch").length, 1);
  } finally {
    globalThis.fetch = fetcher;
    await state.cleanup();
  }
});

for (const committed of [false, true]) {
  test(`ordinary Codex: unknown response ${committed ? "after" : "before"} commit is never re-submitted`, async () => {
    const state = await codexExecHarness();
    const fetcher = globalThis.fetch;
    let publications = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("/v1/worker/messages/final-output")) {
        publications++;
        if (committed) {
          const response = await fetcher(input, init);
          assert.equal(response.status, 200);
          await response.text();
        }
        throw Error("FAKE lost publication response");
      }
      return fetcher(input, init);
    };
    try {
      state.post("ordinary final publication");
      const result = await state.agentHost.reconcileOnce();
      assert.equal(
        result.state,
        committed ? "completed" : "failed",
        JSON.stringify(result),
      );
      if (!committed)
        assert.equal(
          sql(state, "SELECT retry_disposition FROM activation_retry_fences")[0]
            ?.retry_disposition,
          "action_required",
        );
      assert.equal((await state.agentHost.reconcileOnce()).state, "idle");
      assert.equal(publications, 1);
      assert.equal(
        state.records().filter((r) => r.event === "launch").length,
        1,
      );
      assert.equal(
        sql(
          state,
          "SELECT * FROM messages WHERE actor_id=?",
          state.participantId,
        ).length,
        committed ? 1 : 0,
      );
      assert.equal(
        sql(state, "SELECT * FROM run_attempt_final_replies").length,
        committed ? 1 : 0,
      );
    } finally {
      globalThis.fetch = fetcher;
      await state.cleanup();
    }
  });
}

test("ordinary Codex: native-final flag off keeps the plain answer diagnostic", async () => {
  const state = await codexExecHarness({ nativeFinalText: false });
  try {
    state.post("[fake:ack] Worker-only delivery");
    assert.equal((await state.agentHost.reconcileOnce()).state, "completed");
    assert.equal(
      sql(state, "SELECT * FROM run_attempt_final_replies").length,
      0,
    );
    assert.equal(
      sql(state, "SELECT * FROM messages WHERE actor_id=?", state.participantId)
        .length,
      0,
    );
    const launch = state.records().find((r) => r.event === "launch");
    assert.doesNotMatch(
      String(launch?.wake),
      /Reply transport: native-final-text/,
    );
    const run = state.kernel.listRunAttempts({ roomId: state.roomId })[0]!;
    const descriptor = sql(
      state,
      "SELECT recovery_descriptor_json FROM runtime_processes",
    )[0];
    assert.equal(run.state, "exited");
    assert.equal(typeof descriptor?.recovery_descriptor_json, "string");
    assert.doesNotMatch(
      String(descriptor!.recovery_descriptor_json),
      /volatile\/v1/,
    );
  } finally {
    await state.cleanup();
  }
});

test("ordinary Codex: registry accepts its explicit profile without substituting the warm app-server adapter", async () => {
  const state = await codexExecHarness({ nativeFinalText: false });
  try {
    const implementations = new RuntimeImplementationRegistry();
    const report = state.profiles.recordProbeReport(
      await implementations.probeRevision(state.revision, {
        cwd: state.directory,
      }),
    );
    const active = state.profiles.activateRevision({
      contentDigest: state.revision.contentDigest,
      runtimeProfileRevisionId: state.revision.runtimeProfileRevisionId,
    });
    assert.equal(report.reportVersion, 2);
    if (report.reportVersion !== 2) throw Error("missing fake native catalog");
    const binding = report.modelBindings[0]!;
    const runtime = implementations.createRuntime(
      active,
      report,
      { cwd: state.directory },
      {
        source: "explicit_binding",
        modelBindingId: binding.modelBindingId,
        provider: binding.provider,
        modelId: binding.modelId,
        reasoning: "low",
      },
      "full_access",
    );
    assert.equal(runtime.guideRuntimeId, "codex");
    assert.equal(runtime.busyInputSupported, false);
    assert.throws(
      () =>
        implementations.createRuntime(
          active,
          report,
          { cwd: state.directory },
          {
            source: "explicit_binding",
            modelBindingId: binding.modelBindingId,
            provider: binding.provider,
            modelId: binding.modelId,
            reasoning: "low",
            serviceTier: "priority",
          },
          "full_access",
        ),
      /service tier.*not.*verified/i,
      "unverified service tier must fail before launching rather than be silently ignored",
    );
    assert.throws(
      () =>
        implementations.createRuntime(
          active,
          report,
          { cwd: state.directory },
          undefined,
          "full_access",
        ),
      /explicit model and reasoning/,
    );
    assert.equal(
      state.records().length,
      0,
      "catalog probing never starts a model turn",
    );
  } finally {
    await state.cleanup();
  }
});
