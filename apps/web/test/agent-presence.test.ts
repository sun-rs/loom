import assert from "node:assert/strict";
import test from "node:test";
import { agentPresencePresentation } from "../src/attention-presentation.ts";

test("avatars consume full presence, not CLI installation or an old timeline row", () => {
  const agent = {
    state: "enabled",
    runtimeAvailable: true,
    connectionStatus: "online" as const,
  };
  assert.equal(agentPresencePresentation(agent).label, "状态未知");
  for (const [activity, reason, label, pulse] of [
    ["offline", "idle", "休眠 · 等待唤醒", false],
    ["online", "online", "在线", false],
    ["thinking", "thinking", "思考中", true],
    ["working", "working", "工作中", true],
    ["error", "error", "运行异常", false],
    ["offline", "host_offline", "Computer 离线", false],
  ] as const) {
    assert.deepEqual(
      agentPresencePresentation({
        ...agent,
        presence: { agentDefinitionId: "a", activity, reason },
      }),
      { activity, label, pulse },
    );
  }
  assert.equal(
    agentPresencePresentation({
      ...agent,
      state: "disabled",
      presence: {
        agentDefinitionId: "a",
        activity: "working",
        reason: "working",
      },
    }).label,
    "已暂停",
  );
});
