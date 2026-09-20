import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientWorkspaceMemberGraphRequestSchema,
  ClientWorkspaceMemberGraphResponseSchema,
  projectMemberGraphEdges,
} from "../src/index.ts";

const fixture = {
  agents: [
    {
      agentId: "agent_definition_alice",
      avatarKey: "robot",
      channelIds: ["room_alpha", "room_beta"],
      displayName: "Alice",
      handle: "alice",
      id: "agent_definition_alice",
      participantId: "principal_alice",
      type: "agent" as const,
    },
  ],
  channels: [
    {
      agentCount: 1,
      humanCount: 1,
      id: "room_alpha",
      memberCount: 2,
      name: "Alpha",
      slug: "alpha",
    },
    {
      agentCount: 1,
      humanCount: 1,
      id: "room_beta",
      memberCount: 2,
      name: "Beta",
      slug: "beta",
    },
  ],
  edges: [],
  humans: [
    {
      channelIds: ["room_alpha", "room_beta"],
      displayName: "Owner",
      handle: "owner",
      id: "principal_owner",
      principalId: "principal_owner",
      type: "human" as const,
    },
  ],
  truncated: false,
  workspaceId: "workspace_one",
};

test("Workspace member graph protocol freezes the Raft member/channel data shape", () => {
  assert.deepEqual(
    ClientWorkspaceMemberGraphRequestSchema.parse({
      workspaceId: "workspace_one",
    }),
    { workspaceId: "workspace_one" },
  );
  assert.deepEqual(
    ClientWorkspaceMemberGraphResponseSchema.parse(fixture),
    fixture,
  );
  assert.throws(() =>
    ClientWorkspaceMemberGraphRequestSchema.parse({
      workspaceId: "workspace_one",
      principalId: "principal_outsider",
    }),
  );
});

test("Workspace member graph protocol rejects ambiguous, dangling, inconsistent and unbounded data", () => {
  assert.throws(() =>
    ClientWorkspaceMemberGraphResponseSchema.parse({
      ...fixture,
      humans: [...fixture.humans, fixture.humans[0]],
    }),
  );
  assert.throws(() =>
    ClientWorkspaceMemberGraphResponseSchema.parse({
      ...fixture,
      agents: [
        {
          ...fixture.agents[0],
          channelIds: ["room_missing"],
        },
      ],
    }),
  );
  assert.throws(() =>
    ClientWorkspaceMemberGraphResponseSchema.parse({
      ...fixture,
      channels: [
        {
          ...fixture.channels[0],
          memberCount: 99,
        },
        fixture.channels[1],
      ],
    }),
  );
  assert.throws(() =>
    ClientWorkspaceMemberGraphResponseSchema.parse({
      ...fixture,
      channels: Array.from({ length: 501 }, (_, index) => ({
        agentCount: 0,
        humanCount: 0,
        id: `room_${index}`,
        memberCount: 0,
        name: `Room ${index}`,
        slug: `room-${index}`,
      })),
    }),
  );
});

test("Raft edge projection aggregates shared Channels and falls back when all active groups are large", () => {
  const edges = projectMemberGraphEdges(
    [...fixture.humans, ...fixture.agents],
    fixture.channels,
  );
  assert.deepEqual(edges, [
    {
      channelIds: ["room_alpha", "room_beta"],
      channelNames: ["Alpha", "Beta"],
      source: "agent:agent_definition_alice",
      target: "human:principal_owner",
      weight: 2,
    },
  ]);
  assert.equal(
    projectMemberGraphEdges(
      [...fixture.humans, ...fixture.agents],
      fixture.channels.map((channel) => ({ ...channel, memberCount: 40 })),
    )[0]?.weight,
    2,
  );
});
