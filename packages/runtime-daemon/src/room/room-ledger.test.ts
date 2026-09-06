import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomDomainError } from "./room-errors";
import { RoomLedger } from "./room-ledger";

function assertRoomError(
  operation: () => unknown,
  code: RoomDomainError["code"],
): RoomDomainError {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof RoomDomainError);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected RoomDomainError(${code})`);
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-ledger-"));
  const databasePath = path.join(root, "room-ledger.sqlite");
  const ledger = new RoomLedger(databasePath, {
    now: () => new Date("2026-09-05T08:00:00.000Z"),
    createId: (() => {
      let next = 0;
      return (prefix: string) => `${prefix}-${++next}`;
    })(),
  });
  ledger.provisionPrincipal({
    principalId: "human-owner",
    handle: "owner",
    kind: "human",
    displayName: "Owner",
  });
  ledger.provisionPrincipal({
    principalId: "agent-one",
    handle: "agent-one",
    kind: "agent",
    displayName: "Agent One",
  });
  ledger.provisionPrincipal({
    principalId: "human-outsider",
    handle: "outsider",
    kind: "human",
  });
  const created = ledger.createRoom("human-owner", {
    roomId: "room-general",
    workspaceKey: "workspace-main",
    kind: "channel",
    slug: "general",
    name: "General",
    visibility: "private",
    idempotencyKey: "create-general",
  });
  return { root, databasePath, ledger, created };
}

test("RoomLedger commits projection, event, and outbox once for an idempotent command", () => {
  const context = fixture();
  try {
    const added = context.ledger.addMember("human-owner", {
      roomId: "room-general",
      principalId: "agent-one",
      role: "member",
      basedOnRoomSeq: context.created.event.roomSeq,
      idempotencyKey: "add-agent-one",
    });
    const posted = context.ledger.postMessage("human-owner", {
      roomId: "room-general",
      body: "Please inspect the Room ledger.",
      mentionedPrincipalIds: ["agent-one"],
      idempotencyKey: "message-one",
    });
    const replay = context.ledger.postMessage("human-owner", {
      roomId: "room-general",
      body: "Please inspect the Room ledger.",
      mentionedPrincipalIds: ["agent-one"],
      idempotencyKey: "message-one",
    });

    assert.equal(added.deduplicated, false);
    assert.equal(posted.deduplicated, false);
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.value.messageId, posted.value.messageId);
    assert.equal(replay.event.eventId, posted.event.eventId);
    assert.equal(
      context.ledger.listMessages("human-owner", "room-general").messages
        .length,
      1,
    );
    assert.deepEqual(
      context.ledger
        .listInbox("agent-one")
        .map((item) => [item.eventId, item.state]),
      [[posted.event.eventId, "pending"]],
    );
    assert.deepEqual(
      context.ledger.listOutbox().map((entry) => entry.topic),
      ["room.event", "room.event", "room.event", "inbox.available"],
    );
    assert.deepEqual(
      context.ledger.listOutbox().map((entry) => entry.outboxSeq),
      [1, 2, 3, 4],
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger rejects idempotency reuse for a different intent", () => {
  const context = fixture();
  try {
    context.ledger.postMessage("human-owner", {
      roomId: "room-general",
      body: "first",
      idempotencyKey: "same-key",
    });
    assert.throws(
      () =>
        context.ledger.postMessage("human-owner", {
          roomId: "room-general",
          body: "different",
          idempotencyKey: "same-key",
        }),
      /idempotency key.*different intent/i,
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger maps protocol validation failures to typed domain errors", () => {
  const context = fixture();
  try {
    assertRoomError(
      () =>
        context.ledger.postMessage("human-owner", {
          roomId: "room-general",
          body: "",
          idempotencyKey: "empty-message",
        }),
      "invalid_argument",
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger allocates persistent, unused official avatars to Agents", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-avatar-"));
  const databasePath = path.join(root, "rooms.sqlite");
  try {
    const ledger = new RoomLedger(databasePath, { chooseAvatarIndex: () => 0 });
    const first = ledger.provisionPrincipal({
      principalId: "agent-avatar-one",
      handle: "avatar-one",
      kind: "agent",
    });
    const second = ledger.provisionPrincipal({
      principalId: "agent-avatar-two",
      handle: "avatar-two",
      kind: "agent",
    });
    assert.equal(first.avatarKey, "robot");
    assert.equal(second.avatarKey, "cat");
    assert.notEqual(first.avatarKey, second.avatarKey);
    ledger.close();

    const reopened = new RoomLedger(databasePath, {
      chooseAvatarIndex: () => 0,
    });
    assert.equal(
      reopened.provisionPrincipal({
        principalId: "agent-avatar-one",
        handle: "avatar-one",
        kind: "agent",
      }).avatarKey,
      "robot",
    );
    reopened.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RoomLedger does not expose private Room existence before membership authorization", () => {
  const context = fixture();
  try {
    const existing = assertRoomError(
      () =>
        context.ledger.postMessage("human-outsider", {
          roomId: "room-general",
          body: "probe",
          idempotencyKey: "probe-existing",
        }),
      "forbidden",
    );
    const missing = assertRoomError(
      () =>
        context.ledger.postMessage("human-outsider", {
          roomId: "room-missing",
          body: "probe",
          idempotencyKey: "probe-missing",
        }),
      "forbidden",
    );
    assert.equal(existing.message, missing.message);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger maps storage uniqueness conflicts to typed domain errors", () => {
  const context = fixture();
  try {
    assertRoomError(
      () =>
        context.ledger.provisionPrincipal({
          principalId: "human-duplicate-handle",
          handle: "owner",
          kind: "human",
        }),
      "conflict",
    );
    assertRoomError(
      () =>
        context.ledger.createRoom("human-owner", {
          roomId: "room-duplicate-slug",
          workspaceKey: "workspace-main",
          kind: "channel",
          slug: "general",
          name: "Duplicate",
          idempotencyKey: "create-duplicate-slug",
        }),
      "conflict",
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger freezes Room catalog pagination and never exposes non-member Rooms", () => {
  const context = fixture();
  try {
    const create = (roomId: string, owner = "human-owner") =>
      context.ledger.createRoom(owner, {
        roomId,
        workspaceKey: "workspace-main",
        kind: "channel",
        slug: roomId,
        name: roomId,
        idempotencyKey: `create-${roomId}`,
      });
    create("room-two");
    context.ledger.createRoom("human-outsider", {
      roomId: "room-secret",
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: "secret",
      name: "Secret",
      idempotencyKey: "create-secret",
    });
    create("room-three");

    const first = context.ledger.listRooms("human-owner", { limit: 2 });
    assert.deepEqual(
      first.items.map((item) => item.room.roomId),
      ["room-three", "room-two"],
    );
    assert.equal(first.hasMore, true);
    assert.ok(first.cursorBefore > 0);

    create("room-after-freeze");
    const second = context.ledger.listRooms("human-owner", {
      limit: 2,
      throughCatalogSeq: first.throughCatalogSeq,
      beforeCatalogSeq: first.cursorBefore,
    });
    assert.deepEqual(
      second.items.map((item) => item.room.roomId),
      ["room-general"],
    );
    assert.equal(second.hasMore, false);
    assert.equal(
      [...first.items, ...second.items].some(
        (item) => item.room.roomId === "room-secret",
      ),
      false,
    );
    assert.equal(
      [...first.items, ...second.items].some(
        (item) => item.room.roomId === "room-after-freeze",
      ),
      false,
    );
    assert.deepEqual(
      context.ledger
        .listRooms("human-owner", { limit: 10 })
        .items.map((item) => item.room.roomId),
      ["room-after-freeze", "room-three", "room-two", "room-general"],
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger reserves one Direct Room for each workspace participant pair", () => {
  const context = fixture();
  try {
    context.ledger.provisionPrincipal({
      principalId: "agent-two",
      handle: "agent-two",
      kind: "agent",
      displayName: "Agent Two",
    });
    const first = context.ledger.createRoom("human-owner", {
      roomId: "direct-one",
      workspaceKey: "workspace-main",
      kind: "direct",
      slug: "direct-one",
      name: "Owner and Agent One",
      idempotencyKey: "create-direct-one",
    });
    context.ledger.addMember("human-owner", {
      roomId: "direct-one",
      principalId: "agent-one",
      role: "member",
      basedOnRoomSeq: first.event.roomSeq,
      idempotencyKey: "complete-direct-one",
    });

    const duplicate = context.ledger.createRoom("human-owner", {
      roomId: "direct-duplicate",
      workspaceKey: "workspace-main",
      kind: "direct",
      slug: "direct-duplicate",
      name: "Duplicate",
      idempotencyKey: "create-direct-duplicate",
    });
    assertRoomError(
      () =>
        context.ledger.addMember("human-owner", {
          roomId: "direct-duplicate",
          principalId: "agent-one",
          role: "member",
          basedOnRoomSeq: duplicate.event.roomSeq,
          idempotencyKey: "complete-direct-duplicate",
        }),
      "conflict",
    );

    const otherPair = context.ledger.createRoom("human-owner", {
      roomId: "direct-two",
      workspaceKey: "workspace-main",
      kind: "direct",
      slug: "direct-two",
      name: "Owner and Agent Two",
      idempotencyKey: "create-direct-two",
    });
    context.ledger.addMember("human-owner", {
      roomId: "direct-two",
      principalId: "agent-two",
      role: "member",
      basedOnRoomSeq: otherPair.event.roomSeq,
      idempotencyKey: "complete-direct-two",
    });
    const rooms = context.ledger.listRooms("human-owner", { limit: 10 });
    const direct = rooms.items.find(
      (item) => item.room.roomId === "direct-one",
    );
    assert.equal(direct?.directPeer?.principalId, "agent-one");
    assert.equal(direct?.participantCount, 2);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger maps transaction admission contention without issuing a stray rollback", () => {
  const context = fixture();
  const blocker = new DatabaseSync(context.databasePath);
  try {
    blocker.exec("PRAGMA busy_timeout = 250; BEGIN IMMEDIATE");
    assertRoomError(
      () =>
        context.ledger.postMessage("human-owner", {
          roomId: "room-general",
          body: "blocked write",
          idempotencyKey: "blocked-write",
        }),
      "unavailable",
    );
  } finally {
    blocker.exec("ROLLBACK");
    blocker.close();
    assert.equal(
      context.ledger.syncRoom("human-owner", { roomId: "room-general" })
        .latestRoomSeq,
      context.created.event.roomSeq,
    );
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger replays semantically equivalent defaulted commands", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-idempotency-"));
  const ledger = new RoomLedger(path.join(root, "room-ledger.sqlite"));
  try {
    ledger.provisionPrincipal({
      principalId: "human-owner",
      handle: "owner",
      kind: "human",
    });
    const created = ledger.createRoom("human-owner", {
      roomId: "room-equivalent",
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: "equivalent",
      name: "  Equivalent  ",
      idempotencyKey: "create-equivalent",
    });
    const replay = ledger.createRoom("human-owner", {
      roomId: "room-equivalent",
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: "equivalent",
      name: "Equivalent",
      visibility: "private",
      idempotencyKey: "create-equivalent",
    });
    assert.equal(created.value.name, "Equivalent");
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.event.eventId, created.event.eventId);
  } finally {
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("RoomLedger requires membership and freezes bounded sync windows", () => {
  const context = fixture();
  try {
    assert.throws(
      () =>
        context.ledger.syncRoom("human-outsider", { roomId: "room-general" }),
      /not a Room member/,
    );
    const firstHead = context.created.event.roomSeq;
    for (let index = 0; index < 8; index += 1) {
      context.ledger.postMessage("human-owner", {
        roomId: "room-general",
        body: `message ${index + 1}`,
        idempotencyKey: `message-${index + 1}`,
      });
    }
    const frozen = context.ledger.syncRoom("human-owner", {
      roomId: "room-general",
      afterSeq: firstHead,
      throughSeq: firstHead + 5,
      limit: 2,
    });
    assert.equal(frozen.mode, "event_page");
    if (frozen.mode !== "event_page") throw new Error("expected event page");
    assert.deepEqual(
      frozen.events.map((event) => event.roomSeq),
      [2, 3],
    );
    assert.equal(frozen.cursorAfter, 3);
    assert.equal(frozen.throughSeq, 6);
    assert.equal(frozen.latestRoomSeq, 9);
    assert.equal(frozen.snapshot, null);

    const latest = context.ledger.syncRoom("human-owner", {
      roomId: "room-general",
      bootstrap: "latest",
      limit: 3,
    });
    assert.equal(latest.mode, "latest_bootstrap");
    if (latest.mode !== "latest_bootstrap")
      throw new Error("expected latest bootstrap");
    assert.deepEqual(
      latest.recentMessages.map((message) => message.roomSeq),
      [7, 8, 9],
    );
    assert.equal(latest.snapshotSeq, 9);
    assert.equal(latest.messageFloorSeq, 6);
    assert.equal(latest.snapshot?.memberships.length, 1);
    assert.ok(latest.responseBytes <= 1_048_576);

    const currentFromOrigin = context.ledger.syncRoom("human-owner", {
      roomId: "room-general",
      afterSeq: 0,
      limit: 2,
    });
    assert.equal(currentFromOrigin.mode, "event_page");
    if (currentFromOrigin.mode !== "event_page")
      throw new Error("expected event page");
    assert.equal(currentFromOrigin.snapshot, null);
    assert.deepEqual(
      currentFromOrigin.events.map((event) => event.roomSeq),
      [1, 2],
    );

    const historicalFromOrigin = context.ledger.syncRoom("human-owner", {
      roomId: "room-general",
      afterSeq: 0,
      throughSeq: 4,
      limit: 2,
    });
    assert.equal(historicalFromOrigin.mode, "event_page");
    if (historicalFromOrigin.mode !== "event_page")
      throw new Error("expected event page");
    assert.equal(historicalFromOrigin.snapshot, null);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger reopens durable Room, message, Inbox, and outbox state", () => {
  const context = fixture();
  try {
    context.ledger.addMember("human-owner", {
      roomId: "room-general",
      principalId: "agent-one",
      role: "member",
      basedOnRoomSeq: context.created.event.roomSeq,
      idempotencyKey: "add-agent-one",
    });
    const posted = context.ledger.postMessage("human-owner", {
      roomId: "room-general",
      body: "durable message",
      mentionedPrincipalIds: ["agent-one"],
      idempotencyKey: "durable-message",
    });
    context.ledger.close();

    const reopened = new RoomLedger(context.databasePath);
    try {
      assert.equal(
        reopened.listMessages("agent-one", "room-general").messages[0]
          ?.messageId,
        posted.value.messageId,
      );
      assert.equal(reopened.listInbox("agent-one").length, 1);
      assert.equal(reopened.listOutbox().length, 4);
      assert.equal(
        reopened.syncRoom("agent-one", { roomId: "room-general" })
          .latestRoomSeq,
        posted.event.roomSeq,
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger does not advance Inbox state on wake or sync, only explicit acknowledgement", () => {
  const context = fixture();
  try {
    context.ledger.addMember("human-owner", {
      roomId: "room-general",
      principalId: "agent-one",
      role: "member",
      basedOnRoomSeq: context.created.event.roomSeq,
      idempotencyKey: "add-agent-one",
    });
    const posted = context.ledger.postMessage("human-owner", {
      roomId: "room-general",
      body: "acknowledge explicitly",
      mentionedPrincipalIds: ["agent-one"],
      idempotencyKey: "message-for-ack",
    });

    context.ledger.postMessage("human-owner", {
      roomId: "room-general",
      body: "unrelated later message",
      idempotencyKey: "later-message",
    });

    context.ledger.syncRoom("agent-one", { roomId: "room-general" });
    assert.equal(context.ledger.listInbox("agent-one")[0]?.state, "pending");
    assert.equal(
      context.ledger
        .listOutbox()
        .find((entry) => entry.topic === "inbox.available")?.payload.body,
      undefined,
    );

    const acknowledged = context.ledger.acknowledgeMessage("agent-one", {
      roomId: "room-general",
      messageId: posted.value.messageId,
      basedOnRoomSeq: posted.event.roomSeq,
      idempotencyKey: "ack-message",
    });
    const replay = context.ledger.acknowledgeMessage("agent-one", {
      roomId: "room-general",
      messageId: posted.value.messageId,
      basedOnRoomSeq: posted.event.roomSeq,
      idempotencyKey: "ack-message",
    });
    assert.equal(acknowledged.value.state, "acknowledged");
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.event.eventId, acknowledged.event.eventId);
    const secondClient = context.ledger.acknowledgeMessage("agent-one", {
      roomId: "room-general",
      messageId: posted.value.messageId,
      basedOnRoomSeq: posted.event.roomSeq,
      idempotencyKey: "ack-message-second-client",
    });
    assert.equal(secondClient.deduplicated, true);
    assert.equal(secondClient.event.eventId, acknowledged.event.eventId);
    assert.equal(
      context.ledger.listInbox("agent-one")[0]?.state,
      "acknowledged",
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger acknowledges every observed Room Inbox item with one durable receipt", () => {
  const context = fixture();
  try {
    const member = context.ledger.addMember("human-owner", {
      roomId: "room-general",
      principalId: "agent-one",
      role: "member",
      basedOnRoomSeq: context.created.event.roomSeq,
      idempotencyKey: "ack-room-member",
    });
    const first = context.ledger.postMessage("human-owner", {
      roomId: "room-general",
      body: "First observed attention",
      mentionedPrincipalIds: ["agent-one"],
      idempotencyKey: "ack-room-first",
    });
    const second = context.ledger.postMessage("human-owner", {
      roomId: "room-general",
      body: "Second observed attention",
      mentionedPrincipalIds: ["agent-one"],
      idempotencyKey: "ack-room-second",
    });
    assert.equal(member.event.roomSeq < first.event.roomSeq, true);
    assert.equal(context.ledger.listInbox("agent-one").length, 2);
    const acknowledged = context.ledger.acknowledgeRoom("agent-one", {
      roomId: "room-general",
      throughRoomSeq: second.event.roomSeq,
      basedOnRoomSeq: second.event.roomSeq,
      idempotencyKey: "ack-room-through-second",
    });
    assert.equal(acknowledged.value.acknowledgedCount, 2);
    assert.equal(
      context.ledger
        .listInbox("agent-one")
        .every((item) => item.state === "acknowledged"),
      true,
    );
    assert.equal(
      context.ledger.listRooms("agent-one", { limit: 10 }).items[0]
        ?.pendingAttentionCount,
      0,
    );
    const replay = context.ledger.acknowledgeRoom("agent-one", {
      roomId: "room-general",
      throughRoomSeq: second.event.roomSeq,
      basedOnRoomSeq: second.event.roomSeq,
      idempotencyKey: "ack-room-through-second",
    });
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.event.eventId, acknowledged.event.eventId);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger acknowledges one exact Inbox item without consuming other visible work", () => {
  const context = fixture();
  try {
    context.ledger.addMember("human-owner", {
      roomId: "room-general",
      principalId: "agent-one",
      role: "member",
      basedOnRoomSeq: context.created.event.roomSeq,
      idempotencyKey: "exact-ack-member",
    });
    const first = context.ledger.postMessage("human-owner", {
      roomId: "room-general",
      body: "First exact attention",
      mentionedPrincipalIds: ["agent-one"],
      idempotencyKey: "exact-ack-first",
    });
    const second = context.ledger.postMessage("human-owner", {
      roomId: "room-general",
      body: "Second exact attention",
      mentionedPrincipalIds: ["agent-one"],
      idempotencyKey: "exact-ack-second",
    });
    const pending = context.ledger.listInbox("agent-one", {
      roomId: "room-general",
      pendingOnly: true,
      messageIds: [first.value.messageId, second.value.messageId],
    });
    assert.equal(pending.length, 2);
    const acknowledged = context.ledger.acknowledgeInboxItem("agent-one", {
      roomId: "room-general",
      inboxItemId: pending[0]!.inboxItemId,
      eventId: pending[0]!.eventId,
      basedOnRoomSeq: second.event.roomSeq,
      idempotencyKey: "exact-ack-item",
    });
    assert.equal(acknowledged.value.state, "acknowledged");
    assert.equal(acknowledged.event.type, "inbox.acknowledged");
    const remaining = context.ledger.listInbox("agent-one", {
      roomId: "room-general",
      pendingOnly: true,
      messageIds: [first.value.messageId, second.value.messageId],
    });
    assert.deepEqual(
      remaining.map((item) => item.eventId),
      [pending[1]!.eventId],
    );
    const replay = context.ledger.acknowledgeInboxItem("agent-one", {
      roomId: "room-general",
      inboxItemId: pending[0]!.inboxItemId,
      eventId: pending[0]!.eventId,
      basedOnRoomSeq: second.event.roomSeq,
      idempotencyKey: "exact-ack-item",
    });
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.event.eventId, acknowledged.event.eventId);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger can add an exact receipt after a prior range acknowledgement", () => {
  const context = fixture();
  try {
    context.ledger.addMember("human-owner", {
      roomId: "room-general",
      principalId: "agent-one",
      role: "member",
      basedOnRoomSeq: context.created.event.roomSeq,
      idempotencyKey: "range-before-exact-member",
    });
    const posted = context.ledger.postMessage("human-owner", {
      roomId: "room-general",
      body: "Range then exact",
      mentionedPrincipalIds: ["agent-one"],
      idempotencyKey: "range-before-exact-message",
    });
    const item = context.ledger.listInbox("agent-one")[0]!;
    context.ledger.acknowledgeRoom("agent-one", {
      roomId: "room-general",
      throughRoomSeq: posted.event.roomSeq,
      basedOnRoomSeq: posted.event.roomSeq,
      idempotencyKey: "range-before-exact-range",
    });
    const exact = context.ledger.acknowledgeInboxItem("agent-one", {
      roomId: "room-general",
      inboxItemId: item.inboxItemId,
      eventId: item.eventId,
      basedOnRoomSeq: context.ledger.syncRoom("agent-one", {
        roomId: "room-general",
      }).latestRoomSeq,
      idempotencyKey: "range-before-exact-item",
    });
    assert.equal(exact.value.state, "acknowledged");
    assert.equal(exact.event.type, "inbox.acknowledged");
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger derives direct Attention and bounds event pages by bytes", () => {
  const context = fixture();
  try {
    const direct = context.ledger.createRoom("human-owner", {
      roomId: "room-direct",
      workspaceKey: "workspace-main",
      kind: "direct",
      slug: "owner-agent-one",
      name: "Agent One",
      idempotencyKey: "create-direct",
    });
    context.ledger.addMember("human-owner", {
      roomId: "room-direct",
      principalId: "agent-one",
      role: "member",
      basedOnRoomSeq: direct.event.roomSeq,
      idempotencyKey: "add-direct-agent",
    });
    context.ledger.postMessage("human-owner", {
      roomId: "room-direct",
      body: "automatic direct attention",
      idempotencyKey: "direct-message",
    });
    assert.equal(
      context.ledger
        .listInbox("agent-one")
        .find((item) => item.roomId === "room-direct")?.reason,
      "direct_message",
    );

    for (let index = 0; index < 20; index += 1) {
      context.ledger.postMessage("human-owner", {
        roomId: "room-general",
        body: "x".repeat(100_000),
        idempotencyKey: `large-message-${index}`,
      });
    }
    const page = context.ledger.syncRoom("human-owner", {
      roomId: "room-general",
      afterSeq: 0,
      limit: 500,
    });
    assert.equal(page.mode, "event_page");
    if (page.mode !== "event_page") throw new Error("expected event page");
    assert.equal(page.hasMore, true);
    assert.ok(page.responseBytes <= 1_048_576);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1_048_576);
    assert.ok(page.events.length < 20);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger uses a global Inbox cursor across Rooms", () => {
  const context = fixture();
  try {
    for (const [roomId, slug, createKey, addKey, postKey] of [
      ["room-channel-a", "channel-a", "create-a", "add-a", "post-a"],
      ["room-channel-b", "channel-b", "create-b", "add-b", "post-b"],
    ] as const) {
      const room = context.ledger.createRoom("human-owner", {
        roomId,
        workspaceKey: "workspace-main",
        kind: "channel",
        slug,
        name: slug,
        idempotencyKey: createKey,
      });
      context.ledger.addMember("human-owner", {
        roomId,
        principalId: "agent-one",
        role: "member",
        basedOnRoomSeq: room.event.roomSeq,
        idempotencyKey: addKey,
      });
      context.ledger.postMessage("human-owner", {
        roomId,
        body: `message for ${slug}`,
        mentionedPrincipalIds: ["agent-one"],
        idempotencyKey: postKey,
      });
    }

    const firstPage = context.ledger.listInbox("agent-one", { limit: 1 });
    assert.equal(firstPage.length, 1);
    const secondPage = context.ledger.listInbox("agent-one", {
      afterInboxSeq: firstPage[0]!.inboxSeq,
      limit: 1,
    });
    assert.equal(secondPage.length, 1);
    assert.notEqual(secondPage[0]!.roomId, firstPage[0]!.roomId);
    assert.ok(secondPage[0]!.inboxSeq > firstPage[0]!.inboxSeq);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger latest bootstrap bounds the complete response and separates timeline messages", () => {
  const context = fixture();
  try {
    context.ledger.provisionPrincipal({
      principalId: "agent-large-name",
      handle: "agent-large-name",
      kind: "agent",
      displayName: "x".repeat(120),
    });
    context.ledger.addMember("human-owner", {
      roomId: "room-general",
      principalId: "agent-large-name",
      role: "member",
      basedOnRoomSeq: context.created.event.roomSeq,
      idempotencyKey: "add-large-name",
    });
    for (let index = 0; index < 20; index += 1) {
      context.ledger.postMessage("human-owner", {
        roomId: "room-general",
        body: "x".repeat(100_000),
        idempotencyKey: `bootstrap-large-${index}`,
      });
    }
    const bootstrap = context.ledger.syncRoom("human-owner", {
      roomId: "room-general",
      bootstrap: "latest",
      limit: 500,
    });
    assert.equal(bootstrap.mode, "latest_bootstrap");
    if (bootstrap.mode !== "latest_bootstrap")
      throw new Error("expected bootstrap");
    assert.equal("recentEvents" in bootstrap, false);
    assert.ok(bootstrap.recentMessages.length < 20);
    assert.ok(Buffer.byteLength(JSON.stringify(bootstrap)) <= 1_048_576);
    assert.equal(
      bootstrap.responseBytes,
      Buffer.byteLength(JSON.stringify(bootstrap)),
    );

    assertRoomError(
      () =>
        context.ledger.provisionPrincipal({
          principalId: "agent-oversized-name",
          handle: "agent-oversized-name",
          kind: "agent",
          displayName: "x".repeat(121),
        }),
      "invalid_argument",
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger bounds message list materialization by serialized bytes", () => {
  const context = fixture();
  try {
    for (let index = 0; index < 20; index += 1) {
      context.ledger.postMessage("human-owner", {
        roomId: "room-general",
        body: "x".repeat(100_000),
        idempotencyKey: `message-list-large-${index}`,
      });
    }
    const page = context.ledger.listMessages("human-owner", "room-general", {
      limit: 500,
    });
    assert.ok(page.messages.length > 0);
    assert.ok(page.messages.length < 20);
    assert.equal(page.hasMore, true);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1_048_576);
    assert.equal(page.responseBytes, Buffer.byteLength(JSON.stringify(page)));

    const bootstrap = context.ledger.syncRoom("human-owner", {
      roomId: "room-general",
      bootstrap: "latest",
      limit: 2,
    });
    assert.equal(bootstrap.mode, "latest_bootstrap");
    if (bootstrap.mode !== "latest_bootstrap")
      throw new Error("expected bootstrap");
    const older = context.ledger.listMessages("human-owner", "room-general", {
      beforeRoomSeq: bootstrap.recentMessages[0]!.roomSeq,
      throughRoomSeq: bootstrap.snapshotSeq,
      limit: 2,
    });
    assert.equal(older.mode, "backward");
    assert.equal(older.messages.length, 2);
    assert.ok(
      older.messages.at(-1)!.roomSeq < bootstrap.recentMessages[0]!.roomSeq,
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger bounds JSON-escaping expansion before message rows enter JavaScript", () => {
  const context = fixture();
  try {
    const escapedBody = '\n"\\\t\b'.repeat(20_000);
    assert.equal(escapedBody.length, 100_000);
    for (let index = 0; index < 8; index += 1) {
      context.ledger.postMessage("human-owner", {
        roomId: "room-general",
        body: escapedBody,
        idempotencyKey: `escaped-message-${index}`,
      });
    }
    const page = context.ledger.listMessages("human-owner", "room-general", {
      limit: 500,
    });
    assert.ok(page.messages.length > 0);
    assert.ok(page.messages.length < 8);
    assert.ok(page.messages.every((message) => message.body === escapedBody));
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1_048_576);
    const bootstrap = context.ledger.syncRoom("human-owner", {
      roomId: "room-general",
      bootstrap: "latest",
      limit: 500,
    });
    assert.ok(Buffer.byteLength(JSON.stringify(bootstrap)) <= 1_048_576);
    assert.ok(
      bootstrap.mode === "latest_bootstrap" &&
        bootstrap.recentMessages.every(
          (message) => message.body === escapedBody,
        ),
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger rejects SQLite-unsafe text and round-trips canonical Unicode", () => {
  const context = fixture();
  try {
    for (const displayName of [
      "Agent\u0000Name",
      "Agent\ud800Name",
      "Agent\udc00Name",
    ]) {
      assertRoomError(
        () =>
          context.ledger.provisionPrincipal({
            principalId: `unsafe-${displayName.charCodeAt(5)}`,
            handle: `unsafe-${displayName.charCodeAt(5)}`,
            kind: "agent",
            displayName,
          }),
        "invalid_argument",
      );
    }
    for (const name of ["Room\u0000Name", "Room\ud800Name", "Room\udc00Name"]) {
      assertRoomError(
        () =>
          context.ledger.createRoom("human-owner", {
            roomId: `unsafe-room-${name.charCodeAt(4)}`,
            workspaceKey: "workspace-main",
            kind: "channel",
            slug: `unsafe-room-${name.charCodeAt(4)}`,
            name,
            idempotencyKey: `unsafe-room-${name.charCodeAt(4)}`,
          }),
        "invalid_argument",
      );
    }
    for (const body of ["body\u0000text", "body\ud800text", "body\udc00text"]) {
      assertRoomError(
        () =>
          context.ledger.postMessage("human-owner", {
            roomId: "room-general",
            body,
            idempotencyKey: `unsafe-body-${body.charCodeAt(4)}`,
          }),
        "invalid_argument",
      );
    }

    const agent = context.ledger.provisionPrincipal({
      principalId: "agent-unicode",
      handle: "agent-unicode",
      kind: "agent",
      displayName: "Agent 🧭",
    });
    const room = context.ledger.createRoom("human-owner", {
      roomId: "room-unicode",
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: "unicode",
      name: 'Room 🧭\n"quoted"',
      idempotencyKey: "room-unicode",
    });
    context.ledger.addMember("human-owner", {
      roomId: room.value.roomId,
      principalId: agent.principalId,
      role: "member",
      basedOnRoomSeq: room.event.roomSeq,
      idempotencyKey: "add-agent-unicode",
    });
    const body = 'Message 🧭\n"quoted"\\tab\tbackspace\b';
    const posted = context.ledger.postMessage("human-owner", {
      roomId: room.value.roomId,
      body,
      idempotencyKey: "message-unicode",
    });
    const bootstrap = context.ledger.syncRoom("human-owner", {
      roomId: room.value.roomId,
      bootstrap: "latest",
    });
    assert.equal(bootstrap.mode, "latest_bootstrap");
    if (bootstrap.mode !== "latest_bootstrap")
      throw new Error("expected bootstrap");
    assert.equal(room.value.name, bootstrap.snapshot.room.name);
    assert.equal(
      bootstrap.snapshot.principals.find(
        (principal) => principal.principalId === agent.principalId,
      )?.displayName,
      agent.displayName,
    );
    assert.equal(posted.value.body, body);
    assert.equal(posted.event.payload.body, body);
    assert.equal(bootstrap.recentMessages.at(-1)?.body, body);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger forward and backward message traversal stay frozen across mid-page inserts", () => {
  const context = fixture();
  try {
    for (let index = 1; index <= 9; index += 1) {
      context.ledger.postMessage("human-owner", {
        roomId: "room-general",
        body: `frozen-${index}`,
        idempotencyKey: `frozen-${index}`,
      });
    }
    const throughRoomSeq = context.ledger.syncRoom("human-owner", {
      roomId: "room-general",
      bootstrap: "latest",
      limit: 1,
    }).throughSeq;

    const forwardBodies: string[] = [];
    let forwardAnchor = 0;
    let forwardHasMore = true;
    while (forwardHasMore) {
      const page = context.ledger.listMessages("human-owner", "room-general", {
        afterRoomSeq: forwardAnchor,
        throughRoomSeq,
        limit: 2,
      });
      forwardBodies.push(...page.messages.map((message) => message.body));
      forwardAnchor = page.cursorAfter;
      forwardHasMore = page.hasMore;
      if (forwardBodies.length === 2) {
        context.ledger.postMessage("human-owner", {
          roomId: "room-general",
          body: "newer-than-freeze",
          idempotencyKey: "newer-than-freeze",
        });
      }
    }

    const backwardBodies: string[] = [];
    let backwardAnchor = throughRoomSeq + 1;
    let backwardHasMore = true;
    while (backwardHasMore) {
      const page = context.ledger.listMessages("human-owner", "room-general", {
        beforeRoomSeq: backwardAnchor,
        throughRoomSeq,
        limit: 2,
      });
      backwardBodies.unshift(...page.messages.map((message) => message.body));
      backwardAnchor = page.cursorAfter;
      backwardHasMore = page.hasMore;
    }
    const expected = Array.from(
      { length: 9 },
      (_, index) => `frozen-${index + 1}`,
    );
    assert.deepEqual(forwardBodies, expected);
    assert.deepEqual(backwardBodies, expected);
    assert.equal(new Set(forwardBodies).size, expected.length);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger derives stable thread identity and reply attention from a parent message", () => {
  const context = fixture();
  try {
    context.ledger.addMember("human-owner", {
      roomId: "room-general",
      principalId: "agent-one",
      role: "member",
      basedOnRoomSeq: context.created.event.roomSeq,
      idempotencyKey: "thread-add-agent",
    });
    const parent = context.ledger.postMessage("human-owner", {
      roomId: "room-general",
      body: "parent",
      idempotencyKey: "thread-parent",
    });
    const reply = context.ledger.postMessage("agent-one", {
      roomId: "room-general",
      body: "first reply",
      replyToMessageId: parent.value.messageId,
      idempotencyKey: "thread-reply-one",
    });
    const nested = context.ledger.postMessage("human-owner", {
      roomId: "room-general",
      body: "nested reply",
      replyToMessageId: reply.value.messageId,
      idempotencyKey: "thread-reply-two",
    });
    assert.ok(reply.value.threadId);
    assert.equal(reply.value.rootMessageId, parent.value.messageId);
    assert.equal(nested.value.threadId, reply.value.threadId);
    assert.equal(nested.value.rootMessageId, parent.value.messageId);
    assert.equal(nested.value.replyToMessageId, reply.value.messageId);
    assert.equal(
      context.ledger
        .listInbox("human-owner")
        .some(
          (item) =>
            item.eventId === reply.event.eventId && item.reason === "mention",
        ),
      true,
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger normalizes ignored direct mentions before idempotency hashing", () => {
  const context = fixture();
  try {
    const room = context.ledger.createRoom("human-owner", {
      roomId: "room-direct-normalized",
      workspaceKey: "workspace-main",
      kind: "direct",
      slug: "direct-normalized",
      name: "Direct normalized",
      idempotencyKey: "create-direct-normalized",
    });
    context.ledger.addMember("human-owner", {
      roomId: "room-direct-normalized",
      principalId: "agent-one",
      role: "member",
      basedOnRoomSeq: room.event.roomSeq,
      idempotencyKey: "add-direct-normalized",
    });
    const posted = context.ledger.postMessage("human-owner", {
      roomId: "room-direct-normalized",
      body: "same semantic direct message",
      mentionedPrincipalIds: ["agent-one"],
      idempotencyKey: "direct-normalized-message",
    });
    const replay = context.ledger.postMessage("human-owner", {
      roomId: "room-direct-normalized",
      body: "same semantic direct message",
      idempotencyKey: "direct-normalized-message",
    });
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.event.eventId, posted.event.eventId);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger uses one canonical occurrence time for event and materialized state", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-event-time-"));
  let tick = Date.parse("2026-09-05T08:00:00.000Z");
  const ledger = new RoomLedger(path.join(root, "room-ledger.sqlite"), {
    now: () => new Date((tick += 1_000)),
  });
  try {
    ledger.provisionPrincipal({
      principalId: "human-owner",
      handle: "owner",
      kind: "human",
    });
    ledger.provisionPrincipal({
      principalId: "agent-one",
      handle: "agent-one",
      kind: "agent",
    });
    const room = ledger.createRoom("human-owner", {
      roomId: "room-time",
      workspaceKey: "workspace-main",
      kind: "direct",
      slug: "time",
      name: "Time",
      idempotencyKey: "create-time",
    });
    ledger.addMember("human-owner", {
      roomId: "room-time",
      principalId: "agent-one",
      role: "member",
      basedOnRoomSeq: room.event.roomSeq,
      idempotencyKey: "add-time-agent",
    });
    const posted = ledger.postMessage("human-owner", {
      roomId: "room-time",
      body: "canonical time",
      idempotencyKey: "post-time",
    });
    assert.equal(posted.value.createdAt, posted.event.createdAt);
    assert.equal(posted.event.payload.createdAt, posted.value.createdAt);

    const acknowledged = ledger.acknowledgeMessage("agent-one", {
      roomId: "room-time",
      messageId: posted.value.messageId,
      basedOnRoomSeq: posted.event.roomSeq,
      idempotencyKey: "ack-time",
    });
    assert.equal(
      acknowledged.value.acknowledgedAt,
      acknowledged.event.createdAt,
    );
    assert.equal(
      acknowledged.event.payload.acknowledgedAt,
      acknowledged.value.acknowledgedAt,
    );
  } finally {
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("RoomLedger rolls back stale membership changes without a partial event or outbox", () => {
  const context = fixture();
  try {
    assert.throws(
      () =>
        context.ledger.addMember("human-owner", {
          roomId: "room-general",
          principalId: "agent-one",
          role: "member",
          basedOnRoomSeq: 0,
          idempotencyKey: "stale-add",
        }),
      /changed: expected sequence 0/,
    );
    assert.equal(
      context.ledger.syncRoom("human-owner", { roomId: "room-general" })
        .latestRoomSeq,
      1,
    );
    assert.equal(context.ledger.listOutbox().length, 1);
    assert.equal(context.ledger.listInbox("agent-one").length, 0);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger enforces Human creation and role-aware membership ACL", () => {
  const context = fixture();
  try {
    assertRoomError(
      () =>
        context.ledger.createRoom("agent-one", {
          roomId: "room-agent-created",
          workspaceKey: "workspace-main",
          kind: "channel",
          slug: "agent-created",
          name: "Agent Created",
          idempotencyKey: "agent-create",
        }),
      "forbidden",
    );

    context.ledger.provisionPrincipal({
      principalId: "human-admin",
      handle: "admin",
      kind: "human",
    });
    context.ledger.provisionPrincipal({
      principalId: "agent-two",
      handle: "agent-two",
      kind: "agent",
    });
    context.ledger.addMember("human-owner", {
      roomId: "room-general",
      principalId: "human-admin",
      role: "admin",
      basedOnRoomSeq: context.created.event.roomSeq,
      idempotencyKey: "add-admin",
    });
    const head = context.ledger.syncRoom("human-owner", {
      roomId: "room-general",
    }).latestRoomSeq;
    assertRoomError(
      () =>
        context.ledger.addMember("human-admin", {
          roomId: "room-general",
          principalId: "agent-two",
          role: "owner",
          basedOnRoomSeq: head,
          idempotencyKey: "admin-grant-owner",
        }),
      "forbidden",
    );

    const direct = context.ledger.createRoom("human-owner", {
      roomId: "room-direct-limit",
      workspaceKey: "workspace-main",
      kind: "direct",
      slug: "direct-limit",
      name: "Direct Limit",
      idempotencyKey: "create-direct-limit",
    });
    const first = context.ledger.addMember("human-owner", {
      roomId: "room-direct-limit",
      principalId: "agent-one",
      role: "member",
      basedOnRoomSeq: direct.event.roomSeq,
      idempotencyKey: "add-direct-first",
    });
    assertRoomError(
      () =>
        context.ledger.addMember("human-owner", {
          roomId: "room-direct-limit",
          principalId: "agent-two",
          role: "member",
          basedOnRoomSeq: first.event.roomSeq,
          idempotencyKey: "add-direct-third",
        }),
      "conflict",
    );
    assertRoomError(
      () =>
        context.ledger.addMember("agent-one", {
          roomId: "room-direct-limit",
          principalId: "agent-two",
          role: "member",
          basedOnRoomSeq: first.event.roomSeq,
          idempotencyKey: "member-add-third",
        }),
      "forbidden",
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger outbox lease recovers after expiry and retry without duplicate completion", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-outbox-"));
  let currentTime = new Date("2026-09-05T08:00:00.000Z");
  const ledger = new RoomLedger(path.join(root, "room-ledger.sqlite"), {
    now: () => currentTime,
    createId: (() => {
      let next = 0;
      return (prefix: string) => `${prefix}-${++next}`;
    })(),
  });
  try {
    ledger.provisionPrincipal({
      principalId: "human-owner",
      handle: "owner",
      kind: "human",
    });
    ledger.createRoom("human-owner", {
      roomId: "room-outbox",
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: "outbox",
      name: "Outbox",
      idempotencyKey: "create-outbox",
    });

    const firstClaim = ledger.claimOutbox("worker-a", {
      limit: 1,
      leaseMs: 1_000,
    });
    assert.deepEqual(
      firstClaim.map((entry) => entry.outboxSeq),
      [1],
    );
    assert.equal(firstClaim[0]?.attemptCount, 1);
    assert.equal(firstClaim[0]?.leaseOwner, "worker-a");
    assert.equal(
      ledger.claimOutbox("worker-b", { limit: 1, leaseMs: 1_000 }).length,
      0,
    );

    currentTime = new Date("2026-09-05T08:00:01.001Z");
    assertRoomError(
      () => ledger.completeOutbox("worker-a", 1, firstClaim[0]!.leaseToken!),
      "conflict",
    );
    const recovered = ledger.claimOutbox("worker-b", {
      limit: 1,
      leaseMs: 1_000,
    });
    assert.equal(recovered[0]?.outboxSeq, 1);
    assert.equal(recovered[0]?.attemptCount, 2);
    assertRoomError(
      () => ledger.completeOutbox("worker-a", 1, firstClaim[0]!.leaseToken!),
      "conflict",
    );
    const completed = ledger.completeOutbox(
      "worker-b",
      1,
      recovered[0]!.leaseToken!,
    );
    assert.equal(completed.publishedBy, "worker-b");
    assert.equal(
      ledger.completeOutbox("worker-b", 1, recovered[0]!.leaseToken!)
        .publishedAt,
      completed.publishedAt,
    );

    ledger.postMessage("human-owner", {
      roomId: "room-outbox",
      body: "retry me",
      idempotencyKey: "retry-message",
    });
    const retryClaim = ledger.claimOutbox("worker-a", {
      limit: 1,
      leaseMs: 1_000,
    });
    assert.equal(retryClaim[0]?.outboxSeq, 2);
    const retryAt = "2026-09-05T08:00:10.000Z";
    const failed = ledger.failOutbox("worker-a", 2, {
      error: "temporary transport failure",
      retryAt,
      leaseToken: retryClaim[0]!.leaseToken!,
    });
    assert.equal(failed.availableAt, retryAt);
    assert.equal(failed.lastError, "temporary transport failure");
    assert.equal(failed.leaseOwner, undefined);
    assert.equal(ledger.claimOutbox("worker-b", { limit: 1 }).length, 0);

    currentTime = new Date(retryAt);
    const retried = ledger.claimOutbox("worker-b", { limit: 1 });
    assert.equal(retried[0]?.outboxSeq, 2);
    assert.equal(retried[0]?.attemptCount, 2);
    ledger.completeOutbox("worker-b", 2, retried[0]!.leaseToken!);

    assert.equal(
      ledger.prunePublishedOutbox({ throughOutboxSeq: 1, limit: 1 }),
      1,
    );
    assert.deepEqual(
      ledger.listOutbox().map((entry) => entry.outboxSeq),
      [2],
    );
  } finally {
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("RoomLedger fences stale outbox attempts even when worker identity is reused", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-outbox-fence-"));
  let currentTime = new Date("2026-09-05T08:00:00.000Z");
  const ledger = new RoomLedger(path.join(root, "room-ledger.sqlite"), {
    now: () => currentTime,
  });
  try {
    ledger.provisionPrincipal({
      principalId: "human-owner",
      handle: "owner",
      kind: "human",
    });
    ledger.createRoom("human-owner", {
      roomId: "room-fence",
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: "fence",
      name: "Fence",
      idempotencyKey: "create-fence",
    });
    const first = ledger.claimOutbox("stable-worker", { leaseMs: 1_000 })[0]!;
    currentTime = new Date("2026-09-05T08:00:01.001Z");
    const second = ledger.claimOutbox("stable-worker", { leaseMs: 1_000 })[0]!;
    assert.notEqual(second.leaseToken, first.leaseToken);
    assertRoomError(
      () =>
        ledger.completeOutbox(
          "stable-worker",
          first.outboxSeq,
          first.leaseToken!,
        ),
      "conflict",
    );
    ledger.completeOutbox(
      "stable-worker",
      second.outboxSeq,
      second.leaseToken!,
    );
  } finally {
    ledger.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("RoomLedger preserves expired outbox work across a process restart", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-outbox-restart-"));
  const databasePath = path.join(root, "room-ledger.sqlite");
  let currentTime = new Date("2026-09-05T08:00:00.000Z");
  try {
    const first = new RoomLedger(databasePath, { now: () => currentTime });
    first.provisionPrincipal({
      principalId: "human-owner",
      handle: "owner",
      kind: "human",
    });
    first.createRoom("human-owner", {
      roomId: "room-restart",
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: "restart",
      name: "Restart",
      idempotencyKey: "create-restart",
    });
    assert.equal(
      first.claimOutbox("worker-before-crash", { leaseMs: 1_000 }).length,
      1,
    );
    first.close();

    currentTime = new Date("2026-09-05T08:00:01.001Z");
    const reopened = new RoomLedger(databasePath, { now: () => currentTime });
    try {
      const recovered = reopened.claimOutbox("worker-after-restart", {
        leaseMs: 1_000,
      });
      assert.equal(recovered[0]?.outboxSeq, 1);
      assert.equal(recovered[0]?.attemptCount, 2);
      reopened.completeOutbox(
        "worker-after-restart",
        1,
        recovered[0]!.leaseToken!,
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RoomLedger refuses an unsupported future schema before mutating it", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-schema-"));
  const databasePath = path.join(root, "room-ledger.sqlite");
  try {
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA user_version = 8");
    database.close();
    assertRoomError(() => new RoomLedger(databasePath), "conflict");

    const verification = new DatabaseSync(databasePath);
    try {
      const row = verification.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };
      assert.equal(row.user_version, 8);
    } finally {
      verification.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RoomLedger migrates the v6 singleton Activation lane index to bounded ordered lanes", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-schema-v6-"));
  const databasePath = path.join(root, "room-ledger.sqlite");
  const initial = new RoomLedger(databasePath);
  initial.close();
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    DROP INDEX idx_room_activation_queued_lane;
    CREATE UNIQUE INDEX idx_room_activation_one_queued_lane
      ON room_activations(room_id, participant_id)
      WHERE state = 'queued';
    PRAGMA user_version = 6;
  `);
  legacy.close();

  try {
    const migrated = new RoomLedger(databasePath);
    migrated.close();
    const verification = new DatabaseSync(databasePath);
    try {
      const version = verification.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };
      assert.equal(version.user_version, 7);
      const indexes = verification
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'room_activations' ORDER BY name",
        )
        .all() as Array<{ name: string; sql: string | null }>;
      assert.equal(
        indexes.some(
          (index) => index.name === "idx_room_activation_one_queued_lane",
        ),
        false,
      );
      assert.match(
        indexes.find(
          (index) => index.name === "idx_room_activation_queued_lane",
        )?.sql ?? "",
        /CREATE INDEX(?! UNIQUE)[\s\S]*activation_seq/u,
      );
    } finally {
      verification.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createV1RoomSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE room_principals (
      principal_id TEXT PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE rooms (
      room_id TEXT PRIMARY KEY,
      workspace_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      visibility TEXT NOT NULL,
      next_seq INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      archived_at TEXT,
      UNIQUE (workspace_key, slug)
    ) STRICT;
    CREATE TABLE room_memberships (
      room_id TEXT NOT NULL REFERENCES rooms(room_id),
      principal_id TEXT NOT NULL REFERENCES room_principals(principal_id),
      role TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (room_id, principal_id)
    ) STRICT;
    INSERT INTO room_principals VALUES
      ('human-owner', 'owner', 'human', 'Owner', '2026-09-05T08:00:00.000Z'),
      ('agent-one', 'agent-one', 'agent', 'Agent One', '2026-09-05T08:00:00.000Z');
    PRAGMA user_version = 1;
  `);
}

test("RoomLedger migrates v1 catalogs and Direct pairs transactionally", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-schema-v1-"));
  const databasePath = path.join(root, "room-ledger.sqlite");
  const database = new DatabaseSync(databasePath);
  createV1RoomSchema(database);
  database.exec(`
    INSERT INTO rooms VALUES
      ('room-channel', 'workspace-main', 'channel', 'channel', 'Channel', 'private', 1, '2026-09-05T08:00:00.000Z', NULL),
      ('room-direct', 'workspace-main', 'direct', 'direct', 'Direct', 'private', 1, '2026-09-05T08:00:01.000Z', NULL);
    INSERT INTO room_memberships VALUES
      ('room-channel', 'human-owner', 'owner', '2026-09-05T08:00:00.000Z'),
      ('room-direct', 'human-owner', 'owner', '2026-09-05T08:00:01.000Z'),
      ('room-direct', 'agent-one', 'member', '2026-09-05T08:00:02.000Z');
  `);
  database.close();

  try {
    const ledger = new RoomLedger(databasePath);
    try {
      const page = ledger.listRooms("human-owner", { limit: 10 });
      assert.deepEqual(
        page.items.map((item) => item.room.roomId),
        ["room-direct", "room-channel"],
      );
      assert.equal(page.items[0]?.directPeer?.principalId, "agent-one");
    } finally {
      ledger.close();
    }
    const verification = new DatabaseSync(databasePath);
    try {
      const version = verification.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };
      assert.equal(version.user_version, 7);
      const catalog = verification
        .prepare("SELECT COUNT(*) AS count FROM room_catalog_memberships")
        .get() as { count: number };
      assert.equal(catalog.count, 3);
      const pairs = verification
        .prepare("SELECT COUNT(*) AS count FROM room_direct_pairs")
        .get() as {
        count: number;
      };
      assert.equal(pairs.count, 1);
    } finally {
      verification.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RoomLedger rejects duplicate legacy Direct pairs without a partial migration", () => {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "rah-room-schema-v1-conflict-"),
  );
  const databasePath = path.join(root, "room-ledger.sqlite");
  const database = new DatabaseSync(databasePath);
  createV1RoomSchema(database);
  database.exec(`
    INSERT INTO rooms VALUES
      ('direct-a', 'workspace-main', 'direct', 'direct-a', 'A', 'private', 1, '2026-09-05T08:00:00.000Z', NULL),
      ('direct-b', 'workspace-main', 'direct', 'direct-b', 'B', 'private', 1, '2026-09-05T08:00:01.000Z', NULL);
    INSERT INTO room_memberships VALUES
      ('direct-a', 'human-owner', 'owner', '2026-09-05T08:00:00.000Z'),
      ('direct-a', 'agent-one', 'member', '2026-09-05T08:00:00.000Z'),
      ('direct-b', 'human-owner', 'owner', '2026-09-05T08:00:01.000Z'),
      ('direct-b', 'agent-one', 'member', '2026-09-05T08:00:01.000Z');
  `);
  database.close();
  try {
    assertRoomError(() => new RoomLedger(databasePath), "conflict");
    const verification = new DatabaseSync(databasePath);
    try {
      const version = verification.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };
      assert.equal(version.user_version, 1);
      const table = verification
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'room_direct_pairs'",
        )
        .get();
      assert.equal(table, undefined);
    } finally {
      verification.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RoomLedger closes storage when avatar backfill initialization fails", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-init-close-"));
  const databasePath = path.join(root, "room-ledger.sqlite");
  const initial = new RoomLedger(databasePath);
  initial.provisionPrincipal({
    principalId: "agent-needs-backfill",
    handle: "agent-needs-backfill",
    kind: "agent",
  });
  initial.close();
  const raw = new DatabaseSync(databasePath);
  raw
    .prepare(
      "UPDATE room_principals SET avatar_key = NULL WHERE principal_id = ?",
    )
    .run("agent-needs-backfill");
  raw.close();
  try {
    assert.throws(
      () =>
        new RoomLedger(databasePath, {
          chooseAvatarIndex: () => {
            throw new Error("avatar entropy unavailable");
          },
        }),
      /avatar entropy unavailable/,
    );
    const reopened = new RoomLedger(databasePath, {
      chooseAvatarIndex: () => 0,
    });
    reopened.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RoomLedger installs the reverse dependency lookup index", () => {
  const context = fixture();
  try {
    const database = new DatabaseSync(context.databasePath);
    try {
      const plan = database
        .prepare(
          "EXPLAIN QUERY PLAN SELECT task_id FROM room_task_dependencies WHERE dependency_task_id = ?",
        )
        .all("task-one") as Array<{ detail: string }>;
      assert.match(
        plan.map((row) => row.detail).join("\n"),
        /idx_room_task_dependencies_reverse/,
      );
    } finally {
      database.close();
    }
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});
