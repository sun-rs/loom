import assert from "node:assert/strict";
import test from "node:test";
import { harness, sql, starts, turns } from "./claude-warm-test-harness.ts";

for (const scenario of ["truncated window"] as const) {
  test(`native trial: ${scenario} retains Worker delivery, then next eligible turn publishes natively in the same session`, async () => {
    const state = await harness({ nativeFinalText: true });
    const originalFetch = globalThis.fetch;
    let publications = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("/v1/worker/messages/final-output"))
        publications++;
      return originalFetch(input, init);
    };
    try {
      for (let i = 0; i < 25; i++) state.post(`[fake:ack] message ${i}`);
      const result = await state.current.agentHost.reconcileOnce();
      assert.equal(result.state, "completed", JSON.stringify(result));
      assert.equal(publications, 0, "unselected native mode never submits");
      assert.equal(
        sql(state, "SELECT * FROM run_attempt_final_replies").length,
        0,
      );
      assert.equal(
        sql(
          state,
          "SELECT * FROM activation_retry_fences WHERE retry_disposition='action_required'",
        ).length,
        0,
      );
      assert.doesNotMatch(
        String(turns(state)[0]?.text),
        /Reply transport: native-final-text/,
      );
      assert.match(String(turns(state)[0]?.text), /not shown|Shown through/);

      state.post("[fake:native-final] next eligible message");
      const next = await state.current.agentHost.reconcileOnce();
      assert.equal(next.state, "completed", JSON.stringify(next));
      assert.equal(publications, 1);
      assert.equal(
        sql(
          state,
          "SELECT * FROM run_attempt_final_replies WHERE submission_kind='final-output'",
        ).length,
        1,
      );
      assert.equal(starts(state).length, 1);
      assert.equal(turns(state).length, 2);
    } finally {
      globalThis.fetch = originalFetch;
      await state.cleanup();
    }
  });
}

for (const nativeFinalText of [false, true]) {
  test(`Task wake retains business refusal after ACK, without a native-final transport failure (trial=${nativeFinalText})`, async () => {
    const state = await harness({ nativeFinalText });
    const originalFetch = globalThis.fetch;
    let publications = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("/v1/worker/messages/final-output"))
        publications++;
      return originalFetch(input, init);
    };
    try {
      state.kernel.createTask(state.actor, {
        assigneeId: state.participantId,
        idempotencyKey: "task-fallback",
        reviewerIds: [],
        roomId: state.roomId,
        title: "[fake:ack] Explicit work stays open",
      });
      const result = await state.current.agentHost.reconcileOnce();
      assert.equal(
        result.state,
        "failed",
        "ACK alone never completes assigned work",
      );
      assert.match(JSON.stringify(result), /task|obligation/i);
      assert.doesNotMatch(JSON.stringify(result), /Final output was not/);
      assert.equal(publications, 0);
      assert.doesNotMatch(
        String(turns(state)[0]?.text),
        /Reply transport: native-final-text/,
      );
      assert.equal(
        sql(state, "SELECT * FROM run_attempt_final_replies").length,
        0,
      );
      assert.equal(sql(state, "SELECT state FROM tasks")[0]?.state, "todo");
    } finally {
      globalThis.fetch = originalFetch;
      await state.cleanup();
    }
  });
}
