import assert from "node:assert/strict";
import test from "node:test";

import { ReminderReconciler } from "../src/index.ts";

test("Reminder reconciler retries after an isolated failure and stops on abort", async () => {
  const abort = new AbortController();
  const failures: unknown[] = [];
  const results: number[] = [];
  let attempts = 0;
  const reconciler = new ReminderReconciler({
    onError: (error) => failures.push(error),
    onResult: (result) => results.push(result.delivered),
    pollIntervalMs: 1,
    reconcile: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary reminder failure");
      abort.abort();
      return { delivered: 1, exhausted: 0, pending: 0, staged: 1 };
    },
    wait: async () => undefined,
  });

  await reconciler.run({ signal: abort.signal });

  assert.equal(attempts, 2);
  assert.equal(failures.length, 1);
  assert.deepEqual(results, [1]);
  assert.match(String(failures[0]), /temporary reminder failure/);
});
