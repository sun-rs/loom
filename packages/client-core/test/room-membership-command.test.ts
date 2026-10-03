import assert from "node:assert/strict";
import test from "node:test";

import { FakeRahClient } from "@rah-os/client-sdk";
import type { RoomMembership } from "@rah-os/protocol";

import { ensureRoomMembershipRemoved } from "../src/index.ts";

const membership: RoomMembership = {
  joinedAt: "2026-08-27T00:00:00.000Z",
  principalId: "agent-codex",
  role: "member",
  roomId: "room-main",
};

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

test("a concurrent removal reconciles only after canonical membership proves absence", async () => {
  const operations: string[] = [];
  let reads = 0;
  const client = new FakeRahClient(async (operation) => {
    operations.push(operation);
    if (operation === "room.member.list")
      return { memberships: ++reads === 1 ? [membership] : [] };
    if (operation === "room.member.remove") throw new Error("response lost");
    throw new Error(`unexpected operation ${operation}`);
  });
  assert.deepEqual(
    await ensureRoomMembershipRemoved(client, {
      basedOnRoomSeq: 8,
      idempotencyKey: "remove",
      participantId: membership.principalId,
      roomId: membership.roomId,
    }),
    { changed: false, removedPrincipalId: membership.principalId },
  );
  assert.deepEqual(operations, [
    "room.member.list",
    "room.member.remove",
    "room.member.list",
  ]);
});

test("failed removal is not hidden when canonical membership still exists", async () => {
  const failure = new Error("rejected removal");
  const client = new FakeRahClient(async (operation) => {
    if (operation === "room.member.list") return { memberships: [membership] };
    if (operation === "room.member.remove") throw failure;
    throw new Error(`unexpected operation ${operation}`);
  });
  await assert.rejects(
    ensureRoomMembershipRemoved(client, {
      basedOnRoomSeq: 8,
      idempotencyKey: "remove",
      participantId: membership.principalId,
      roomId: membership.roomId,
    }),
    (e) => e === failure,
  );
});
