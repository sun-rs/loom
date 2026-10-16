import test from "node:test";
import assert from "node:assert/strict";
import { entitySources } from "../../frontends/raft/loom/search-entities.ts";
test("entity catalog admits accessible channels and live instances, never role definitions or Side boxes", () => {
  const rooms = [
    { roomId: "c", kind: "channel", name: "Channel" },
    { roomId: "box", kind: "direct", instancePrivateBox: { instanceId: "i" } },
    {
      roomId: "side",
      kind: "direct",
      instancePrivateBox: { instanceId: "i" },
      side: {},
    },
  ];
  const instances = [
    { instanceId: "i", agentId: "a", channelId: "c" },
    { instanceId: "gone", agentId: "b", channelId: "c" },
    { instanceId: "foreign", agentId: "f", channelId: "hidden" },
  ];
  const agents = [
    {
      definition: { agentId: "a", state: "disabled" },
      currentRevision: { displayName: "Frozen Tom" },
      handle: "tom-1",
    },
    {
      definition: { agentId: "b", state: "tombstoned" },
      currentRevision: { displayName: "Removed" },
      handle: "gone",
    },
    {
      definition: { agentId: "f", state: "enabled" },
      currentRevision: { displayName: "Hidden" },
      handle: "hidden",
    },
  ];
  const result = entitySources({ rooms, instances, agents } as never);
  assert.deepEqual(
    result.channels.map((c) => c.id),
    ["c"],
  );
  assert.deepEqual(
    result.agents.map((a) => [a.id, a.displayName]),
    [["i", "Frozen Tom"]],
  );
  assert.deepEqual(
    result.dmChannels.map((c) => c.id),
    ["box"],
  );
});
