import assert from "node:assert/strict";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("historical DM remains closable after its peer leaves memberships", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-sidebar-deleted-"));
  const databasePath = join(directory, "room.db");
  const k = new RoomKernel({ databasePath });
  k.initialize();
  try {
    const human = k.provisionPrincipal({ handle: "owner", kind: "human" });
    const peer = k.provisionPrincipal({ handle: "removed", kind: "agent" });
    const actor = k.authenticateAccessToken(human.accessToken);
    const w = k.createWorkspace(actor, {
      name: "w",
      slug: "w",
      idempotencyKey: "w",
    });
    k.addMember(actor, {
      roomId: w.controlRoom.roomId,
      principalId: peer.principal.principalId,
    });
    const room = k.openDirectRoom(actor, {
      workspaceId: w.workspace.workspaceId,
      peerPrincipalId: peer.principal.principalId,
      basedOnControlRoomSeq: k.sync(actor, {
        roomId: w.controlRoom.roomId,
        consumerId: "test",
      }).latestRoomSeq,
      idempotencyKey: "dm",
    });
    // Reproduce the membership projection left by Agent deletion; the durable pair survives.
    const db = new DatabaseSync(databasePath);
    db.prepare("DELETE FROM memberships WHERE principal_id = ?").run(
      peer.principal.principalId,
    );
    db.close();
    const scope = { workspaceId: w.workspace.workspaceId };
    const key = `peer:${peer.principal.principalId}`;
    const result = k.humanSidebar.patch(actor, {
      ...scope,
      expectedVersion: 0,
      idempotencyKey: "close",
      patch: { hiddenDms: [key] },
    });
    assert.deepEqual(result.preferences.hiddenDms, [key]);
    assert.deepEqual(k.humanSidebar.get(actor, scope).preferences.hiddenDms, [
      key,
    ]);
    assert.ok(k.listRooms(actor).some((r) => r.roomId === room.roomId));
    assert.throws(
      () =>
        k.humanSidebar.patch(actor, {
          ...scope,
          expectedVersion: 1,
          idempotencyKey: "unauthorized",
          patch: { hiddenDms: ["peer:unknown"] },
        }),
      /unavailable|inaccessible/,
    );
  } finally {
    k.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
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
      channelPanelTabOrder: [],
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

test("panel tab order persists across reopen with sparse updates, replay and personal isolation", () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-tab-order-"));
  const databasePath = join(directory, "room.db");
  let k = new RoomKernel({ databasePath });
  k.initialize();
  try {
    const owner = k.provisionPrincipal({ handle: "owner", kind: "human" });
    const other = k.provisionPrincipal({ handle: "other", kind: "human" });
    let actor = k.authenticateAccessToken(owner.accessToken);
    const w = k.createWorkspace(actor, {
      name: "w",
      slug: "w",
      idempotencyKey: "w",
    });
    k.addMember(actor, {
      roomId: w.controlRoom.roomId,
      principalId: other.principal.principalId,
    });
    const scope = { workspaceId: w.workspace.workspaceId };
    assert.deepEqual(
      k.humanSidebar.get(actor, scope).preferences.channelPanelTabOrder,
      [],
    );
    const input = {
      ...scope,
      expectedVersion: 0,
      idempotencyKey: "order",
      patch: {
        channelPanelTabOrder: ["tasks", "chat"] as ("tasks" | "chat")[],
      },
    };
    const saved = k.humanSidebar.patch(actor, input);
    assert.deepEqual(saved.preferences.channelPanelTabOrder, ["tasks", "chat"]);
    assert.deepEqual(k.humanSidebar.patch(actor, input), saved);
    k.humanSidebar.patch(actor, {
      ...scope,
      expectedVersion: 1,
      idempotencyKey: "mute",
      patch: { mutedWorkspace: true },
    });
    assert.throws(
      () => k.humanSidebar.patch(actor, { ...input, idempotencyKey: "stale" }),
      /version conflict/,
    );
    assert.deepEqual(
      k.humanSidebar.get(k.authenticateAccessToken(other.accessToken), scope)
        .preferences.channelPanelTabOrder,
      [],
    );
    k.close();
    k = new RoomKernel({ databasePath });
    k.initialize();
    actor = k.authenticateAccessToken(owner.accessToken);
    assert.deepEqual(
      k.humanSidebar.get(actor, scope).preferences.channelPanelTabOrder,
      ["tasks", "chat"],
    );
    for (const order of [["chat", "chat"], ["unknown"]])
      assert.throws(() =>
        k.humanSidebar.patch(actor, {
          ...scope,
          expectedVersion: 2,
          idempotencyKey: "invalid",
          patch: { channelPanelTabOrder: order as ("tasks" | "chat")[] },
        }),
      );
  } finally {
    k.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("standalone chat placement accepts an authorized channel without changing its identity", () => {
  const k = new RoomKernel({ databasePath: ":memory:" });
  k.initialize();
  try {
    const h = k.provisionPrincipal({ handle: "solo-owner", kind: "human" });
    const a = k.authenticateAccessToken(h.accessToken);
    const w = k.createWorkspace(a, {
      name: "solo",
      slug: "solo",
      idempotencyKey: "w",
    });
    const room = k.createWorkspaceRoom(a, {
      workspaceId: w.workspace.workspaceId,
      name: "Tom",
      slug: "tom",
      kind: "channel",
      idempotencyKey: "r",
      basedOnControlRoomSeq: k.sync(a, {
        roomId: w.controlRoom.roomId,
        consumerId: "t",
      }).latestRoomSeq,
    }).room;
    const key = `room:${room.roomId}`,
      scope = { workspaceId: w.workspace.workspaceId };
    const result = k.humanSidebar.patch(a, {
      ...scope,
      expectedVersion: 0,
      idempotencyKey: "solo",
      patch: { dmOrder: [key], hiddenDms: [key] },
    });
    assert.deepEqual(result.preferences.dmOrder, [key]);
    assert.deepEqual(k.humanSidebar.get(a, scope).preferences.hiddenDms, [key]);
    assert.equal(
      k.listRooms(a).find((r) => r.roomId === room.roomId)?.kind,
      "channel",
    );
    assert.throws(
      () =>
        k.humanSidebar.patch(a, {
          ...scope,
          expectedVersion: 1,
          idempotencyKey: "bad",
          patch: { dmOrder: ["room:unknown"] },
        }),
      /unavailable|inaccessible/,
    );
    assert.throws(
      () =>
        k.humanSidebar.patch(a, {
          ...scope,
          expectedVersion: 0,
          idempotencyKey: "stale",
          patch: { dmOrder: [] },
        }),
      /version conflict/,
    );
  } finally {
    k.close();
  }
});

test("workspace theme is personal, validated, version fenced and preserved by unrelated patches", () => {
  const k = new RoomKernel({ databasePath: ":memory:" });
  k.initialize();
  try {
    const h = k.provisionPrincipal({ handle: "theme-owner", kind: "human" });
    const h2 = k.provisionPrincipal({ handle: "theme-peer", kind: "human" });
    const a = k.authenticateAccessToken(h.accessToken),
      b = k.authenticateAccessToken(h2.accessToken);
    const w = k.createWorkspace(a, {
      name: "theme",
      slug: "theme",
      idempotencyKey: "theme",
    });
    k.addMember(a, {
      roomId: w.controlRoom.roomId,
      principalId: h2.principal.principalId,
    });
    const scope = { workspaceId: w.workspace.workspaceId };
    const request = {
      ...scope,
      expectedVersion: 0,
      idempotencyKey: "set-theme",
      patch: { theme: "bots" as const, themeDecor: false },
    };
    assert.equal(k.humanSidebar.patch(a, request).preferences.theme, "bots");
    assert.equal(k.humanSidebar.patch(a, request).preferences.version, 1);
    assert.equal(k.humanSidebar.get(b, scope).preferences.theme, undefined);
    assert.throws(
      () => k.humanSidebar.patch(a, { ...request, idempotencyKey: "stale" }),
      /version/,
    );
    const after = k.humanSidebar.patch(a, {
      ...scope,
      expectedVersion: 1,
      idempotencyKey: "mute",
      patch: { mutedWorkspace: true },
    }).preferences;
    assert.equal(after.theme, "bots");
    assert.equal(after.themeDecor, false);
    assert.throws(() =>
      k.humanSidebar.patch(a, {
        ...scope,
        expectedVersion: 2,
        idempotencyKey: "bad",
        patch: { theme: "unknown" as any },
      }),
    );
  } finally {
    k.close();
  }
});
