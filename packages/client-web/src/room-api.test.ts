import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { ROOM_READ_HTTP_STATUS_BY_ERROR_CODE } from "@rah/runtime-protocol";

import {
  bootstrapRoom,
  listRooms,
  readOlderRoomMessages,
  readRoomEvents,
  readRoomInbox,
  RoomApiError,
  RoomApiProtocolError,
  createRoom,
  postRoomMessage,
} from "./room-api";
import {
  listRooms as listRoomsFromPublicApi,
  RAH_AUTH_REQUIRED_EVENT,
} from "./api";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete (globalThis as { window?: unknown }).window;
});

function response(mode: string, data: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ ok: true, data: { mode, ...data } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const SNAPSHOT = {
  room: {
    roomId: "room-one",
    workspaceKey: "workspace-main",
    kind: "channel",
    slug: "room-one",
    name: "Room One",
    visibility: "private",
    createdAt: "2026-09-05T08:00:00.000Z",
  },
  memberships: [{
    roomId: "room-one",
    principalId: "human-owner",
    role: "owner",
    joinedAt: "2026-09-05T08:00:00.000Z",
  }],
  principals: [{
    principalId: "human-owner",
    handle: "owner",
    kind: "human",
    displayName: "Owner",
    createdAt: "2026-09-05T08:00:00.000Z",
  }],
};

test("Room typed SDK is exported from the production API entry", () => {
  assert.equal(listRoomsFromPublicApi, listRooms);
});

test("Room typed SDK validates command receipts instead of trusting HTTP success", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    calls.push(new URL(String(input)).pathname);
    const operation = calls.length === 1 ? "create_room" : "post_message";
    return new Response(JSON.stringify({
      ok: true,
      data: {
        operation,
        roomId: "room-one",
        aggregateId: operation === "create_room" ? "room-one" : "message-one",
        roomSeq: calls.length,
        deduplicated: false,
      },
    }), { status: 200 });
  }) as typeof fetch;

  await createRoom({
    roomId: "room-one",
    workspaceKey: "workspace-main",
    kind: "channel",
    slug: "general",
    name: "General",
    idempotencyKey: "create-room-one",
  });
  await postRoomMessage({
    roomId: "room-one",
    body: "hello",
    idempotencyKey: "post-message-one",
  });
  assert.deepEqual(calls, [
    "/api/room/v1/rooms/create",
    "/api/room/v1/messages/post",
  ]);

  globalThis.fetch = (async () => new Response(JSON.stringify({
    ok: true,
    data: {
      operation: "add_member",
      roomId: "room-one",
      aggregateId: "message-two",
      roomSeq: 3,
      deduplicated: false,
    },
  }), { status: 200 })) as typeof fetch;
  await assert.rejects(
    postRoomMessage({ roomId: "room-one", body: "bad", idempotencyKey: "bad-receipt" }),
    RoomApiProtocolError,
  );
});

test("Room typed SDK owns all five read routes and shared authenticated transport", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const replies = [
    response("latest_bootstrap", {
      snapshot: SNAPSHOT,
      snapshotSeq: 1,
      latestRoomSeq: 1,
      recentMessages: [],
      eventCursor: "events",
    }),
    response("event_page", {
      events: [],
      latestRoomSeq: 1,
      eventCursor: "events",
      hasMore: false,
    }),
    response("older_messages", { messages: [], hasMore: false }),
    response("inbox_page", { items: [], inboxCursor: "inbox" }),
    response("room_list", { items: [], hasMore: false }),
  ];
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), init });
    return replies.shift()!;
  }) as typeof fetch;

  await bootstrapRoom({ roomId: "room-one" });
  await readRoomEvents({ roomId: "room-one", cursor: "events" });
  await readOlderRoomMessages({ roomId: "room-one", cursor: "older" });
  await readRoomInbox();
  await listRooms();

  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/api/room/v1/bootstrap",
    "/api/room/v1/events",
    "/api/room/v1/older-messages",
    "/api/room/v1/inbox",
    "/api/room/v1/rooms",
  ]);
  for (const call of calls) {
    assert.equal(call.init?.method, "POST");
    assert.equal(call.init?.credentials, "include");
    assert.equal(new Headers(call.init?.headers).get("x-rah-client"), null);
    assert.equal(new Headers(call.init?.headers).get("content-type"), "application/json");
  }
});

test("Room typed SDK preserves stable error code and status", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    ok: false,
    error: { code: "forbidden", message: "Room access is forbidden" },
  }), { status: 403 })) as typeof fetch;

  await assert.rejects(
    listRooms(),
    (error: unknown) =>
      error instanceof RoomApiError &&
      error.code === "forbidden" &&
      error.status === 403,
  );
});

test("Room typed SDK consumes every protocol-owned error status", async () => {
  for (const [code, status] of Object.entries(ROOM_READ_HTTP_STATUS_BY_ERROR_CODE)) {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      ok: false,
      error: { code, message: `safe ${code}` },
    }), { status })) as typeof fetch;
    await assert.rejects(
      listRooms(),
      (error: unknown) =>
        error instanceof RoomApiError && error.code === code && error.status === status,
      code,
    );
  }
});

test("Room typed SDK requests browser re-authentication on a typed 401", async () => {
  const events = new EventTarget();
  let authRequired = 0;
  events.addEventListener(RAH_AUTH_REQUIRED_EVENT, () => { authRequired += 1; });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { port: "43111", origin: "http://127.0.0.1:43111" },
      localStorage: { getItem: () => null },
      dispatchEvent: events.dispatchEvent.bind(events),
    },
  });
  let headers = new Headers();
  globalThis.fetch = (async (_input, init) => {
    headers = new Headers(init?.headers);
    return new Response(JSON.stringify({
      ok: false,
      error: { code: "unauthenticated", message: "Authentication required" },
    }), { status: 401 });
  }) as typeof fetch;

  await assert.rejects(listRooms(), (error: unknown) =>
    error instanceof RoomApiError && error.code === "unauthenticated");
  assert.equal(authRequired, 1);
  assert.equal(headers.get("x-rah-client"), "web");
});

test("Room typed SDK rejects non-JSON and mismatched operation envelopes", async () => {
  globalThis.fetch = (async () => new Response("<!doctype html>", { status: 200 })) as typeof fetch;
  await assert.rejects(listRooms(), RoomApiProtocolError);

  globalThis.fetch = (async () => response("inbox_page", {
    items: [],
    inboxCursor: "inbox",
  })) as typeof fetch;
  await assert.rejects(listRooms(), RoomApiProtocolError);
});

test("Room typed SDK rejects malformed list items and incomplete frozen cursors", async () => {
  globalThis.fetch = (async () => response("room_list", {
    items: [null],
    hasMore: true,
    roomListCursor: "next",
  })) as typeof fetch;
  await assert.rejects(listRooms(), RoomApiProtocolError);

  globalThis.fetch = (async () => response("room_list", {
    items: [],
    hasMore: true,
  })) as typeof fetch;
  await assert.rejects(listRooms(), RoomApiProtocolError);
});

test("Room typed SDK rejects an error envelope carried by HTTP 200", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    ok: false,
    error: { code: "forbidden", message: "Room access is forbidden" },
  }), { status: 200 })) as typeof fetch;
  await assert.rejects(listRooms(), RoomApiProtocolError);
});

test("Room typed SDK rejects cross-Room bootstrap, event, and history data", async () => {
  const otherRoom = "room-other";
  const otherSnapshot = {
    ...SNAPSHOT,
    room: { ...SNAPSHOT.room, roomId: otherRoom },
    memberships: SNAPSHOT.memberships.map((membership) => ({
      ...membership,
      roomId: otherRoom,
    })),
  };
  globalThis.fetch = (async () => response("latest_bootstrap", {
    snapshot: otherSnapshot,
    snapshotSeq: 1,
    latestRoomSeq: 1,
    recentMessages: [],
    eventCursor: "events",
  })) as typeof fetch;
  await assert.rejects(
    bootstrapRoom({ roomId: "room-requested" }),
    RoomApiProtocolError,
  );

  const message = {
    messageId: "message-other",
    roomId: otherRoom,
    actorId: "agent-one",
    body: "other Room",
    roomSeq: 2,
    createdAt: "2026-09-05T08:01:00.000Z",
  };
  globalThis.fetch = (async () => response("event_page", {
    events: [{
      eventId: "event-other",
      roomId: otherRoom,
      roomSeq: 2,
      type: "message.posted",
      actorId: "agent-one",
      aggregateType: "message",
      aggregateId: message.messageId,
      schemaVersion: 1,
      createdAt: message.createdAt,
      payload: {
        body: message.body,
        attention: [],
        createdAt: message.createdAt,
      },
    }],
    latestRoomSeq: 2,
    hasMore: false,
    eventCursor: "events",
  })) as typeof fetch;
  await assert.rejects(
    readRoomEvents({ roomId: "room-requested", cursor: "events" }),
    RoomApiProtocolError,
  );

  globalThis.fetch = (async () => response("older_messages", {
    messages: [message],
    hasMore: false,
  })) as typeof fetch;
  await assert.rejects(
    readOlderRoomMessages({ roomId: "room-requested", cursor: "older" }),
    RoomApiProtocolError,
  );
});
