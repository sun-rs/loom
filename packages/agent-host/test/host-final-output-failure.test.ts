import assert from "node:assert/strict";
import test from "node:test";
import { roleInstanceFixture } from "../../kernel/test/role-instance-fixture.ts";
import { AgentHost, FakeRuntimeAdapter } from "../src/index.ts";
import { createKernelAgentHostControlPort } from "../src/agent-host-control.ts";
import type { RunExit } from "../src/runtime.ts";

const wait = async (_ms: number, signal: AbortSignal) => {
  if (signal.aborted) return;
  await new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
};
for (const mode of [
  "failure",
  "timeout",
  "reap-failed",
  "maintenance",
  "startup",
] as const)
  test(`final output unknown cannot automatically rerun after ${mode}, including unavailable marker evidence`, async () => {
    const f = roleInstanceFixture();
    try {
      f.kernel.postMessage(f.actor, {
        roomId: f.home.roomId,
        body: "review",
        idempotencyKey: "wake",
        recipients: [
          { participantId: f.instance.instanceId, reason: "mention" },
        ],
      });
      const exit: RunExit = {
        code: 1,
        finalOutput: {
          state: "unknown",
          detail: "FAKE lost publication response",
        },
      };
      let reaping = false;
      const runtime = Object.assign(
        new FakeRuntimeAdapter({
          onStart: () => {
            if (mode === "startup") throw Error("FAKE post-start failure");
          },
          onReap: async () => {
            reaping = true;
            if (mode === "failure") return exit;
            if (mode === "reap-failed") throw Error("FAKE reap failure");
            return await new Promise<RunExit>(() => {});
          },
          onCancel: () => exit,
        }),
        { isAlive: async () => false },
      );
      const control = { ...createKernelAgentHostControlPort(f.kernel, f.host) };
      control.readFinalReply = async () => {
        throw Error("FAKE marker unavailable");
      };
      if (mode === "maintenance") {
        const renew = control.renewActivationLease;
        control.renewActivationLease = async (input) => {
          if (reaping) throw Error("FAKE renew failure");
          return renew(input);
        };
      }
      const host = new AgentHost({
        control,
        host: f.host,
        runtime,
        leaseMs: 30000,
        maintenanceWait: mode === "maintenance" ? async () => {} : wait,
        timeoutWait: mode === "timeout" ? async () => {} : wait,
      });
      const result = await host.reconcileOnce();
      assert.equal(result.state, "failed");
      assert.equal(
        f.kernel.listActivations({ roomId: f.home.roomId })[0]?.state,
        "quarantined",
      );
      const run = f.kernel.listRunAttempts({ roomId: f.home.roomId })[0]!;
      assert.equal(
        run.state,
        mode === "timeout"
          ? "timed_out"
          : mode === "failure"
            ? "exited"
            : "failed",
      );
      assert.equal(runtime.starts.length, 1);
      await host.reconcileOnce();
      assert.equal(runtime.starts.length, 1);
    } finally {
      f.close();
    }
  });
