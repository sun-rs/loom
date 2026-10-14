import assert from "node:assert/strict";
import test from "node:test";
import { FakeRahClient } from "@rah-os/client-sdk";
import { LoomPrivateBoxClient } from "../../frontends/raft/loom/private-box.ts";

test("opening an instance box verifies an unknown result with the exact original peer, key and control sequence", async () => {
  const calls: any[] = [];
  const client = new FakeRahClient(async (op, input) => {
    if (op === "room.sync")
      return {
        cursorBefore: 3,
        cursorAfter: 3,
        latestRoomSeq: 3,
        eventFloorSeq: 3,
        snapshotSeq: 3,
        events: [],
        snapshot: {
          room: {
            roomId: "control",
            workspaceId: "workspace",
            name: "Control",
            slug: "control",
            kind: "channel",
            createdAt: "2026-10-14T00:00:00Z",
          },
          members: [],
        },
      };
    if (op === "room.acknowledge") return { acknowledgedThrough: 3 };
    if (op === "room.direct.open") {
      calls.push(input);
      if (calls.length === 1) throw new Error("lost response");
      return {
        room: {
          roomId: "box-a",
          workspaceId: "workspace",
          kind: "direct",
          name: "Tom-1",
          slug: "box",
          createdAt: "2026-10-14T00:00:00Z",
          instancePrivateBox: { instanceId: "a", active: true },
        },
      };
    }
    throw new Error(op);
  });
  const boxes = new LoomPrivateBoxClient(
    client,
    "workspace",
    "control",
    "consumer",
  );
  const first = await boxes.open("a");
  assert.equal(
    first.kind,
    "unknown",
    first.kind === "rejected" ? String(first.error) : undefined,
  );
  assert.equal((await boxes.open("b")).kind, "busy");
  assert.equal(calls.length, 1);
  assert.equal((await boxes.writes.retry()).kind, "ok");
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].peerPrincipalId, "a");
  assert.equal(calls[0].basedOnControlRoomSeq, 3);
  boxes.writes.discard();
});
