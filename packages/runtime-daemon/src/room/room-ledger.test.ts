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
      context.ledger.listMessages("human-owner", "room-general").messages.length,
      1,
    );
    assert.deepEqual(
      context.ledger.listInbox("agent-one").map((item) => [item.eventId, item.state]),
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
      () => context.ledger.postMessage("human-owner", {
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
      () => context.ledger.postMessage("human-owner", {
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

test("RoomLedger does not expose private Room existence before membership authorization", () => {
  const context = fixture();
  try {
    const existing = assertRoomError(
      () => context.ledger.postMessage("human-outsider", {
        roomId: "room-general",
        body: "probe",
        idempotencyKey: "probe-existing",
      }),
      "forbidden",
    );
    const missing = assertRoomError(
      () => context.ledger.postMessage("human-outsider", {
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
      () => context.ledger.provisionPrincipal({
        principalId: "human-duplicate-handle",
        handle: "owner",
        kind: "human",
      }),
      "conflict",
    );
    assertRoomError(
      () => context.ledger.createRoom("human-owner", {
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

test("RoomLedger maps transaction admission contention without issuing a stray rollback", () => {
  const context = fixture();
  const blocker = new DatabaseSync(context.databasePath);
  try {
    blocker.exec("PRAGMA busy_timeout = 250; BEGIN IMMEDIATE");
    assertRoomError(
      () => context.ledger.postMessage("human-owner", {
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
      context.ledger.syncRoom("human-owner", { roomId: "room-general" }).latestRoomSeq,
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
      () => context.ledger.syncRoom("human-outsider", { roomId: "room-general" }),
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
    assert.deepEqual(frozen.events.map((event) => event.roomSeq), [2, 3]);
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
    if (latest.mode !== "latest_bootstrap") throw new Error("expected latest bootstrap");
    assert.deepEqual(latest.recentMessages.map((message) => message.roomSeq), [7, 8, 9]);
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
    if (currentFromOrigin.mode !== "event_page") throw new Error("expected event page");
    assert.equal(currentFromOrigin.snapshot, null);
    assert.deepEqual(currentFromOrigin.events.map((event) => event.roomSeq), [1, 2]);

    const historicalFromOrigin = context.ledger.syncRoom("human-owner", {
      roomId: "room-general",
      afterSeq: 0,
      throughSeq: 4,
      limit: 2,
    });
    assert.equal(historicalFromOrigin.mode, "event_page");
    if (historicalFromOrigin.mode !== "event_page") throw new Error("expected event page");
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
        reopened.listMessages("agent-one", "room-general").messages[0]?.messageId,
        posted.value.messageId,
      );
      assert.equal(reopened.listInbox("agent-one").length, 1);
      assert.equal(reopened.listOutbox().length, 4);
      assert.equal(
        reopened.syncRoom("agent-one", { roomId: "room-general" }).latestRoomSeq,
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
      context.ledger.listOutbox().find((entry) => entry.topic === "inbox.available")
        ?.payload.body,
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
    assert.equal(context.ledger.listInbox("agent-one")[0]?.state, "acknowledged");
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
      context.ledger.listInbox("agent-one").find((item) => item.roomId === "room-direct")
        ?.reason,
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
      ["room-direct-a", "direct-a", "create-a", "add-a", "post-a"],
      ["room-direct-b", "direct-b", "create-b", "add-b", "post-b"],
    ] as const) {
      const room = context.ledger.createRoom("human-owner", {
        roomId,
        workspaceKey: "workspace-main",
        kind: "direct",
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
    if (bootstrap.mode !== "latest_bootstrap") throw new Error("expected bootstrap");
    assert.equal("recentEvents" in bootstrap, false);
    assert.ok(bootstrap.recentMessages.length < 20);
    assert.ok(Buffer.byteLength(JSON.stringify(bootstrap)) <= 1_048_576);
    assert.equal(bootstrap.responseBytes, Buffer.byteLength(JSON.stringify(bootstrap)));

    assertRoomError(
      () => context.ledger.provisionPrincipal({
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
    if (bootstrap.mode !== "latest_bootstrap") throw new Error("expected bootstrap");
    const older = context.ledger.listMessages("human-owner", "room-general", {
      beforeRoomSeq: bootstrap.recentMessages[0]!.roomSeq,
      throughRoomSeq: bootstrap.snapshotSeq,
      limit: 2,
    });
    assert.equal(older.mode, "backward");
    assert.equal(older.messages.length, 2);
    assert.ok(older.messages.at(-1)!.roomSeq < bootstrap.recentMessages[0]!.roomSeq);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomLedger bounds JSON-escaping expansion before message rows enter JavaScript", () => {
  const context = fixture();
  try {
    const escapedBody = "\u0000\n\"\\\t".repeat(20_000);
    assert.equal(escapedBody.length, 100_000);
    for (let index = 0; index < 8; index += 1) {
      context.ledger.postMessage("human-owner", {
        roomId: "room-general",
        body: escapedBody,
        idempotencyKey: `escaped-message-${index}`,
      });
    }
    const page = context.ledger.listMessages("human-owner", "room-general", { limit: 500 });
    assert.ok(page.messages.length > 0);
    assert.ok(page.messages.length < 8);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 1_048_576);
    const bootstrap = context.ledger.syncRoom("human-owner", {
      roomId: "room-general",
      bootstrap: "latest",
      limit: 500,
    });
    assert.ok(Buffer.byteLength(JSON.stringify(bootstrap)) <= 1_048_576);
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
    const expected = Array.from({ length: 9 }, (_, index) => `frozen-${index + 1}`);
    assert.deepEqual(forwardBodies, expected);
    assert.deepEqual(backwardBodies, expected);
    assert.equal(new Set(forwardBodies).size, expected.length);
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
    now: () => new Date(tick += 1_000),
  });
  try {
    ledger.provisionPrincipal({ principalId: "human-owner", handle: "owner", kind: "human" });
    ledger.provisionPrincipal({ principalId: "agent-one", handle: "agent-one", kind: "agent" });
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
    assert.equal(acknowledged.value.acknowledgedAt, acknowledged.event.createdAt);
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
      () => context.ledger.addMember("human-owner", {
        roomId: "room-general",
        principalId: "agent-one",
        role: "member",
        basedOnRoomSeq: 0,
        idempotencyKey: "stale-add",
      }),
      /changed: expected sequence 0/,
    );
    assert.equal(
      context.ledger.syncRoom("human-owner", { roomId: "room-general" }).latestRoomSeq,
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
      () => context.ledger.createRoom("agent-one", {
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
      () => context.ledger.addMember("human-admin", {
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
      () => context.ledger.addMember("human-owner", {
        roomId: "room-direct-limit",
        principalId: "agent-two",
        role: "member",
        basedOnRoomSeq: first.event.roomSeq,
        idempotencyKey: "add-direct-third",
      }),
      "conflict",
    );
    assertRoomError(
      () => context.ledger.addMember("agent-one", {
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

    const firstClaim = ledger.claimOutbox("worker-a", { limit: 1, leaseMs: 1_000 });
    assert.deepEqual(firstClaim.map((entry) => entry.outboxSeq), [1]);
    assert.equal(firstClaim[0]?.attemptCount, 1);
    assert.equal(firstClaim[0]?.leaseOwner, "worker-a");
    assert.equal(ledger.claimOutbox("worker-b", { limit: 1, leaseMs: 1_000 }).length, 0);

    currentTime = new Date("2026-09-05T08:00:01.001Z");
    assertRoomError(
      () => ledger.completeOutbox("worker-a", 1, firstClaim[0]!.leaseToken!),
      "conflict",
    );
    const recovered = ledger.claimOutbox("worker-b", { limit: 1, leaseMs: 1_000 });
    assert.equal(recovered[0]?.outboxSeq, 1);
    assert.equal(recovered[0]?.attemptCount, 2);
    assertRoomError(
      () => ledger.completeOutbox("worker-a", 1, firstClaim[0]!.leaseToken!),
      "conflict",
    );
    const completed = ledger.completeOutbox("worker-b", 1, recovered[0]!.leaseToken!);
    assert.equal(completed.publishedBy, "worker-b");
    assert.equal(
      ledger.completeOutbox("worker-b", 1, recovered[0]!.leaseToken!).publishedAt,
      completed.publishedAt,
    );

    ledger.postMessage("human-owner", {
      roomId: "room-outbox",
      body: "retry me",
      idempotencyKey: "retry-message",
    });
    const retryClaim = ledger.claimOutbox("worker-a", { limit: 1, leaseMs: 1_000 });
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

    assert.equal(ledger.prunePublishedOutbox({ throughOutboxSeq: 1, limit: 1 }), 1);
    assert.deepEqual(ledger.listOutbox().map((entry) => entry.outboxSeq), [2]);
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
    ledger.provisionPrincipal({ principalId: "human-owner", handle: "owner", kind: "human" });
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
      () => ledger.completeOutbox("stable-worker", first.outboxSeq, first.leaseToken!),
      "conflict",
    );
    ledger.completeOutbox("stable-worker", second.outboxSeq, second.leaseToken!);
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
    assert.equal(first.claimOutbox("worker-before-crash", { leaseMs: 1_000 }).length, 1);
    first.close();

    currentTime = new Date("2026-09-05T08:00:01.001Z");
    const reopened = new RoomLedger(databasePath, { now: () => currentTime });
    try {
      const recovered = reopened.claimOutbox("worker-after-restart", { leaseMs: 1_000 });
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
    database.exec("PRAGMA user_version = 2");
    database.close();
    assertRoomError(() => new RoomLedger(databasePath), "conflict");

    const verification = new DatabaseSync(databasePath);
    try {
      const row = verification.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };
      assert.equal(row.user_version, 2);
    } finally {
      verification.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
