import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";

test("Raft-shaped Direct Rooms are open-or-create pairs with immutable membership", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-direct-room-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "hakase",
      kind: "human",
    });
    const peer = kernel.provisionPrincipal({
      handle: "cindy",
      kind: "agent",
    });
    const outsider = kernel.provisionPrincipal({
      handle: "alice",
      kind: "agent",
    });
    const humanActor = kernel.authenticateAccessToken(human.accessToken);
    const peerActor = kernel.authenticateAccessToken(peer.accessToken);
    const workspace = kernel.createWorkspace(humanActor, {
      idempotencyKey: "workspace-created",
      name: "RAH OS",
      slug: "rah-os",
    });
    kernel.addMember(humanActor, {
      principalId: peer.principal.principalId,
      roomId: workspace.controlRoom.roomId,
    });
    const controlHead = kernel.sync(humanActor, {
      afterSeq: 0,
      consumerId: "direct-room-control-head",
      roomId: workspace.controlRoom.roomId,
    }).latestRoomSeq;

    const opened = kernel.openDirectRoom(humanActor, {
      basedOnControlRoomSeq: controlHead,
      idempotencyKey: "direct-open-cindy",
      peerPrincipalId: peer.principal.principalId,
      workspaceId: workspace.workspace.workspaceId,
    });
    assert.equal(opened.kind, "direct");
    assert.equal(opened.name, "cindy");
    const pair = [human.principal.principalId, peer.principal.principalId].sort(
      (a, b) => a.localeCompare(b),
    );
    assert.deepEqual(
      opened.directParticipantIds,
      pair,
      "open returns canonical peer identity, never a display-name guess",
    );
    assert.deepEqual(
      kernel
        .listRooms(humanActor)
        .find(({ roomId }) => roomId === opened.roomId)?.directParticipantIds,
      pair,
    );
    assert.deepEqual(
      kernel.listRoomMemberships(humanActor, { roomId: opened.roomId }),
      [
        {
          joinedAt: opened.createdAt,
          principalId: human.principal.principalId,
          role: "member",
          roomId: opened.roomId,
        },
        {
          joinedAt: opened.createdAt,
          principalId: peer.principal.principalId,
          role: "member",
          roomId: opened.roomId,
        },
      ].sort((left, right) =>
        left.principalId.localeCompare(right.principalId),
      ),
    );
    assert.equal(
      kernel.openDirectRoom(humanActor, {
        basedOnControlRoomSeq: controlHead,
        idempotencyKey: "direct-open-cindy-again",
        peerPrincipalId: peer.principal.principalId,
        workspaceId: workspace.workspace.workspaceId,
      }).roomId,
      opened.roomId,
      "a new Raft-style open request reuses the existing pair",
    );
    assert.equal(
      kernel.openDirectRoom(humanActor, {
        basedOnControlRoomSeq: controlHead,
        idempotencyKey: "direct-open-cindy",
        peerPrincipalId: peer.principal.principalId,
        workspaceId: workspace.workspace.workspaceId,
      }).roomId,
      opened.roomId,
      "an idempotent replay returns the same pair",
    );
    assert.equal(
      kernel
        .listRooms(peerActor, { workspaceId: workspace.workspace.workspaceId })
        .some(({ roomId }) => roomId === opened.roomId),
      true,
    );

    assert.throws(
      () =>
        kernel.addRoomMember(humanActor, {
          basedOnRoomSeq: 1,
          idempotencyKey: "direct-add-third-member",
          principalId: outsider.principal.principalId,
          role: "member",
          roomId: opened.roomId,
        }),
      /direct room membership is immutable/i,
    );
    assert.throws(
      () =>
        kernel.openDirectRoom(humanActor, {
          basedOnControlRoomSeq: controlHead,
          idempotencyKey: "direct-open-self",
          peerPrincipalId: human.principal.principalId,
          workspaceId: workspace.workspace.workspaceId,
        }),
      /cannot open a direct room with itself/i,
    );
    assert.throws(
      () =>
        kernel.openDirectRoom(humanActor, {
          basedOnControlRoomSeq: controlHead,
          idempotencyKey: "direct-open-outsider",
          peerPrincipalId: outsider.principal.principalId,
          workspaceId: workspace.workspace.workspaceId,
        }),
      /same workspace/i,
    );

    const message = kernel.postRoomMessage(humanActor, {
      basedOnRoomSeq: 1,
      body: "Please inspect the onboarding flow.",
      idempotencyKey: "direct-message-cindy",
      roomId: opened.roomId,
    });
    assert.equal(message.activationIds.length, 1);
    assert.equal(
      kernel.listInbox(peerActor, { roomId: opened.roomId })[0]?.eventId,
      message.event.eventId,
      "Direct Rooms reuse canonical Message -> Inbox delivery",
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
