import assert from "node:assert/strict";
import test from "node:test";
import { FakeRuntimeAdapter } from "../src/fake-runtime.ts";
import { resolveRuntimeDeliveryMode } from "../src/runtime.ts";

test("delivery requires a classified supported transport and enabled Guide", () => {
  for (const busyInputMode of ["direct", "gated"] as const) {
    const runtime = Object.assign(new FakeRuntimeAdapter(), {
      busyInputMode,
      busyInputSupported: true,
      notifyBusy: async () => true,
    });
    assert.equal(resolveRuntimeDeliveryMode(runtime, true), busyInputMode);
    assert.equal(resolveRuntimeDeliveryMode(runtime, false), "wait");
    runtime.busyInputSupported = false;
    assert.equal(resolveRuntimeDeliveryMode(runtime, true), "wait");
  }
  assert.equal(
    resolveRuntimeDeliveryMode(new FakeRuntimeAdapter(), true),
    "wait",
  );
  assert.equal(
    resolveRuntimeDeliveryMode(
      Object.assign(new FakeRuntimeAdapter(), {
        busyInputSupported: true,
        notifyBusy: async () => true,
      }),
      true,
    ),
    "wait",
    "unknown delivery mode cannot silently opt into injection",
  );
});
