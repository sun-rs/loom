import assert from "node:assert/strict";
import test from "node:test";
import {
  agentPresencePresentation,
  latestWorkspaceActivity,
  RAFT_LIVE_ACTIVITY_TTL_MS,
} from "../src/attention-presentation.ts";

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
    ["thinking", "thinking", "思考中…", true],
    ["working", "working", "工作中…", true],
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

test("the workspace work strip selects only Raft live activity inside the 90 second window", () => {
  const now = Date.parse("2026-09-03T03:00:00.000Z");
  const agent = (
    id: string,
    activity: "online" | "thinking" | "working" | "error",
    age: number,
  ) => ({
    id,
    state: "enabled",
    runtimeAvailable: true,
    connectionStatus: "online" as const,
    presence: {
      activityAt: new Date(now - age).toISOString(),
      agentDefinitionId: id,
      activity,
      reason: activity,
    },
  });
  assert.equal(
    latestWorkspaceActivity([agent("online", "online", 1)], now),
    undefined,
  );
  assert.equal(
    latestWorkspaceActivity([agent("error", "error", 1)], now),
    undefined,
  );
  assert.equal(
    latestWorkspaceActivity(
      [agent("stale", "thinking", RAFT_LIVE_ACTIVITY_TTL_MS)],
      now,
    ),
    undefined,
  );
  const latest = latestWorkspaceActivity(
    [agent("older", "working", 2_000), agent("latest", "thinking", 1_000)],
    now,
  );
  assert.equal(latest?.agent.id, "latest");
  assert.deepEqual(latest?.presentation, {
    activity: "thinking",
    label: "思考中…",
    pulse: true,
  });
  assert.equal(latest?.expiresAt, now - 1_000 + RAFT_LIVE_ACTIVITY_TTL_MS);
});
