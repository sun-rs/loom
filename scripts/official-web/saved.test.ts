import test from "node:test";
import assert from "node:assert/strict";
import { ReactionClient } from "../../frontends/raft/loom/reaction-client.ts";
import { WriteIntentSlot } from "@rah-os/client-core/write-intent";
test("bookmark verification retains exact saved intent and idempotency key without Room mutation basis", async () => {
  const calls: any[] = [];
  let lost = true;
  const writes = new WriteIntentSlot();
  const owner = new ReactionClient({
    writes,
    roomId: "r",
    client: {
      request: async (op: string, input: any) => {
        calls.push([op, input]);
        if (lost) {
          lost = false;
          throw Error("lost");
        }
        return { messageId: "m", version: 1, saved: true, reactions: [] };
      },
    },
  } as any);
  await owner.save("m", true, () => {});
  assert.equal(writes.state, "unknown");
  await writes.retry();
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0][0], "message.save");
  assert.equal(calls[0][1].saved, true);
  assert.equal("basedOnRoomSeq" in calls[0][1], false);
  writes.discard();
});
import { readFileSync } from "node:fs";
test("saved panel adopts Web1.21.38 ListRow recipe while retaining scroll threshold and sidebar count owner", () => {
  // SavedPanel-B78TItCT.js now delegates row geometry/seams to native ListRow.
  // The unchanged original TSX and earlier resource remain historical sources.
  const local = readFileSync("frontends/raft/loom/SavedPanel.tsx", "utf8");
  for (const token of [
    "<ListRow",
    'variant="plain"',
    "flex-1 overflow-y-auto bg-layer-panel py-1 safe-bottom",
    "240px 0px",
    "saved-list-scroller",
  ]) {
    assert.ok(local.includes(token));
  }
  assert.ok(!local.includes("[[data-saved-row]+&]:before:block"));
  assert.ok(!local.includes("useSavedStore("));
  const nav = readFileSync("frontends/raft/loom/SavedNav.tsx", "utf8");
  assert.ok(nav.includes("setTotal(result.globalTotal)"));
  assert.ok(nav.includes("<SavedNavCount total={total}"));
});
