import assert from "node:assert/strict";
import test from "node:test";

import type {
  MemberGraphAgent,
  MemberGraphEdge,
  MemberGraphHuman,
} from "@rah-os/protocol";

import { computeMemberGraphLayout } from "../src/member-relationship-graph-layout.ts";

const members: Array<MemberGraphHuman | MemberGraphAgent> = [
  {
    channelIds: ["room_alpha", "room_beta"],
    displayName: "Owner",
    handle: "owner",
    id: "principal_owner",
    principalId: "principal_owner",
    type: "human",
  },
  {
    agentDefinitionId: "agent_alice",
    channelIds: ["room_alpha", "room_beta"],
    displayName: "Alice",
    handle: "alice",
    id: "agent_alice",
    participantId: "principal_alice",
    type: "agent",
  },
  {
    agentDefinitionId: "agent_kimi",
    channelIds: ["room_alpha"],
    displayName: "Kimi",
    handle: "kimi",
    id: "agent_kimi",
    participantId: "principal_kimi",
    type: "agent",
  },
];
const edges: MemberGraphEdge[] = [
  {
    channelIds: ["room_alpha", "room_beta"],
    channelNames: ["Alpha", "Beta"],
    source: "agent:agent_alice",
    target: "human:principal_owner",
    weight: 2,
  },
  {
    channelIds: ["room_alpha"],
    channelNames: ["Alpha"],
    source: "agent:agent_alice",
    target: "agent:agent_kimi",
    weight: 1,
  },
];

test("Raft structural graph layout is deterministic, bounded and degree-aware", () => {
  const first = computeMemberGraphLayout(members, edges, false);
  const second = computeMemberGraphLayout(members, edges, false);
  assert.deepEqual([...first.positions], [...second.positions]);
  assert.equal(first.degrees.get("agent:agent_alice"), 2);
  assert.equal(first.degrees.get("agent:agent_kimi"), 1);
  assert.equal(first.degrees.get("human:principal_owner"), 1);
  for (const point of first.positions.values()) {
    assert.ok(point.x >= 58 && point.x <= 862);
    assert.ok(point.y >= 58 && point.y <= 502);
  }
});
