import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  RoomBootstrapReadResponse,
  RoomEventReadResponse,
  RoomInboxReadResponse,
  RoomListReadResponse,
  RoomOlderMessagesReadResponse,
} from "@rah/runtime-protocol";
import { ROOM_READ_HTTP_STATUS_BY_ERROR_CODE } from "@rah/runtime-protocol";

import type { DeviceAuthPrincipal } from "../device-auth";
import { roomError, type RoomErrorCode } from "./room-errors";
import { RoomLedger } from "./room-ledger";
import { RoomReadService } from "./room-read-service";
import {
  ROOM_READ_HTTP_RESPONSE_BYTE_LIMIT,
  RoomReadHttpAdapter,
  type RoomReadApplicationPort,
} from "./room-read-http-adapter";

const PRINCIPAL: DeviceAuthPrincipal = { kind: "local" };

const BOOTSTRAP: RoomBootstrapReadResponse = {
  mode: "latest_bootstrap",
  snapshot: {
    room: {
      roomId: "room-general",
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: "general",
      name: "General",
      visibility: "private",
      createdAt: "2026-09-05T08:00:00.000Z",
    },
    memberships: [],
    principals: [],
  },
  snapshotSeq: 1,
  latestRoomSeq: 1,
  recentMessages: [],
  eventCursor: "event-cursor",
};

const EVENTS: RoomEventReadResponse = {
  mode: "event_page",
  events: [],
  latestRoomSeq: 1,
  hasMore: false,
  eventCursor: "event-cursor",
};

const OLDER_MESSAGES: RoomOlderMessagesReadResponse = {
  mode: "older_messages",
  messages: [],
  hasMore: false,
};

const INBOX: RoomInboxReadResponse = {
  mode: "inbox_page",
  items: [],
  inboxCursor: "inbox-cursor",
};

const ROOMS: RoomListReadResponse = {
  mode: "room_list",
  items: [],
  hasMore: false,
};

function port(overrides: Partial<RoomReadApplicationPort> = {}): RoomReadApplicationPort {
  return {
    bootstrap: () => BOOTSTRAP,
    readEvents: () => EVENTS,
    readOlderMessages: () => OLDER_MESSAGES,
    readInbox: () => INBOX,
    listRooms: () => ROOMS,
    ...overrides,
  };
}

function body(response: ReturnType<RoomReadHttpAdapter["execute"]>): unknown {
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["content-length"], String(response.body.byteLength));
  return JSON.parse(response.body.toString("utf8"));
}

function realAdapterFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-http-read-"));
  const ledger = new RoomLedger(path.join(root, "rooms.sqlite"), {
    now: () => new Date("2026-09-05T08:00:00.000Z"),
  });
  const owner = ledger.ensureLocalHumanPrincipal({ handle: "owner" });
  const created = ledger.createRoom(owner.principalId, {
    roomId: "room-general",
    workspaceKey: "workspace-main",
    kind: "channel",
    slug: "general",
    name: "General",
    idempotencyKey: "create-general",
  });
  const service = new RoomReadService(ledger, {
    cursorKey: {
      generation: "http-test-generation",
      secret: Buffer.from("room-http-test-secret-room-http-test-secret", "utf8"),
    },
  });
  return {
    root,
    ledger,
    owner,
    created,
    adapter: new RoomReadHttpAdapter(service),
  };
}

test("RoomReadHttpAdapter dispatches the five typed read operations", () => {
  const calls: string[] = [];
  const adapter = new RoomReadHttpAdapter(port({
    bootstrap: () => { calls.push("bootstrap"); return BOOTSTRAP; },
    readEvents: () => { calls.push("events"); return EVENTS; },
    readOlderMessages: () => { calls.push("older_messages"); return OLDER_MESSAGES; },
    readInbox: () => { calls.push("inbox"); return INBOX; },
    listRooms: () => { calls.push("rooms"); return ROOMS; },
  }));

  const responses = [
    adapter.execute(PRINCIPAL, "bootstrap", { roomId: "room-general" }),
    adapter.execute(PRINCIPAL, "events", { roomId: "room-general", cursor: "event-cursor" }),
    adapter.execute(PRINCIPAL, "older_messages", {
      roomId: "room-general",
      cursor: "older-cursor",
    }),
    adapter.execute(PRINCIPAL, "inbox", {}),
    adapter.execute(PRINCIPAL, "rooms", {}),
  ];

  assert.deepEqual(calls, ["bootstrap", "events", "older_messages", "inbox", "rooms"]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 200, 200]);
  assert.deepEqual(responses.map((response) => body(response)), [
    { ok: true, data: BOOTSTRAP },
    { ok: true, data: EVENTS },
    { ok: true, data: OLDER_MESSAGES },
    { ok: true, data: INBOX },
    { ok: true, data: ROOMS },
  ]);
});

test("RoomReadHttpAdapter never accepts an unauthenticated application call", () => {
  let called = false;
  const adapter = new RoomReadHttpAdapter(port({
    bootstrap: () => { called = true; return BOOTSTRAP; },
  }));
  const response = adapter.execute(null, "bootstrap", { roomId: "room-general" });

  assert.equal(called, false);
  assert.equal(response.status, 401);
  assert.deepEqual(body(response), {
    ok: false,
    error: {
      code: "unauthenticated",
      message: "Room access requires an authenticated device",
    },
  });
});

test("RoomReadHttpAdapter maps every stable Room error without string matching", () => {
  const expected = Object.entries(ROOM_READ_HTTP_STATUS_BY_ERROR_CODE)
    .filter(([code]) => code !== "internal") as Array<[RoomErrorCode, number]>;

  for (const [code, status] of expected) {
    const adapter = new RoomReadHttpAdapter(port({
      bootstrap: () => { throw roomError(code, `safe ${code}`); },
    }));
    const response = adapter.execute(PRINCIPAL, "bootstrap", { roomId: "room-general" });
    assert.equal(response.status, status, code);
    const publicMessage = code === "unauthenticated"
      ? "Room access requires an authenticated device"
      : code === "forbidden"
        ? "Room access is forbidden"
        : `safe ${code}`;
    assert.deepEqual(body(response), {
      ok: false,
      error: { code, message: publicMessage },
    });
  }
});

test("RoomReadHttpAdapter rejects transport actor injection through protocol validation", () => {
  const context = realAdapterFixture();
  try {
    const response = context.adapter.execute(PRINCIPAL, "bootstrap", {
      roomId: "room-general",
      actorId: "agent-one",
    });
    assert.equal(response.status, 400);
    assert.deepEqual(body(response), {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "RoomBootstrapReadRequest contains unknown field actorId",
      },
    });
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadHttpAdapter does not reveal whether an inaccessible Room exists", () => {
  const context = realAdapterFixture();
  try {
    context.ledger.provisionPrincipal({
      principalId: "human-other",
      handle: "other",
      kind: "human",
    });
    context.ledger.createRoom("human-other", {
      roomId: "room-private",
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: "private",
      name: "Private",
      idempotencyKey: "create-private",
    });
    const inaccessible = context.adapter.execute(PRINCIPAL, "bootstrap", {
      roomId: "room-private",
    });
    const missing = context.adapter.execute(PRINCIPAL, "bootstrap", {
      roomId: "room-missing",
    });

    assert.equal(inaccessible.status, 403);
    assert.equal(missing.status, 403);
    assert.deepEqual(body(inaccessible), body(missing));
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadHttpAdapter hides unexpected implementation failures", () => {
  const adapter = new RoomReadHttpAdapter(port({
    bootstrap: () => { throw new Error("database file /private/secret is corrupt"); },
  }));
  const response = adapter.execute(PRINCIPAL, "bootstrap", { roomId: "room-general" });

  assert.equal(response.status, 500);
  assert.deepEqual(body(response), {
    ok: false,
    error: { code: "internal", message: "Internal Room read failure" },
  });
});

test("RoomReadHttpAdapter enforces the final wire-envelope byte limit", () => {
  const adapter = new RoomReadHttpAdapter(port({
    bootstrap: () => ({ ...BOOTSTRAP, eventCursor: "x".repeat(ROOM_READ_HTTP_RESPONSE_BYTE_LIMIT) }),
  }));
  const response = adapter.execute(PRINCIPAL, "bootstrap", { roomId: "room-general" });

  assert.equal(response.status, 413);
  assert.ok(response.body.byteLength <= ROOM_READ_HTTP_RESPONSE_BYTE_LIMIT);
  assert.deepEqual(body(response), {
    ok: false,
    error: {
      code: "resource_exhausted",
      message: "Room read response exceeds the one MiB wire budget",
    },
  });
});

test("RoomReadHttpAdapter returns the pre-serialized exact wire body", () => {
  const response = new RoomReadHttpAdapter(port()).execute(
    PRINCIPAL,
    "bootstrap",
    { roomId: "room-general" },
  );

  assert.ok(Buffer.isBuffer(response.body));
  assert.ok(response.body.byteLength <= ROOM_READ_HTTP_RESPONSE_BYTE_LIMIT);
  assert.equal(Number(response.headers["content-length"]), response.body.byteLength);
});

test("RoomReadHttpAdapter keeps a large message reachable below a maximal identity snapshot", () => {
  const context = realAdapterFixture();
  try {
    let basedOnRoomSeq = context.created.event.roomSeq;
    for (let index = 0; index < 499; index += 1) {
      const suffix = String(index).padStart(3, "0");
      const principalId = `agent-${suffix}-${"p".repeat(114)}`;
      context.ledger.provisionPrincipal({
        principalId,
        handle: `handle-${suffix}-${"h".repeat(113)}`,
        kind: "agent",
        displayName: "\u0001".repeat(120),
      });
      const added = context.ledger.addMember(context.owner.principalId, {
        roomId: "room-general",
        principalId,
        role: "member",
        basedOnRoomSeq,
        idempotencyKey: `add-${suffix}`,
      });
      basedOnRoomSeq = added.event.roomSeq;
    }
    const escapedBody = "\u0001".repeat(100_000);
    context.ledger.postMessage(context.owner.principalId, {
      roomId: "room-general",
      body: escapedBody,
      idempotencyKey: "large-message-after-large-snapshot",
    });

    const bootstrapResponse = context.adapter.execute(PRINCIPAL, "bootstrap", {
      roomId: "room-general",
      limit: 500,
    });
    assert.equal(bootstrapResponse.status, 200);
    assert.ok(bootstrapResponse.body.byteLength <= ROOM_READ_HTTP_RESPONSE_BYTE_LIMIT);
    const bootstrapEnvelope = body(bootstrapResponse) as {
      ok: true;
      data: RoomBootstrapReadResponse;
    };
    assert.equal(bootstrapEnvelope.ok, true);
    assert.equal(bootstrapEnvelope.data.snapshot.memberships.length, 500);
    assert.deepEqual(bootstrapEnvelope.data.recentMessages, []);
    assert.ok(bootstrapEnvelope.data.olderMessagesCursor);

    const olderResponse = context.adapter.execute(PRINCIPAL, "older_messages", {
      roomId: "room-general",
      cursor: bootstrapEnvelope.data.olderMessagesCursor,
      limit: 1,
    });
    assert.equal(olderResponse.status, 200);
    assert.ok(olderResponse.body.byteLength <= ROOM_READ_HTTP_RESPONSE_BYTE_LIMIT);
    const olderEnvelope = body(olderResponse) as {
      ok: true;
      data: RoomOlderMessagesReadResponse;
    };
    assert.equal(olderEnvelope.ok, true);
    assert.equal(olderEnvelope.data.messages.length, 1);
    assert.equal(olderEnvelope.data.messages[0]?.body, escapedBody);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});
