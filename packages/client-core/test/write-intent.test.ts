import assert from "node:assert/strict";
import test from "node:test";
import { WriteIntentSlot } from "../src/write-intent.ts";

test("shared write intent never automatically resends an unknown message; explicit verification keeps the frozen request", async () => {
  const slot = new WriteIntentSlot();
  const requests: unknown[] = [];
  const payload = { body: "original" };
  const result = await slot.submit({
    action: "message",
    payload,
    session: {
      syncUntilCurrent: async () => ({
        caughtUp: true,
        state: { latestRoomSeq: 7 },
      }),
    },
    send: async (body, seq, key) => {
      requests.push({ body, seq, key });
      if (requests.length === 1) throw new Error("response lost after commit");
      return { deduplicated: true };
    },
  });
  payload.body = "edited";
  assert.equal(result.kind, "unknown");
  assert.equal(requests.length, 1);
  assert.equal(slot.state, "unknown");
  assert.equal((await slot.retry()).kind, "ok");
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(slot.state, "idle");
});
