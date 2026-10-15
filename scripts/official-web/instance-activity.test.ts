import assert from "node:assert/strict";
import test from "node:test";
import { loadInstanceActivity } from "../../frontends/raft/loom/instance-activity.ts";
import type { RahClient } from "@rah-os/client-sdk";
const room = { roomId: "room", instancePrivateBox: undefined };
const member = { principalId: "instance", kind: "agent", handle: "Tom" };
function fixture(
  instance = { instanceId: "instance", agentId: "agent", channelId: "room" },
) {
  const calls: Array<[string, any]> = [];
  const client = {
    request: async (op: string, input: any) => {
      calls.push([op, input]);
      if (op === "role.list") return { instances: [instance] };
      if (op === "room.agent.activity.list")
        return {
          agents: [
            {
              roomId: "room",
              participantId: "instance",
              state: "idle",
              queued: false,
            },
          ],
        };
      if (op === "agent.activity.list")
        return {
          activities: [
            {
              source: "room_event",
              roomId: "room",
              participantId: "instance",
              aggregateType: "run_attempt",
              aggregateId: "run",
              eventType: "run.started",
              createdAt: "2026-10-15T01:00:00Z",
            },
            {
              source: "room_event",
              roomId: "private",
              participantId: "instance",
              aggregateType: "run_attempt",
              aggregateId: "secret",
            },
            {
              source: "room_event",
              roomId: "room",
              participantId: "other",
              aggregateType: "run_attempt",
              aggregateId: "other",
            },
          ],
          nextCursor: "older",
        };
      throw Error(op);
    },
  } as unknown as RahClient;
  return { client, calls };
}
test("inspector resolves instance to agent, bounds and filters records to this member and Room", async () => {
  const { client, calls } = fixture();
  const result = await loadInstanceActivity(client, {
    controlRoomId: "control",
    room,
    member,
  } as any);
  assert.deepEqual(
    result.records.map((r) => r.aggregateId),
    ["run"],
  );
  assert.equal(result.nextCursor, "older");
  assert.deepEqual(calls.find(([op]) => op === "agent.activity.list")?.[1], {
    agentId: "agent",
    limit: 20,
  });
  assert.equal(result.stateLabel, "空闲 · 本频道无排队工作");
});
test("wrong channel instance never reads its activity; private box must belong to selected instance", async () => {
  const { client, calls } = fixture({
    ...{ instanceId: "instance", agentId: "agent" },
    channelId: "elsewhere",
  });
  await assert.rejects(
    loadInstanceActivity(client, {
      controlRoomId: "control",
      room,
      member,
    } as any),
  );
  assert.equal(
    calls.some(([op]) => op === "agent.activity.list"),
    false,
  );
  const wrongBox = fixture();
  await assert.rejects(
    loadInstanceActivity(wrongBox.client, {
      controlRoomId: "control",
      room: {
        roomId: "private",
        instancePrivateBox: { instanceId: "someone-else" },
      },
      member,
    } as any),
  );
  assert.equal(
    wrongBox.calls.some(([op]) => op === "agent.activity.list"),
    false,
  );
  const valid = fixture();
  await loadInstanceActivity(valid.client, {
    controlRoomId: "control",
    room: { roomId: "private", instancePrivateBox: { instanceId: "instance" } },
    member,
    beforeActivityId: "older",
  } as any);
  assert.equal(
    valid.calls.find(([op]) => op === "agent.activity.list")?.[1]
      .beforeActivityId,
    "older",
  );
});

test("native activity chronology displays oldest first inside a bounded page", async () => {
  const base = fixture();
  const client = {
    request: async (op: string, input: any, options: any) => {
      const value: any = await base.client.request(op as any, input, options);
      if (op === "agent.activity.list") {
        const current = value.activities[0];
        value.activities = [
          { ...current, roomSeq: 2 },
          {
            ...current,
            aggregateId: "older",
            roomSeq: 1,
            createdAt: "2026-10-15T00:00:00Z",
          },
        ];
      }
      return value;
    },
  } as unknown as RahClient;
  const result = await loadInstanceActivity(client, {
    controlRoomId: "control",
    room,
    member,
  } as any);
  assert.deepEqual(
    result.records.map((r) => r.aggregateId),
    ["older", "run"],
  );
});

test("inspector exposes only the selected member's authoritative block, including private-box origin", async () => {
  const base = fixture();
  const blocked = {
    activationId: "held",
    roomId: "private",
    holdsLane: true,
    reason: "FIXTURE newer Human fact",
  };
  const client = {
    request: async (op: any, input: any, options: any) => {
      const value: any = await base.client.request(op, input, options);
      if (op === "room.agent.activity.list") {
        value.agents.unshift({
          ...value.agents[0],
          participantId: "other",
          blocked: { ...blocked, activationId: "wrong" },
        });
        value.agents[1].blocked = blocked;
      }
      return value;
    },
  } as RahClient;
  const result = await loadInstanceActivity(client, {
    controlRoomId: "control",
    room,
    member,
  } as any);
  assert.deepEqual(result.blocked, blocked);
});
