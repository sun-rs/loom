import test from "node:test";
import assert from "node:assert/strict";
import { ReactionClient } from "../../frontends/raft/loom/reaction-client.ts";
test("reaction reads are bounded and writes preserve explicit active intent on exact verification", async () => {
  const calls: any[] = [];
  let fail = true;
  const client: any = {
    request: async (op: string, input: any) => {
      calls.push([op, input]);
      if (op === "message.social") return { items: [] };
      if (fail) {
        fail = false;
        throw Error("lost");
      }
      return {
        messageId: "m",
        version: 2,
        reactions: [],
        saved: false,
        canReact: true,
      };
    },
  };
  const session: any = {
    syncUntilCurrent: async () => ({
      caughtUp: true,
      state: { latestRoomSeq: 7 },
    }),
  };
  // Use the shared mutation barrier contract, no new Room cursor.
  const bridge: any = { client, roomId: "r", room: session };
  const { WriteIntentSlot } = await import("@rah-os/client-core/write-intent");
  bridge.writes = new WriteIntentSlot();
  const owner = new ReactionClient(bridge);
  await owner.read(Array.from({ length: 205 }, (_, i) => "m" + i));
  assert.deepEqual(
    calls.map((c) => c[1].messageIds.length),
    [100, 100, 5],
  );
  await owner.set("m", "👍", true, () => {});
  assert.equal(bridge.writes.state, "unknown");
  const first = calls.at(-1);
  assert.equal(first[1].active, true);
  await bridge.writes.retry();
  assert.deepEqual(calls.at(-1), first);
  bridge.writes.discard();
});
import { readFileSync } from "node:fs";
import {
  adaptReactions,
  adaptReactionToolbar,
} from "../../frontends/raft/loom/reaction-adaptation.ts";
import { adaptTaskMessage } from "../../frontends/raft/loom/channel-task-adaptation.ts";
import { adaptThreadItem } from "../../frontends/raft/loom/thread-adaptation.ts";
test("reaction adapter preserves native quick row and toolbar rules without exposing sharing or bookmarks", () => {
  const original = readFileSync(
    "frontends/raft/packages/web/src/components/message/MessageItem.tsx",
    "utf8",
  );
  const adapted = adaptReactions(adaptTaskMessage(adaptThreadItem(original)));
  assert.ok(adapted.includes("loomReactions?.toggle(emoji)"));
  const start = original.indexOf("          {/* Reaction quick row");
  const end = original.indexOf(
    "          <MenuItem\n            icon={<Link",
    start,
  );
  assert.equal(adapted.split(original.slice(start, end)).length, 3);
  const toolbar = readFileSync(
    "frontends/raft/packages/web/src/components/message/MessageHoverToolbar.tsx",
    "utf8",
  );
  assert.ok(adaptReactionToolbar(toolbar).includes("{!loomHideSave &&"));
  assert.throws(() => adaptReactions("drift"));
});
