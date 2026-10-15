import test from "node:test";
import assert from "node:assert/strict";
import {
  loadTrajectory,
  usageRows,
} from "../../frontends/raft/loom/run-details.ts";
import { ManagementClient } from "../../frontends/raft/loom/management-client.ts";
test("trajectory bounds reads, forwards opaque cursor and excludes another room and participant", async () => {
  const calls: any[] = [];
  const client: any = {
    request: async (op: any, input: any) => {
      calls.push([op, input]);
      return {
        activities: [
          { roomId: "r", participantId: "i", serverSequence: 2 },
          { roomId: "secret", participantId: "i" },
          { roomId: "r", participantId: "other" },
          { roomId: "r", participantId: "i", serverSequence: 1 },
        ],
        nextCursor: "next",
      };
    },
  };
  const result = await loadTrajectory(client, {
    agentId: "a",
    roomId: "r",
    instanceId: "i",
    beforeActivityId: "opaque",
  });
  assert.deepEqual(calls, [
    [
      "agent.trajectory.list",
      { agentId: "a", limit: 50, beforeActivityId: "opaque" },
    ],
  ]);
  assert.deepEqual(
    result.activities.map((r: any) => r.serverSequence),
    [1, 2],
  );
  assert.equal(result.nextCursor, "next");
});
test("usage keeps missing values unknown and partial generation counts distinct from aggregate totals", () => {
  const result = usageRows({
    completeness: "partial",
    totals: {
      inputTokens: 123,
      cachedInputTokens: 0,
      outputTokens: null,
      reasoningOutputTokens: null,
      generations: 1,
    },
    generations: [],
    truncated: false,
    aggregateUsage: undefined,
  } as any);
  assert.equal(
    result.find((r) => r.label === "输入 token")?.value,
    "123（部分）",
  );
  assert.equal(result.find((r) => r.label === "输出 token")?.value, "未知");
  assert.equal(
    result.find((r) => r.label === "缓存输入 token")?.value,
    "0（部分）",
  );
});
test("runtime control preserves exact state, identity and basis after an unknown response; opposite action is blocked", async () => {
  const calls: any[] = [];
  const client: any = {
    request: async (op: string, input: any) => {
      calls.push([op, input]);
      throw Error("lost response");
    },
  };
  const manager = new ManagementClient(client, "w", "control");
  (manager.control as any).syncUntilCurrent = async () => ({
    caughtUp: true,
    state: { latestRoomSeq: 7 },
  });
  await manager.setEnabled("a", false, () => {});
  assert.equal(manager.writes.state, "unknown");
  await manager.setEnabled("other", true, () => {});
  assert.equal(calls.length, 1);
  await manager.writes.retry();
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0][1].state, "disabled");
  assert.equal(calls[0][1].agentId, "a");
  assert.equal(calls[0][1].basedOnRoomSeq, 7);
  manager.writes.discard();
});
