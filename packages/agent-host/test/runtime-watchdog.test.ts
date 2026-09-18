import assert from "node:assert/strict";
import test from "node:test";
import { FakeRuntimeAdapter } from "../src/fake-runtime.ts";
import { watchRuntimeLiveness } from "../src/runtime-watchdog.ts";

for (const probe of ["missing", "failed", "dead", "late"])
  test(`runtime watchdog handles ${probe} liveness without claiming termination`, async () => {
    const abort = new AbortController();
    const runtime = Object.assign(
      new FakeRuntimeAdapter(),
      probe === "missing"
        ? {}
        : {
            isAlive: async () => {
              if (probe === "failed") throw new Error("control unavailable");
              if (probe === "late") abort.abort();
              return false;
            },
          },
    );
    const outcome = await watchRuntimeLiveness({
      runtime,
      run: { runId: "owned" },
      intervalMs: 100,
      signal: abort.signal,
      wait: async () => {},
    });
    assert.equal(outcome.kind, probe === "late" ? "stopped" : "timeout");
    assert.equal(
      runtime.cancellations.length,
      0,
      "Host still owns cancel and terminal proof",
    );
  });

test("stopping the watchdog never probes a completed runtime", async () => {
  const abort = new AbortController();
  const runtime = Object.assign(new FakeRuntimeAdapter(), {
    isAlive: async () => {
      assert.fail("late probe");
    },
  });
  assert.deepEqual(
    await watchRuntimeLiveness({
      runtime,
      run: { runId: "done" },
      intervalMs: 100,
      signal: abort.signal,
      wait: async () => {
        abort.abort();
      },
    }),
    { kind: "stopped" },
  );
});
