import assert from "node:assert/strict";
import test from "node:test";

import { ProfileImageGcReconciler } from "../src/profile-image-gc-reconciler.ts";

test("profile image GC reconciler survives one failed sweep and stops on abort", async () => {
  const controller = new AbortController();
  const errors: string[] = [];
  const results: number[] = [];
  let attempts = 0;
  const reconciler = new ProfileImageGcReconciler({
    onError: (error) =>
      errors.push(error instanceof Error ? error.message : String(error)),
    onResult: (result) => results.push(result.reclaimed),
    pollIntervalMs: 10,
    reconcile: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary database failure");
      return { attempted: 1, failed: 0, reclaimed: 1, remainingDue: 0 };
    },
    wait: async (_delayMs, signal) => {
      if (attempts >= 2) controller.abort();
      if (!signal.aborted) await Promise.resolve();
    },
  });

  await reconciler.run({ signal: controller.signal });
  assert.equal(attempts, 2);
  assert.deepEqual(errors, ["temporary database failure"]);
  assert.deepEqual(results, [1]);
});
