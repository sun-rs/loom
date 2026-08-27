import assert from "node:assert/strict";
import test from "node:test";

import { FakeRahClient, RahClientError } from "@rah-os/client-sdk";
import type { RoomMembership } from "@rah-os/protocol";

import {
  ensureRoomMembership,
  ensureRoomMembershipRemoved,
} from "../src/index.ts";

const membership: RoomMembership = {
  joinedAt: "2026-08-27T00:00:00.000Z",
  principalId: "agent-codex",
  role: "member",
  roomId: "room-main",
};

test("joining an existing Room member reconciles without repeating onboarding", async () => {
  const operations: string[] = [];
  const client = new FakeRahClient(async (operation) => {
    operations.push(operation);
    if (operation === "room.member.list") {
      return { memberships: [membership] };
    }
    throw new Error(`unexpected operation ${operation}`);
  });

  const result = await ensureRoomMembership(client, {
    agentDefinitionId: "definition-codex",
    basedOnRoomSeq: 7,
    idempotencyKey: "join-codex",
    participantId: membership.principalId,
    roomId: membership.roomId,
  });

  assert.deepEqual(result, { changed: false, membership });
  assert.deepEqual(operations, ["room.member.list"]);
});

test("a concurrent join conflict is successful only after canonical membership proves the goal", async () => {
  const operations: string[] = [];
  let listCount = 0;
  const client = new FakeRahClient(async (operation) => {
    operations.push(operation);
    if (operation === "room.member.list") {
      listCount += 1;
      return { memberships: listCount === 1 ? [] : [membership] };
    }
    if (operation === "agent.onboard") {
      throw new RahClientError("conflict", "already a member", 409);
    }
    throw new Error(`unexpected operation ${operation}`);
  });

  const result = await ensureRoomMembership(client, {
    agentDefinitionId: "definition-codex",
    basedOnRoomSeq: 7,
    idempotencyKey: "join-codex",
    participantId: membership.principalId,
    roomId: membership.roomId,
  });

  assert.deepEqual(result, { changed: false, membership });
  assert.deepEqual(operations, [
    "room.member.list",
    "agent.onboard",
    "room.member.list",
  ]);
});

test("a failed join is not hidden when canonical membership still disagrees", async () => {
  const failure = new RahClientError("conflict", "different conflict", 409);
  const client = new FakeRahClient(async (operation) => {
    if (operation === "room.member.list") return { memberships: [] };
    if (operation === "agent.onboard") throw failure;
    throw new Error(`unexpected operation ${operation}`);
  });

  await assert.rejects(
    ensureRoomMembership(client, {
      agentDefinitionId: "definition-codex",
      basedOnRoomSeq: 7,
      idempotencyKey: "join-codex",
      participantId: membership.principalId,
      roomId: membership.roomId,
    }),
    (caught) => caught === failure,
  );
});

test("removing an absent Room member is already reconciled", async () => {
  const operations: string[] = [];
  const client = new FakeRahClient(async (operation) => {
    operations.push(operation);
    if (operation === "room.member.list") return { memberships: [] };
    throw new Error(`unexpected operation ${operation}`);
  });

  const result = await ensureRoomMembershipRemoved(client, {
    basedOnRoomSeq: 8,
    idempotencyKey: "remove-codex",
    participantId: membership.principalId,
    roomId: membership.roomId,
  });

  assert.deepEqual(result, {
    changed: false,
    removedPrincipalId: membership.principalId,
  });
  assert.deepEqual(operations, ["room.member.list"]);
});
