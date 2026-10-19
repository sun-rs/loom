import test from "node:test";
import assert from "node:assert/strict";
import { activityPeerType } from "../../frontends/raft/loom/activity-peer.ts";
test("activity reads the catalog suggestion payload and identifies the DM peer, not the latest author", () => {
  const entries = [
    { suggestion: { channelId: "box", agentId: "tom", userId: null } },
  ];
  assert.equal(activityPeerType(entries, "box"), "agent");
  assert.equal(activityPeerType(entries, "unknown"), undefined);
  assert.equal(
    activityPeerType(
      [{ suggestion: { channelId: "self", agentId: null, userId: "human" } }],
      "self",
    ),
    "user",
  );
});
