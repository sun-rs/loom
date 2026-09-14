import assert from "node:assert/strict";
import test from "node:test";
import { RoomKernel } from "@rah-os/kernel";
import { ensureAllChannel } from "../src/ensure-all-channel.ts";
test("bootstrap adds all once without renaming or replacing existing history", () => {
  const k = new RoomKernel({ databasePath: ":memory:" });
  k.initialize();
  try {
    const h = k.provisionPrincipal({ handle: "owner", kind: "human" }),
      a = k.authenticateAccessToken(h.accessToken);
    const w = k.createWorkspace(a, {
      name: "w",
      slug: "w",
      idempotencyKey: "w",
    });
    const council = k.createWorkspaceRoom(a, {
      workspaceId: w.workspace.workspaceId,
      name: "Agent Council",
      slug: "agent-council",
      kind: "channel",
      basedOnControlRoomSeq: w.event.roomSeq,
      idempotencyKey: "c",
    }).room;
    const all = ensureAllChannel(
      k,
      h.accessToken,
      w.workspace.workspaceId,
      w.controlRoom.roomId,
    );
    assert.ok(all);
    assert.equal(all.name, "all");
    assert.equal(all.visibility, "public");
    assert.equal(
      ensureAllChannel(
        k,
        h.accessToken,
        w.workspace.workspaceId,
        w.controlRoom.roomId,
      )?.roomId,
      all.roomId,
    );
    k.updateSystemChannelVisibility(a, {
      workspaceId: w.workspace.workspaceId,
      hidden: true,
      basedOnRoomSeq: k.sync(a, {
        roomId: w.controlRoom.roomId,
        consumerId: "hide-test",
      }).latestRoomSeq,
      idempotencyKey: "hide",
    });
    assert.equal(
      ensureAllChannel(
        k,
        h.accessToken,
        w.workspace.workspaceId,
        w.controlRoom.roomId,
      ),
      undefined,
    );
    assert.equal(
      k.getSystemChannelVisibility(a, { workspaceId: w.workspace.workspaceId })
        .hidden,
      true,
    );
    assert.equal(
      k
        .listRooms(a, { workspaceId: w.workspace.workspaceId })
        .find((r) => r.roomId === council.roomId)?.name,
      "Agent Council",
    );
  } finally {
    k.close();
  }
});
