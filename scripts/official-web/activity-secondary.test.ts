import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareActivityMute,
  changeActivityFollow,
} from "../../frontends/raft/loom/activity-secondary.ts";
test("mute reads current preferences and undo refuses changed versions", async () => {
  const client: any = {
    request: async () => ({
      preferences: { version: 8, mutedActivity: ["room:other"] },
    }),
  };
  assert.deepEqual(await prepareActivityMute(client, "w", "r", true), {
    expectedVersion: 8,
    patch: { mutedActivity: ["room:other", "room:r"] },
  });
  await assert.rejects(
    () => prepareActivityMute(client, "w", "r", false, 7),
    /变化/,
  );
  assert.equal(
    await prepareActivityMute(client, "w", "other", true),
    undefined,
  );
});
test("follow actions refresh first and retain the accepted frontier without retrying", async () => {
  const calls: any[] = [];
  const client: any = {
    request: async (op: any, arg: any) => {
      calls.push([op, arg]);
      return { following: op === "thread.followers" };
    },
  };
  assert.equal(await changeActivityFollow(client, "r", "t", false, 42), true);
  assert.equal(calls[0][0], "thread.followers");
  assert.deepEqual(calls[1], [
    "activity.follow",
    { roomId: "r", threadId: "t", following: false, retainThroughSeq: 42 },
  ]);
});
import { readFileSync } from "node:fs";
test("secondary actions use durable projection, original recipes and shared unresolved-write UI", () => {
  const read = (name: string) =>
    readFileSync("frontends/raft/loom/" + name, "utf8");
  assert.match(read("discovery-client.ts"), /isFollowing: item.isFollowing/);
  assert.match(read("DiscoveryPage.tsx"), /row.isFollowing === true/);
  assert.match(read("DiscoveryPage.tsx"), /entities.mutedActivity.includes/);
  assert.match(
    read("DiscoveryPage.tsx"),
    /pendingRows.has\(row.id\) \|\| secondary.busy/,
  );
  assert.match(read("DiscoveryPage.tsx"), /<OperationStatus/);
  assert.match(read("ActivityMessageRow.tsx"), /swipeSecondaryClass/);
  assert.match(read("useActivitySecondary.ts"), /manager.sidebar/);
  assert.match(read("useActivitySecondary.ts"), /saved.preferences.version/);
  assert.match(read("useActivitySecondary.ts"), /hasUnresolvedIntents/);
});
test("failed unfollow is read back once and never resent", async () => {
  const calls: string[] = [];
  const client: any = {
    request: async (op: string) => {
      calls.push(op);
      if (op === "activity.follow") throw Error("network");
      return { following: true };
    },
  };
  await assert.rejects(
    () => changeActivityFollow(client, "r", "t", false, 42),
    /未确认/,
  );
  assert.deepEqual(calls, [
    "thread.followers",
    "activity.follow",
    "thread.followers",
  ]);
});
test("leaving the action owner during initial read prevents a later follow write", async () => {
  const calls: string[] = [];
  const client: any = {
    request: async (op: string) => {
      calls.push(op);
      return { following: true };
    },
  };
  assert.equal(
    await changeActivityFollow(client, "r", "t", false, 42, () => false),
    false,
  );
  assert.deepEqual(calls, ["thread.followers"]);
});
