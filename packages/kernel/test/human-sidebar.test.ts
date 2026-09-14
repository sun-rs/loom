import assert from "node:assert/strict";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";
test("sidebar order is private, version fenced, idempotent and ACL validated", () => {
  const k = new RoomKernel({ databasePath: ":memory:" });
  k.initialize();
  try {
    const human = k.provisionPrincipal({ handle: "human", kind: "human" }),
      other = k.provisionPrincipal({ handle: "other", kind: "human" });
    const a = k.authenticateAccessToken(human.accessToken),
      b = k.authenticateAccessToken(other.accessToken);
    const w = k.createWorkspace(a, {
      name: "w",
      slug: "w",
      idempotencyKey: "w",
    });
    k.addMember(a, {
      roomId: w.controlRoom.roomId,
      principalId: other.principal.principalId,
    });
    const head = () =>
      k.sync(a, { roomId: w.controlRoom.roomId, consumerId: "h" })
        .latestRoomSeq;
    const room = k.createWorkspaceRoom(a, {
      workspaceId: w.workspace.workspaceId,
      name: "chat",
      slug: "chat",
      kind: "channel",
      idempotencyKey: "r",
      basedOnControlRoomSeq: head(),
    }).room;
    const get = { workspaceId: w.workspace.workspaceId };
    assert.deepEqual(k.humanSidebar.get(a, get).preferences, {
      version: 0,
      pinned: [],
      channelOrder: [],
      dmOrder: [],
      hiddenDms: [],
      customSections: [],
      sectionOrder: [],
      channelSortMode: "manual",
      dmSortMode: "manual",
      pinnedSortMode: "manual",
      mutedActivity: [],
      mutedWorkspace: false,
      notifyAllMessages: [],
      expandedLongMessages: [],
    });
    const patch = {
      ...get,
      expectedVersion: 0,
      idempotencyKey: "p1",
      patch: {
        pinned: [`room:${room.roomId}`],
        mutedActivity: [`room:${room.roomId}`],
        mutedWorkspace: true,
        notifyAllMessages: [`room:${room.roomId}`],
        expandedLongMessages: [`room:${room.roomId}`],
      },
    };
    const first = k.humanSidebar.patch(a, patch);
    assert.equal(first.preferences.version, 1);
    assert.deepEqual(first.preferences.mutedActivity, [`room:${room.roomId}`]);
    assert.equal(first.preferences.mutedWorkspace, true);
    assert.deepEqual(first.preferences.notifyAllMessages, [
      `room:${room.roomId}`,
    ]);
    assert.deepEqual(first.preferences.expandedLongMessages, [
      `room:${room.roomId}`,
    ]);
    assert.deepEqual(k.humanSidebar.patch(a, patch), first);
    assert.deepEqual(k.humanSidebar.get(b, get).preferences.pinned, []);
    assert.throws(
      () =>
        k.humanSidebar.patch(a, {
          ...patch,
          idempotencyKey: "p2",
          patch: { pinned: [] },
        }),
      /version|conflict/i,
    );
    assert.throws(
      () =>
        k.humanSidebar.patch(a, {
          ...patch,
          expectedVersion: 1,
          idempotencyKey: "p3",
          patch: { pinned: ["room:private-secret"] },
        }),
      /unavailable|accessible/,
    );
    assert.throws(
      () =>
        k.humanSidebar.patch(a, {
          ...patch,
          expectedVersion: 1,
          idempotencyKey: "p5",
          patch: { notifyAllMessages: ["room:private-secret"] },
        }),
      /unavailable|accessible/,
    );
    assert.throws(
      () =>
        k.humanSidebar.patch(a, {
          ...patch,
          expectedVersion: 1,
          idempotencyKey: "p4",
          patch: { mutedActivity: ["room:private-secret"] },
        }),
      /unavailable|accessible/,
    );
    assert.equal(k.humanSidebar.get(a, get).preferences.version, 1);
  } finally {
    k.close();
  }
});

test("custom sections and hidden conversations are private, persistent and target validated", () => {
  const k = new RoomKernel({ databasePath: ":memory:" });
  k.initialize();
  try {
    const h = k.provisionPrincipal({ handle: "h", kind: "human" }),
      a = k.authenticateAccessToken(h.accessToken);
    const agent = k.provisionPrincipal({ handle: "agent", kind: "agent" });
    const w = k.createWorkspace(a, {
      name: "w",
      slug: "w",
      idempotencyKey: "w",
    });
    k.addMember(a, {
      roomId: w.controlRoom.roomId,
      principalId: agent.principal.principalId,
    });
    const key = `peer:${agent.principal.principalId}`;
    const request = {
      workspaceId: w.workspace.workspaceId,
      expectedVersion: 0,
      idempotencyKey: "section",
      patch: {
        hiddenDms: [key],
        sectionOrder: ["custom:work", "dms", "pinned", "channels"],
        customSections: [
          { id: "work", name: "工作", emoji: "🚀", items: [key] },
        ],
      },
    };
    const result = k.humanSidebar.patch(a, request);
    assert.deepEqual(result.preferences.hiddenDms, [key]);
    assert.deepEqual(
      k.humanSidebar.get(a, { workspaceId: w.workspace.workspaceId })
        .preferences.sectionOrder,
      request.patch.sectionOrder,
    );
    assert.deepEqual(
      k.humanSidebar.get(a, { workspaceId: w.workspace.workspaceId })
        .preferences.customSections,
      request.patch.customSections,
    );
    assert.deepEqual(k.humanSidebar.patch(a, request), result);
    const opened = k.openDirectRoom(a, {
      workspaceId: w.workspace.workspaceId,
      peerPrincipalId: agent.principal.principalId,
      basedOnControlRoomSeq: k.sync(a, {
        roomId: w.controlRoom.roomId,
        consumerId: "dm",
      }).latestRoomSeq,
      idempotencyKey: "reopen",
    });
    assert.equal(opened.kind, "direct");
    assert.deepEqual(
      k.humanSidebar.get(a, { workspaceId: w.workspace.workspaceId })
        .preferences.hiddenDms,
      [],
    );

    assert.throws(
      () =>
        k.humanSidebar.patch(a, {
          ...request,
          expectedVersion: 2,
          idempotencyKey: "bad",
          patch: {
            customSections: [
              { id: "work", name: "工作", items: ["room:secret"] },
            ],
          },
        }),
      /unavailable|accessible/,
    );
    assert.throws(
      () =>
        k.humanSidebar.patch(a, {
          ...request,
          expectedVersion: 2,
          idempotencyKey: "bad-hidden",
          patch: { hiddenDms: ["room:secret"] },
        }),
      /unavailable|accessible/,
    );
  } finally {
    k.close();
  }
});
