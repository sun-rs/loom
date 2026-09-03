import assert from "node:assert/strict";
import test from "node:test";

import { RoomFileGcReconciler } from "../src/room-file-gc-reconciler.ts";

test("Room file GC reconciler survives an isolated sweep failure and stops on abort", async () => {
  const abort = new AbortController();
  const errors: unknown[] = [];
  const results: number[] = [];
  let attempts = 0;
  const reconciler = new RoomFileGcReconciler({
    onError: (error) => errors.push(error),
    onResult: (result) => results.push(result.attempted),
    pollIntervalMs: 1,
    reconcile: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary GC failure");
      abort.abort();
      return {
        attempted: 1,
        failed: 0,
        outstandingFailures: 0,
        reclaimed: 1,
        remainingDue: 0,
      };
    },
    wait: async () => undefined,
  });

  await reconciler.run({ signal: abort.signal });

  assert.equal(attempts, 2);
  assert.equal(errors.length, 1);
  assert.deepEqual(results, [1]);
  assert.match(String(errors[0]), /temporary GC failure/);
});
