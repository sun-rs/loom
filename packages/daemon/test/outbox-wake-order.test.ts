import assert from "node:assert/strict";
import test from "node:test";
import type { RoomKernel } from "@rah-os/core";
import { createOutboxDispatcherRunners } from "../src/outbox-wake-dispatcher.ts";

for (const failFirstRefresh of [false, true]) {
  test(`activation hint publishes fresh mounts before waking, refresh retry=${failFirstRefresh}`, async () => {
    const stop = new AbortController();
    const calls: string[] = [];
    let attempts = 0;
    let mounted = false;
    const kernel = {
      leaseNextOutbox: () => ({ outboxId: "activation", payload: {} }),
      acknowledgeOutboxPublished: () => {
        calls.push("ack");
        stop.abort();
      },
      retryOutbox: () => calls.push("retry"),
    } as unknown as RoomKernel;
    const [run] = createOutboxDispatcherRunners({
      config: {
        outboxLeaseMs: 5000,
        outboxPollIntervalMs: 250,
        outboxRetryAfterMs: 1000,
      },
      host: { hostId: "host", instanceId: "host-instance" },
      kernel,
      // No warm pool or prewarm hint is needed for a cold first turn.
      runner: undefined,
      publishers: [
        {
          refreshWorkspaceMounts: async () => {
            calls.push("refresh");
            if (failFirstRefresh && attempts++ === 0)
              throw new Error("mount unavailable");
          },
          publishAvailable: () => {
            calls.push("offer");
            mounted = true;
            return true;
          },
        },
      ],
      wakeSignal: {
        publish: () => {
          calls.push(mounted ? "claimable-wake" : "unplaceable-wake");
        },
      },
    });
    await run!(stop.signal);
    assert.deepEqual(calls, [
      ...(failFirstRefresh ? ["refresh", "retry"] : []),
      "refresh",
      "offer",
      "claimable-wake",
      "ack",
    ]);
  });
}
