import test from "node:test";
import assert from "node:assert/strict";
import {
  computerInstanceRows,
  visibleComputerInstances,
} from "../../frontends/raft/loom/computer-instance-list.ts";
test("computer rows use instance model and identity, not the latest Role configuration", () => {
  const runtimes: any = [
    {
      displayName: "Codex CLI",
      agentBindings: [{ agentId: "a", participantId: "i", handle: "Tom-1" }],
      modelBindingDescriptors: [
        { modelBindingId: "b", displayName: "Model B" },
      ],
    },
  ];
  const instances: any = [{ instanceId: "i", agentId: "a", roleId: "r" }];
  const agents: any = [
    {
      definition: { agentId: "a", state: "disabled" },
      handle: "Tom-1",
      currentRevision: { displayName: "Frozen Tom-1", avatarKey: "pixel:1" },
      modelBindingId: "b",
    },
  ];
  const rows = computerInstanceRows(runtimes, instances, agents);
  assert.equal(rows[0].name, "Frozen Tom-1");
  assert.equal(rows[0].subtitle, "Codex CLI · Model B");
  assert.equal(rows[0].stateLabel, "离线");
  agents[0].modelBindingId = "unknown";
  assert.equal(
    computerInstanceRows(runtimes, instances, agents)[0].subtitle,
    "Codex CLI · unknown",
  );
});
test("computer list defaults to six and expands without losing order or identity", () => {
  const rows = Array.from({ length: 9 }, (_, id) => ({ id }));
  assert.deepEqual(visibleComputerInstances(rows, false), rows.slice(0, 6));
  assert.deepEqual(visibleComputerInstances(rows, true), rows);
  assert.deepEqual(visibleComputerInstances([], false), []);
});
test("computer status reflects observed presence, never enabled configuration", () => {
  const runtimes: any = [
    {
      agentBindings: [{ agentId: "a", participantId: "i", handle: "Tom" }],
      modelBindingDescriptors: [],
    },
  ];
  const instances: any = [{ instanceId: "i", agentId: "a", roleId: "r" }];
  const agents: any = [
    { definition: { agentId: "a", state: "enabled" }, currentRevision: {} },
  ];
  assert.equal(
    computerInstanceRows(runtimes, instances, agents)[0].stateLabel,
    "状态未知",
  );
  for (const [activity, label] of [
    ["online", "在线"],
    ["offline", "离线"],
    ["working", "工作中"],
    ["error", "异常"],
  ]) {
    assert.equal(
      computerInstanceRows(runtimes, instances, agents, [
        { agentId: "a", activity, reason: "online" },
      ] as any)[0].stateLabel,
      label,
    );
  }
});
