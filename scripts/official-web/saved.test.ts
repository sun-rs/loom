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
test("saved panel retains official card proportions, scroll threshold and sidebar count owner", () => {
  const official = readFileSync(
    "frontends/raft/packages/web/src/components/saved/SavedPanel.tsx",
    "utf8",
  );
  const local = readFileSync("frontends/raft/loom/SavedPanel.tsx", "utf8");
  for (const token of [
    "relative flex flex-row items-center gap-3 transition-colors p-3 text-left w-full shadow-none border-line-muted   bg-layer-panel  hover:bg-fill-muted data-[popup-open]:bg-fill-muted",
    "flex-1 overflow-y-auto bg-layer-canvas-muted p-4 safe-bottom ",
    "240px 0px",
    "saved-list-scroller",
  ]) {
    assert.ok(official.includes(token));
    assert.ok(local.includes(token));
  }
  assert.ok(!local.includes("useSavedStore("));
  const nav = readFileSync("frontends/raft/loom/SavedNav.tsx", "utf8");
  assert.ok(nav.includes("setTotal(result.globalTotal)"));
  assert.ok(nav.includes("<SavedNavCount total={total}"));
});
