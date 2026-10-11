import assert from "node:assert/strict";
import test from "node:test";
import {
  kimiNativeFinalHarness,
  sql,
  waitFor,
} from "./kimi-native-final-test-harness.ts";

for (const code of [0, 7]) {
  test(`Kimi waits for delayed actual native exit ${code} after EOF`, async () => {
    const s = await kimiNativeFinalHarness({
      env: {
        FAKE_KIMI_EOF_DELAY_MS: "800",
        FAKE_KIMI_EXIT_CODE: String(code),
      },
    });
    try {
      s.post("delayed native shutdown");
      const result = await s.agentHost.reconcileOnce();
      assert.equal(result.state, code === 0 ? "completed" : "failed");
      assert.equal(
        s.records().some((r) => r.event === "terminated"),
        false,
      );
      assert.equal(
        s.records().find((r) => r.event === "native-exit")?.code,
        code,
      );
      assert.equal(
        sql(s, "SELECT * FROM run_attempt_final_replies").length,
        code === 0 ? 1 : 0,
      );
    } finally {
      await s.cleanup();
    }
  });
}

for (const ignoreTerm of ["0", "1"]) {
  test(`Kimi EOF timeout refuses publication even when TERM ${ignoreTerm === "0" ? "exits zero" : "is ignored"}`, async () => {
    const s = await kimiNativeFinalHarness({
      env: {
        FAKE_KIMI_EOF_DELAY_MS: "60000",
        FAKE_KIMI_IGNORE_TERM: ignoreTerm,
      },
    });
    try {
      s.post("shutdown must be bounded");
      assert.equal((await s.agentHost.reconcileOnce()).state, "failed");
      assert.equal(
        s.records().some((r) => r.event === "terminated"),
        true,
      );
      assert.equal(
        s.records().some((r) => r.event === "native-exit"),
        false,
      );
      assert.equal(sql(s, "SELECT * FROM run_attempt_final_replies").length, 0);
    } finally {
      await s.cleanup();
    }
  });
}

test("Kimi cancellation during EOF drain never publishes a native final", async () => {
  const s = await kimiNativeFinalHarness({
    env: { FAKE_KIMI_EOF_DELAY_MS: "3000" },
  });
  const controller = new AbortController();
  let running: Promise<void> | undefined;
  try {
    s.post("cancel after final before exit");
    running = s.agentHost.run({ signal: controller.signal });
    await waitFor(
      () => s.records().some((r) => r.event === "eof"),
      "native EOF",
    );
    controller.abort();
    await running;
    assert.equal(sql(s, "SELECT * FROM run_attempt_final_replies").length, 0);
    assert.equal(
      s.records().some((r) => r.event === "native-exit"),
      false,
    );
  } finally {
    controller.abort();
    await running;
    await s.cleanup();
  }
});

test("Kimi clean delayed exit cannot rescue a tool without terminal status", async () => {
  const s = await kimiNativeFinalHarness({
    env: {
      FAKE_KIMI_EOF_DELAY_MS: "800",
      FAKE_KIMI_PENDING_TOOL: "1",
    },
  });
  try {
    s.post("unfinished tool forbids final");
    assert.equal((await s.agentHost.reconcileOnce()).state, "failed");
    assert.equal(s.records().find((r) => r.event === "native-exit")?.code, 0);
    assert.equal(sql(s, "SELECT * FROM run_attempt_final_replies").length, 0);
  } finally {
    await s.cleanup();
  }
});
