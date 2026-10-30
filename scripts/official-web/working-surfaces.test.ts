import test from "node:test";
import assert from "node:assert/strict";
import {
  projectWorkingInstances,
  instanceActivity,
} from "../../frontends/raft/loom/working-state.ts";

test("working UI joins observed definition IDs to instance principals; enabled membership alone is not work", () => {
  const agents = [
    {
      instanceChannelId: "channel-a",
      definition: { agentId: "definition-a", participantId: "instance-a" },
      currentRevision: { displayName: "Alice-1", avatarKey: "pixel:test" },
    },
    {
      instanceChannelId: "channel-b",
      definition: { agentId: "definition-b", participantId: "instance-b" },
      currentRevision: { displayName: "Bob-1" },
    },
  ] as any;
  const observations = [
    { agentId: "definition-a", activity: "thinking", reason: "thinking" },
    { agentId: "definition-b", activity: "online", reason: "idle" },
    { agentId: "unresolved", activity: "working", reason: "working" },
  ] as any;
  assert.deepEqual(projectWorkingInstances(agents, observations), [
    {
      agentId: "instance-a",
      agentName: "Alice-1",
      agentAvatarUrl: "pixel:test",
      activity: "thinking",
      text: "思考中…",
    },
  ]);
  assert.equal(
    instanceActivity("instance-a", agents, observations),
    "thinking",
  );
  assert.equal(instanceActivity("instance-b", agents, observations), "online");
  assert.equal(instanceActivity("missing", agents, observations), undefined);
  assert.deepEqual(
    projectWorkingInstances(agents, [
      { agentId: "definition-a", activity: "offline", reason: "host_offline" },
    ] as any),
    [],
  );
  assert.deepEqual(projectWorkingInstances(agents, []), []);
});

test("all busy instances are retained, including several instances of the same Role", () => {
  const catalog = Array.from({ length: 4 }, (_, i) => ({
    definition: { agentId: `definition-${i}`, participantId: `instance-${i}` },
    handle: `Tom-${i}`,
    currentRevision: { displayName: `Tom-${i}` },
  })) as any;
  for (const a of catalog) a.instanceChannelId = "channel-a";
  const presence = catalog.map((a) => ({
    agentId: a.definition.agentId,
    activity: "working",
    reason: "working",
  })) as any;
  assert.deepEqual(
    projectWorkingInstances(catalog, presence).map((a) => a.agentId),
    ["instance-0", "instance-1", "instance-2", "instance-3"],
  );
});

test("legacy catalog entries without a verified instance Channel never become inert working targets", () => {
  assert.deepEqual(
    projectWorkingInstances(
      [
        {
          definition: { agentId: "legacy", participantId: "persona" },
          currentRevision: { displayName: "Legacy" },
        },
      ] as any,
      [{ agentId: "legacy", activity: "working", reason: "working" }] as any,
    ),
    [],
  );
});
