import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { DeviceAuthPrincipal } from "../device-auth";
import { RoomDomainError } from "./room-errors";
import { RoomLedger } from "./room-ledger";
import {
  ROOM_READ_RESPONSE_BYTE_LIMIT,
  RoomReadService,
} from "./room-read-service";

const CURSOR_KEY = {
  generation: "test-generation-1",
  secret: Buffer.from("room-read-test-secret-room-read-test-secret", "utf8"),
};

function localPrincipal(): DeviceAuthPrincipal {
  return { kind: "local" };
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-read-"));
  const ledger = new RoomLedger(path.join(root, "rooms.sqlite"), {
    now: () => new Date("2026-09-05T08:00:00.000Z"),
    createId: (() => {
      let next = 0;
      return (prefix: string) => `${prefix}-${++next}`;
    })(),
  });
  const owner = ledger.ensureLocalHumanPrincipal({ handle: "owner" });
  ledger.provisionPrincipal({
    principalId: "agent-one",
    handle: "agent-one",
    kind: "agent",
  });
  const created = ledger.createRoom(owner.principalId, {
    roomId: "room-general",
    workspaceKey: "workspace-main",
    kind: "channel",
    slug: "general",
    name: "General",
    idempotencyKey: "create-general",
  });
  ledger.addMember(owner.principalId, {
    roomId: "room-general",
    principalId: "agent-one",
    role: "member",
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "add-agent-one",
  });
  const service = new RoomReadService(ledger, { cursorKey: CURSOR_KEY });
  return { root, ledger, owner, service };
}

test("RoomReadService injects one daemon-owned Human across local, management, and paired clients", () => {
  const context = fixture();
  try {
    const local = context.service.bootstrap(localPrincipal(), { roomId: "room-general" });
    const management = context.service.bootstrap({ kind: "management" }, {
      roomId: "room-general",
    });
    const paired = context.service.bootstrap({
      kind: "device",
      device: {
        id: "phone-one",
        name: "Phone",
        createdAt: "2026-09-05T08:00:00.000Z",
        lastSeenAt: "2026-09-05T08:00:00.000Z",
      },
    }, { roomId: "room-general" });
    assert.deepEqual(management.snapshot, local.snapshot);
    assert.deepEqual(paired.snapshot, local.snapshot);
    assert.throws(
      () => context.service.bootstrap(null, { roomId: "room-general" }),
      (error: unknown) => error instanceof RoomDomainError && error.code === "unauthenticated",
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService signs and scopes event cursors while preserving a frozen page chain", () => {
  const context = fixture();
  try {
    const bootstrap = context.service.bootstrap(localPrincipal(), {
      roomId: "room-general",
      limit: 1,
    });
    context.ledger.postMessage(context.owner.principalId, {
      roomId: "room-general",
      body: "one",
      idempotencyKey: "message-one",
    });
    context.ledger.postMessage(context.owner.principalId, {
      roomId: "room-general",
      body: "two",
      idempotencyKey: "message-two",
    });
    const first = context.service.readEvents(localPrincipal(), {
      roomId: "room-general",
      cursor: bootstrap.eventCursor,
      limit: 1,
    });
    assert.deepEqual(first.events.map((event) => event.type), ["message.posted"]);
    assert.equal(first.hasMore, true);

    context.ledger.postMessage(context.owner.principalId, {
      roomId: "room-general",
      body: "inserted-after-freeze",
      idempotencyKey: "message-three",
    });
    const second = context.service.readEvents(localPrincipal(), {
      roomId: "room-general",
      cursor: first.eventCursor,
      limit: 10,
    });
    assert.deepEqual(
      second.events.map((event) =>
        event.type === "message.posted" ? event.payload.body : event.type),
      ["two"],
    );
    assert.equal(second.hasMore, false);
    const live = context.service.readEvents(localPrincipal(), {
      roomId: "room-general",
      cursor: second.eventCursor,
      limit: 10,
    });
    assert.deepEqual(
      live.events.map((event) =>
        event.type === "message.posted" ? event.payload.body : event.type),
      ["inserted-after-freeze"],
    );

    const [body, signature] = first.eventCursor.split(".");
    const tamperedBody = `${body!.slice(0, -1)}${body!.endsWith("A") ? "B" : "A"}`;
    assert.throws(
      () => context.service.readEvents(localPrincipal(), {
        roomId: "room-general",
        cursor: `${tamperedBody}.${signature}`,
      }),
      (error: unknown) => error instanceof RoomDomainError && error.code === "invalid_argument",
    );
    assert.throws(
      () => context.service.readEvents(localPrincipal(), {
        roomId: "room-other",
        cursor: first.eventCursor,
      }),
      (error: unknown) => error instanceof RoomDomainError && error.code === "invalid_argument",
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService traverses frozen older history without duplicates across new inserts", () => {
  const context = fixture();
  try {
    for (let index = 1; index <= 7; index += 1) {
      context.ledger.postMessage(context.owner.principalId, {
        roomId: "room-general",
        body: `message-${index}`,
        idempotencyKey: `message-${index}`,
      });
    }
    const bootstrap = context.service.bootstrap(localPrincipal(), {
      roomId: "room-general",
      limit: 2,
    });
    assert.deepEqual(bootstrap.recentMessages.map((message) => message.body), [
      "message-6",
      "message-7",
    ]);
    assert.ok(bootstrap.olderMessagesCursor);

    context.ledger.postMessage(context.owner.principalId, {
      roomId: "room-general",
      body: "message-8",
      idempotencyKey: "message-8",
    });
    const collected = [...bootstrap.recentMessages];
    let cursor: string | undefined = bootstrap.olderMessagesCursor;
    while (cursor) {
      const page = context.service.readOlderMessages(localPrincipal(), {
        roomId: "room-general",
        cursor,
        limit: 2,
      });
      collected.unshift(...page.messages);
      cursor = page.olderMessagesCursor;
    }
    assert.deepEqual(collected.map((message) => message.body), [
      "message-1",
      "message-2",
      "message-3",
      "message-4",
      "message-5",
      "message-6",
      "message-7",
    ]);
    assert.equal(new Set(collected.map((message) => message.messageId)).size, 7);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService Inbox is always scoped to the authenticated Human", () => {
  const context = fixture();
  try {
    context.ledger.postMessage("agent-one", {
      roomId: "room-general",
      body: "owner attention",
      mentionedPrincipalIds: [context.owner.principalId],
      idempotencyKey: "owner-attention",
    });
    const first = context.service.readInbox(localPrincipal(), { limit: 1 });
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0]?.participantId, context.owner.principalId);
    const replay = context.service.readInbox({ kind: "management" }, {
      cursor: first.inboxCursor,
      limit: 1,
    });
    assert.equal(replay.items.length, 0);
    const bootstrap = context.service.bootstrap(localPrincipal(), { roomId: "room-general" });
    assert.throws(
      () => context.service.readInbox(localPrincipal(), { cursor: bootstrap.eventCursor }),
      (error: unknown) => error instanceof RoomDomainError && error.code === "invalid_argument",
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService keeps complete transport responses within the one MiB boundary", () => {
  const context = fixture();
  try {
    const initial = context.service.bootstrap(localPrincipal(), { roomId: "room-general" });
    const escapedBody = "\n\"\\\t\b".repeat(20_000);
    for (let index = 0; index < 8; index += 1) {
      context.ledger.postMessage(context.owner.principalId, {
        roomId: "room-general",
        body: escapedBody,
        idempotencyKey: `service-escaped-${index}`,
      });
    }
    const events = context.service.readEvents(localPrincipal(), {
      roomId: "room-general",
      cursor: initial.eventCursor,
      limit: 500,
    });
    const bootstrap = context.service.bootstrap(localPrincipal(), {
      roomId: "room-general",
      limit: 500,
    });
    assert.ok(Buffer.byteLength(JSON.stringify(events)) <= ROOM_READ_RESPONSE_BYTE_LIMIT);
    assert.ok(Buffer.byteLength(JSON.stringify(bootstrap)) <= ROOM_READ_RESPONSE_BYTE_LIMIT);
    assert.ok(events.events.length < 8);
    assert.ok(bootstrap.recentMessages.length < 8);
    assert.ok(events.events.every((event) =>
      event.type !== "message.posted" || event.payload.body === escapedBody));
    assert.ok(bootstrap.recentMessages.every((message) => message.body === escapedBody));
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService membership events atomically extend the client identity graph", () => {
  const context = fixture();
  try {
    const bootstrap = context.service.bootstrap(localPrincipal(), { roomId: "room-general" });
    context.ledger.provisionPrincipal({
      principalId: "agent-new",
      handle: "agent-new",
      kind: "agent",
      displayName: "New Agent",
    });
    context.ledger.addMember(context.owner.principalId, {
      roomId: "room-general",
      principalId: "agent-new",
      role: "member",
      basedOnRoomSeq: bootstrap.snapshotSeq,
      idempotencyKey: "add-agent-new",
    });
    const page = context.service.readEvents(localPrincipal(), {
      roomId: "room-general",
      cursor: bootstrap.eventCursor,
    });
    assert.equal(page.events.length, 1);
    const event = page.events[0]!;
    assert.equal(event.type, "membership.added");
    if (event.type !== "membership.added") throw new Error("expected membership event");
    assert.equal(event.payload.membership.principalId, "agent-new");
    assert.equal(event.payload.principal.principalId, "agent-new");
    assert.equal(event.payload.principal.displayName, "New Agent");
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService returns resource_exhausted instead of a cursor-stalled page", () => {
  const context = fixture();
  try {
    const initial = context.service.bootstrap(localPrincipal(), { roomId: "room-general" });
    context.ledger.postMessage(context.owner.principalId, {
      roomId: "room-general",
      body: "x".repeat(900),
      idempotencyKey: "oversized-for-tiny-budget",
    });
    const constrained = new RoomReadService(context.ledger, {
      cursorKey: CURSOR_KEY,
      responseByteLimit: 1_024,
    });

    assert.throws(
      () => constrained.readEvents(localPrincipal(), {
        roomId: "room-general",
        cursor: initial.eventCursor,
      }),
      (error: unknown) =>
        error instanceof RoomDomainError && error.code === "resource_exhausted",
    );
    assert.throws(
      () => constrained.bootstrap(localPrincipal(), { roomId: "room-general" }),
      (error: unknown) =>
        error instanceof RoomDomainError && error.code === "resource_exhausted",
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});
