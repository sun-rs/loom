import assert from "node:assert/strict";
import test from "node:test";
import {
  events,
  harness,
  orderedRuns,
  sql,
  starts,
  turns,
  waitFor,
} from "./claude-warm-test-harness.ts";

// Actual AgentHost/Kernel/HTTP/driver, fake CLI only. No model or paid calls.
test("Claude native text: two replies publish once each in one session, without a Worker tool or follow-up generation", async () => {
  const state = await harness({ nativeFinalText: true });
  const originalFetch = globalThis.fetch;
  let publications = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/v1/worker/messages/final-output")) {
      publications++;
      assert.equal(
        state.credentialEvents.at(-1),
        "issued",
        "original credential remains live during publication",
      );
    }
    return originalFetch(input, init);
  };
  try {
    for (let turn = 1; turn <= 2; turn++) {
      state.post(`[fake:native-final] question ${turn}`);
      const result = await state.current.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
      assert.equal(state.credentialEvents.at(-1), "revoked");
      const expired = await originalFetch(
        `${state.workerOrigin}/v1/worker/messages/final-output`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${state.credentials.at(-1)}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            body: "must never publish",
            basedOnRoomSeq: 0,
          }),
        },
      );
      assert.equal(expired.status, 401);
    }
    assert.equal(publications, 2);
    assert.equal(starts(state).length, 1);
    assert.equal(turns(state).length, 2);
    assert.equal(events(state, "worker").length, 0);
    assert.equal(events(state, "follow-up-generation").length, 0);
    assert.deepEqual(
      sql(
        state,
        "SELECT body FROM messages WHERE actor_id=? ORDER BY rowid",
        state.participantId,
      ).map((r) => r.body),
      ["FAKE NATIVE ANSWER 1", "FAKE NATIVE ANSWER 2"],
    );
    assert.deepEqual(
      sql(state, "SELECT submission_kind FROM run_attempt_final_replies").map(
        (r) => r.submission_kind,
      ),
      ["final-output", "final-output"],
    );
    assert.equal(
      new Set(orderedRuns(state).map((r) => r.instanceRuntimeId)).size,
      1,
    );
    assert.ok(orderedRuns(state).every((r) => r.state === "exited"));
    for (const turn of turns(state)) {
      assert.match(String(turn.text), /native.*text|plain.*text/iu);
      assert.doesNotMatch(String(turn.text), /Use loom_reply for replies/u);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await state.cleanup();
  }
});

for (const [label, directive, options] of [
  ["missing assistant proof", "native-missing", {}],
  ["length-stopped output", "native-length", {}],
  ["missing captured delivery", "native-final", { skipPresented: true }],
] as const) {
  test(`Claude native text: ${label} requires action, never a model retry`, async () => {
    const state = await harness({ nativeFinalText: true, ...options });
    try {
      state.post(`[fake:${directive}] question`);
      assert.equal(
        (await state.current.agentHost.reconcileOnce()).state,
        "failed",
      );
      assert.equal(
        sql(state, "SELECT retry_disposition FROM activation_retry_fences")[0]
          ?.retry_disposition,
        "action_required",
      );
      assert.equal(
        (await state.current.agentHost.reconcileOnce()).state,
        "idle",
      );
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
      assert.equal(turns(state).length, 1);
    } finally {
      await state.cleanup();
    }
  });
}

test("Claude native text: newer Human fact holds the draft without an extra model turn", async () => {
  const state = await harness({ nativeFinalText: true });
  const originalFetch = globalThis.fetch;
  let publications = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/v1/worker/messages/final-output")) {
      publications++;
      state.post("new Human fact invalidates the answer being submitted");
    }
    return originalFetch(input, init);
  };
  try {
    state.post("[fake:native-final] original fact");
    assert.equal(
      (await state.current.agentHost.reconcileOnce()).state,
      "failed",
    );
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
      sql(state, "SELECT body, state FROM held_message_drafts").map((r) => ({
        ...r,
      })),
      [{ body: "FAKE NATIVE ANSWER 1", state: "held" }],
    );
    assert.equal(turns(state).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await state.cleanup();
  }
});

for (const committed of [false, true]) {
  test(`Claude native text: lost response ${committed ? "after commit recovers durable proof" : "before commit requires action"}, without retry`, async () => {
    const state = await harness({ nativeFinalText: true });
    const originalFetch = globalThis.fetch;
    let publications = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("/v1/worker/messages/final-output")) {
        publications++;
        if (committed) {
          const response = await originalFetch(input, init);
          assert.equal(response.status, 200);
          await response.text();
        }
        throw Error("FAKE response loss");
      }
      return originalFetch(input, init);
    };
    try {
      state.post("[fake:native-final] question");
      const result = await state.current.agentHost.reconcileOnce();
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
      assert.equal(
        (await state.current.agentHost.reconcileOnce()).state,
        "idle",
      );
      assert.equal(publications, 1);
      assert.equal(turns(state).length, 1);
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
      globalThis.fetch = originalFetch;
      await state.cleanup();
    }
  });
}

test("Claude native text: default-off leaves native assistant output diagnostic", async () => {
  const state = await harness();
  try {
    state.post("[fake:native-final] diagnostic only");
    assert.notEqual(
      (await state.current.agentHost.reconcileOnce()).state,
      "completed",
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
    assert.equal(turns(state).length, 1);
  } finally {
    await state.cleanup();
  }
});

test("Claude native text: cancelling after native completion aborts the pending publication", async () => {
  const state = await harness({ nativeFinalText: true });
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let running: Promise<void> | undefined;
  let calls = 0;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (input, init) => {
    if (!String(input).endsWith("/v1/worker/messages/final-output"))
      return originalFetch(input, init);
    calls++;
    signal = init?.signal;
    await new Promise<void>((_resolve, reject) => {
      if (signal?.aborted) reject(Error("FAKE aborted submission"));
      else
        signal?.addEventListener(
          "abort",
          () => reject(Error("FAKE aborted submission")),
          { once: true },
        );
    });
    throw Error("unreachable");
  };
  try {
    state.post("[fake:native-final] cancel pending write");
    running = state.current.agentHost.run({ signal: controller.signal });
    await waitFor(() => calls === 1, "native final reached HTTP publication");
    controller.abort();
    await running;
    assert.equal(signal?.aborted, true);
    assert.equal(calls, 1);
    assert.equal(turns(state).length, 1);
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
  } finally {
    controller.abort();
    globalThis.fetch = originalFetch;
    await running;
    await state.cleanup();
  }
});
