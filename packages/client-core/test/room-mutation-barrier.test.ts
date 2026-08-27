import assert from "node:assert/strict";
import test from "node:test";

import { RahClientError } from "@rah-os/client-sdk";

import { runRoomMutationAtLatest } from "../src/index.ts";

test("runRoomMutationAtLatest catches up and retries only a stale causal write", async () => {
  const sequences = [21, 23];
  const attempted: number[] = [];
  const result = await runRoomMutationAtLatest({
    mutate: async (basedOnRoomSeq) => {
      attempted.push(basedOnRoomSeq);
      if (attempted.length === 1) {
        throw new RahClientError("stale_context", "concurrent event", 409);
      }
      return "committed";
    },
    session: {
      syncUntilCurrent: async () => ({
        caughtUp: true,
        state: { latestRoomSeq: sequences.shift() ?? 23 },
      }),
    },
  });

  assert.equal(result, "committed");
  assert.deepEqual(attempted, [21, 23]);
});

test("runRoomMutationAtLatest preserves non-stale failures", async () => {
  const failure = new RahClientError("forbidden", "no", 403);
  let attempts = 0;
  await assert.rejects(
    runRoomMutationAtLatest({
      mutate: async () => {
        attempts += 1;
        throw failure;
      },
      session: {
        syncUntilCurrent: async () => ({
          caughtUp: true,
          state: { latestRoomSeq: 9 },
        }),
      },
    }),
    (caught) => caught === failure,
  );
  assert.equal(attempts, 1);
});

test("runRoomMutationAtLatest refuses a partial causal projection", async () => {
  await assert.rejects(
    runRoomMutationAtLatest({
      mutate: async () => "must not run",
      session: {
        syncUntilCurrent: async () => ({
          caughtUp: false,
          state: { latestRoomSeq: 12 },
        }),
      },
    }),
    /Room mutation requires a complete causal projection/u,
  );
});
