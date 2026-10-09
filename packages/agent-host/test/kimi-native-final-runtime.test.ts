import assert from "node:assert/strict";
import test from "node:test";
import {
  kimiNativeFinalHarness,
  sql,
  waitFor,
} from "./kimi-native-final-test-harness.ts";

// Real Host, Kernel and Worker HTTP; only the native provider process is fake.
test("Kimi native final: two cold processes retain one session and publish once with live original credentials", async () => {
  const s = await kimiNativeFinalHarness();
  const fetcher = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/v1/worker/messages/final-output")) {
      writes++;
      assert.equal(s.credentialEvents.at(-1), "issued");
    }
    return fetcher(url, init);
  };
  try {
    for (let i = 1; i <= 2; i++) {
      s.post(`question ${i}`);
      const result = await s.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
      assert.equal(s.credentialEvents.at(-1), "revoked");
      const denied = await fetcher(
        `${s.workerOrigin}/v1/worker/messages/final-output`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${s.credentials.at(-1)}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ body: "must not publish", basedOnRoomSeq: 0 }),
        },
      );
      assert.equal(denied.status, 401);
    }
    assert.equal(writes, 2);
    const sessions = s.records().filter((r) => r.event === "session");
    assert.deepEqual(
      sessions.map((r) => r.method),
      ["session/new", "session/resume"],
    );
    assert.equal(new Set(sessions.map((r) => r.session)).size, 1);
    assert.equal(new Set(sessions.map((r) => r.pid)).size, 2);
    assert.deepEqual(
      sql(
        s,
        "SELECT body FROM messages WHERE actor_id=? ORDER BY rowid",
        s.participantId,
      ).map((r) => r.body),
      ["FAKE KIMI NATIVE ANSWER 1", "FAKE KIMI NATIVE ANSWER 2"],
    );
    assert.equal(sql(s, "SELECT * FROM run_attempt_final_replies").length, 2);
    assert.equal(
      sql(s, "SELECT * FROM activations WHERE state='completed'").length,
      2,
    );
  } finally {
    globalThis.fetch = fetcher;
    await s.cleanup();
  }
});

for (const committed of [false, true])
  test(`Kimi native final: lost ${committed ? "committed" : "uncommitted"} receipt is never resent`, async () => {
    const s = await kimiNativeFinalHarness();
    const fetcher = globalThis.fetch;
    let writes = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/v1/worker/messages/final-output")) {
        writes++;
        if (committed) {
          const response = await fetcher(url, init);
          assert.equal(response.status, 200);
          await response.text();
        }
        throw Error("FAKE lost response");
      }
      return fetcher(url, init);
    };
    try {
      s.post("reply once");
      assert.equal(
        (await s.agentHost.reconcileOnce()).state,
        committed ? "completed" : "failed",
      );
      assert.equal((await s.agentHost.reconcileOnce()).state, "idle");
      assert.equal(writes, 1);
      assert.equal(
        sql(s, "SELECT * FROM run_attempt_final_replies").length,
        committed ? 1 : 0,
      );
      assert.equal(s.records().filter((r) => r.event === "launch").length, 1);
    } finally {
      globalThis.fetch = fetcher;
      await s.cleanup();
    }
  });

test("Kimi native final: stale Human correction holds rather than republishes", async () => {
  const s = await kimiNativeFinalHarness();
  const fetcher = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/v1/worker/messages/final-output")) {
      writes++;
      s.post("new correction");
    }
    return fetcher(url, init);
  };
  try {
    s.post("original question");
    assert.equal((await s.agentHost.reconcileOnce()).state, "failed");
    assert.equal(writes, 1);
    assert.equal(sql(s, "SELECT * FROM run_attempt_final_replies").length, 0);
    assert.equal(
      sql(s, "SELECT * FROM held_message_drafts WHERE state='held'").length,
      1,
    );
    assert.equal(
      sql(s, "SELECT retry_disposition FROM activation_retry_fences")[0]
        ?.retry_disposition,
      "action_required",
    );
    assert.equal(s.records().filter((r) => r.event === "launch").length, 1);
  } finally {
    globalThis.fetch = fetcher;
    await s.cleanup();
  }
});

test("Kimi native final: cancellation before provider final leaves no publication", async () => {
  const s = await kimiNativeFinalHarness();
  const controller = new AbortController();
  let running: Promise<void> | undefined;
  try {
    s.post("[fake:hang] cancel");
    running = s.agentHost.run({ signal: controller.signal });
    await waitFor(
      () => s.records().some((r) => r.event === "prompt"),
      "native prompt",
    );
    controller.abort();
    await running;
    assert.equal(sql(s, "SELECT * FROM run_attempt_final_replies").length, 0);
    assert.equal(
      sql(s, "SELECT * FROM messages WHERE actor_id=?", s.participantId).length,
      0,
    );
    assert.equal(s.credentialEvents.at(-1), "revoked");
  } finally {
    controller.abort();
    await running;
    await s.cleanup();
  }
});

test("Kimi native final: cancel after provider exit aborts settlement before HTTP publication", async () => {
  const s = await kimiNativeFinalHarness();
  const fetcher = globalThis.fetch;
  let cancel: ReturnType<typeof s.runtime.cancel> | undefined;
  let settlements = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/v1/worker/messages/final-output")) {
      settlements++;
      assert.ok(s.records().some((r) => r.event === "completed"));
      assert.ok(s.handles.at(-1));
      cancel = s.runtime.cancel(s.handles.at(-1)!);
      assert.equal(init?.signal?.aborted, true);
    }
    return fetcher(url, init);
  };
  try {
    s.post("cancel at settlement");
    await s.agentHost.reconcileOnce();
    await cancel;
    assert.equal(settlements, 1);
    assert.equal(sql(s, "SELECT * FROM run_attempt_final_replies").length, 0);
    assert.equal(
      sql(s, "SELECT * FROM messages WHERE actor_id=?", s.participantId).length,
      0,
    );
    assert.equal(s.credentialEvents.at(-1), "revoked");
  } finally {
    globalThis.fetch = fetcher;
    await cancel;
    await s.cleanup();
  }
});

for (const fallback of ["disabled", "task"] as const) {
  test(`Kimi native final: ${fallback} retains Worker-only completion authority`, async () => {
    const s = await kimiNativeFinalHarness({
      nativeFinalText: fallback !== "disabled",
    });
    try {
      if (fallback === "task")
        s.kernel.createTask(s.actor, {
          assigneeId: s.participantId,
          idempotencyKey: "kimi-task",
          reviewerIds: [],
          roomId: s.roomId,
          title: "explicit work remains open",
        });
      else s.post("normal native text with trial disabled");
      // This fixture deliberately does not perform the fallback Worker ACK.
      assert.equal((await s.agentHost.reconcileOnce()).state, "failed");
      assert.equal(sql(s, "SELECT * FROM run_attempt_final_replies").length, 0);
      assert.equal(
        sql(s, "SELECT * FROM messages WHERE actor_id=?", s.participantId)
          .length,
        0,
      );
      const prompt = s.records().find((r) => r.event === "prompt");
      assert.doesNotMatch(
        String(prompt?.text),
        /Reply transport: native-final-text/,
      );
      if (fallback === "task")
        assert.equal(sql(s, "SELECT state FROM tasks")[0]?.state, "todo");
    } finally {
      await s.cleanup();
    }
  });
}
