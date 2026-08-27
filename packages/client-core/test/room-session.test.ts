import assert from "node:assert/strict";
import test from "node:test";

import { FakeRahClient } from "@rah-os/client-sdk";
import type {
  ClientAcknowledgeRequest,
  ClientRoomSyncRequest,
  ClientRoomSyncResponse,
  RoomEvent,
} from "@rah-os/protocol";

import {
  applyRoomSync,
  createEmptyRoomProjection,
  listMessagesBounded,
  loadOrCreateConsumerId,
  MessageSession,
  RoomSession,
} from "../src/index.ts";

const createdAt = "2026-08-26T00:00:00.000Z";

function event(roomSeq: number): RoomEvent {
  return {
    actorId: "human-main",
    aggregateId: `message-${String(roomSeq)}`,
    aggregateType: "message",
    createdAt,
    eventId: `event-${String(roomSeq)}`,
    idempotencyKey: `event-key-${String(roomSeq)}`,
    payload: { body: `message ${String(roomSeq)}` },
    roomId: "room-main",
    roomSeq,
    schemaVersion: 1,
    type: "message.posted",
  };
}

function delivery(
  cursorBefore: number,
  events: RoomEvent[],
  latestRoomSeq = events.at(-1)?.roomSeq ?? cursorBefore,
): ClientRoomSyncResponse {
  return {
    cursorAfter: events.at(-1)?.roomSeq ?? cursorBefore,
    cursorBefore,
    events,
    latestRoomSeq,
    snapshot: {
      members: [{ handle: "human", kind: "human", principalId: "human-main" }],
      room: {
        createdAt,
        kind: "channel",
        name: "Main Room",
        roomId: "room-main",
        slug: "main-room",
        workspaceId: "workspace-main",
      },
    },
  };
}

test("Room projection accepts identical replay and rejects gaps or divergence", () => {
  const initial = createEmptyRoomProjection("room-main");
  const first = applyRoomSync(initial, delivery(0, [event(1), event(2)]), {
    afterSeq: 0,
  });
  assert.equal(first.cursor, 2);
  assert.equal(first.events.length, 2);

  const replay = applyRoomSync(first, delivery(0, [event(1), event(2)]), {
    afterSeq: 0,
  });
  assert.deepEqual(replay, first);

  assert.throws(
    () => applyRoomSync(first, delivery(3, [event(4)]), { afterSeq: 3 }),
    /gap/i,
  );
  assert.throws(
    () =>
      applyRoomSync(
        first,
        {
          ...delivery(0, [event(1), event(2)]),
          events: [event(1), { ...event(2), eventId: "divergent-event" }],
        },
        { afterSeq: 0 },
      ),
    /divergent/i,
  );
});

test("RoomSession acknowledges only a validated canonical delivery", async () => {
  const operations: string[] = [];
  const client = new FakeRahClient(async (operation) => {
    operations.push(operation);
    if (operation === "room.sync") return delivery(0, [event(1)]);
    if (operation === "room.acknowledge") return { acknowledgedThrough: 1 };
    throw new Error(`unexpected operation ${operation}`);
  });
  const session = new RoomSession({
    client,
    consumerId: "browser-main",
    roomId: "room-main",
  });

  const state = await session.syncOnce();
  assert.equal(state.cursor, 1);
  assert.equal(state.acknowledgedThrough, 1);
  assert.deepEqual(operations, ["room.sync", "room.acknowledge"]);

  const invalidClient = new FakeRahClient(async (operation) => {
    if (operation === "room.sync") return delivery(2, [event(3)]);
    throw new Error("acknowledge must not run");
  });
  const invalid = new RoomSession({
    client: invalidClient,
    consumerId: "browser-invalid",
    roomId: "room-main",
  });
  await assert.rejects(invalid.syncOnce(), /gap/i);
  assert.equal(invalid.state.acknowledgedThrough, 0);
});

test("RoomSession cold reload replays from local zero when the durable consumer cursor is ahead", async () => {
  const requestedAfterSequences: number[] = [];
  let syncCount = 0;
  const client = new FakeRahClient(async (operation, input) => {
    if (operation === "room.sync") {
      const syncInput = input as ClientRoomSyncRequest;
      requestedAfterSequences.push(syncInput.afterSeq ?? -1);
      syncCount += 1;
      if (syncCount === 1) {
        return {
          ...delivery(3, [event(1), event(2)], 3),
          cursorAfter: 2,
        };
      }
      return {
        ...delivery(3, [event(3)], 3),
        snapshot: null,
      };
    }
    if (operation === "room.acknowledge") {
      return {
        acknowledgedThrough: (input as ClientAcknowledgeRequest).throughSeq,
      };
    }
    throw new Error(`unexpected operation ${operation}`);
  });
  const reloaded = new RoomSession({
    client,
    consumerId: "browser-stable",
    roomId: "room-main",
  });

  const firstPage = await reloaded.syncOnce({ limit: 2 });
  assert.equal(firstPage.cursor, 2);
  assert.equal(firstPage.acknowledgedThrough, 2);
  assert.equal(firstPage.snapshot?.room.roomId, "room-main");

  const recovered = await reloaded.syncOnce({ limit: 2 });
  assert.equal(recovered.cursor, 3);
  assert.equal(recovered.acknowledgedThrough, 3);
  assert.deepEqual(
    recovered.events.map(({ roomSeq }) => roomSeq),
    [1, 2, 3],
  );
  assert.deepEqual(requestedAfterSequences, [0, 2]);
});

test("a non-secret browser consumer identity survives reload without storing credentials", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  let generated = 0;
  const createId = () => `browser-${String(++generated)}`;

  const first = loadOrCreateConsumerId({
    createId,
    storage,
    storageKey: "rah.consumer",
  });
  const afterReload = loadOrCreateConsumerId({
    createId,
    storage,
    storageKey: "rah.consumer",
  });

  assert.equal(first, "browser-1");
  assert.equal(afterReload, first);
  assert.equal(generated, 1);
  assert.deepEqual([...values.entries()], [["rah.consumer", "browser-1"]]);
});

test("RoomSession retries from the same local cursor when acknowledgement is lost", async () => {
  const requestedAfterSequences: number[] = [];
  let acknowledgeAttempts = 0;
  const client = new FakeRahClient(async (operation, input) => {
    if (operation === "room.sync") {
      requestedAfterSequences.push(
        (input as ClientRoomSyncRequest).afterSeq ?? -1,
      );
      return delivery(0, [event(1)]);
    }
    if (operation === "room.acknowledge") {
      acknowledgeAttempts += 1;
      if (acknowledgeAttempts === 1) throw new Error("response lost");
      return { acknowledgedThrough: 1 };
    }
    throw new Error(`unexpected operation ${operation}`);
  });
  const session = new RoomSession({
    client,
    consumerId: "browser-retry",
    roomId: "room-main",
  });

  await assert.rejects(session.syncOnce(), /response lost/);
  assert.equal(session.state.cursor, 0);
  assert.equal(session.state.acknowledgedThrough, 0);

  const recovered = await session.syncOnce();
  assert.equal(recovered.cursor, 1);
  assert.equal(recovered.acknowledgedThrough, 1);
  assert.deepEqual(requestedAfterSequences, [0, 0]);
});

test("RoomSession catches up through bounded pages and reports remaining work", async () => {
  const requestedAfterSequences: number[] = [];
  const client = new FakeRahClient(async (operation, input) => {
    if (operation === "room.sync") {
      const afterSeq = (input as ClientRoomSyncRequest).afterSeq ?? -1;
      requestedAfterSequences.push(afterSeq);
      return {
        ...delivery(afterSeq, [event(afterSeq + 1)], 3),
        snapshot: afterSeq === 0 ? delivery(0, []).snapshot : null,
      };
    }
    if (operation === "room.acknowledge") {
      return {
        acknowledgedThrough: (input as ClientAcknowledgeRequest).throughSeq,
      };
    }
    throw new Error(`unexpected operation ${operation}`);
  });
  const session = new RoomSession({
    client,
    consumerId: "browser-bounded",
    roomId: "room-main",
  });

  const partial = await session.syncUntilCurrent({ limit: 1, maxPages: 2 });
  assert.equal(partial.caughtUp, false);
  assert.equal(partial.pages, 2);
  assert.equal(partial.state.cursor, 2);
  assert.equal(partial.state.latestRoomSeq, 3);

  const complete = await session.syncUntilCurrent({ limit: 1, maxPages: 2 });
  assert.equal(complete.caughtUp, true);
  assert.equal(complete.pages, 1);
  assert.equal(complete.state.cursor, 3);
  assert.deepEqual(requestedAfterSequences, [0, 1, 2]);
});

test("RoomSession fails closed when a bounded sync makes no progress behind latest", async () => {
  const client = new FakeRahClient(async (operation) => {
    if (operation === "room.sync") {
      return { ...delivery(0, [], 3), snapshot: delivery(0, []).snapshot };
    }
    if (operation === "room.acknowledge") {
      return { acknowledgedThrough: 0 };
    }
    throw new Error(`unexpected operation ${operation}`);
  });
  const session = new RoomSession({
    client,
    consumerId: "browser-stalled",
    roomId: "room-main",
  });

  await assert.rejects(
    session.syncUntilCurrent({ maxPages: 2 }),
    /made no progress/i,
  );
});

test("message queries page deterministically within a bounded budget", async () => {
  const requestedAfterSequences: number[] = [];
  const client = new FakeRahClient(async (operation, input) => {
    if (operation !== "message.list") {
      throw new Error(`unexpected operation ${operation}`);
    }
    const request = input as {
      afterSeq: number;
      roomId: string;
      threadId?: string;
    };
    requestedAfterSequences.push(request.afterSeq);
    const roomSeq = request.afterSeq === 0 ? 2 : 5;
    return {
      cursorAfter: roomSeq,
      hasMore: roomSeq === 2,
      messages: [
        {
          actorId: "human-main",
          body: `message ${String(roomSeq)}`,
          createdAt,
          messageId: `message-${String(roomSeq)}`,
          roomId: request.roomId,
          roomSeq,
          ...(request.threadId === undefined
            ? {}
            : { threadId: request.threadId }),
        },
      ],
    };
  });

  const complete = await listMessagesBounded(client, {
    limit: 1,
    maxPages: 3,
    roomId: "room-main",
    threadId: "thread-main",
  });
  assert.equal(complete.complete, true);
  assert.equal(complete.pages, 2);
  assert.equal(complete.cursorAfter, 5);
  assert.deepEqual(
    complete.messages.map(({ roomSeq }) => roomSeq),
    [2, 5],
  );
  assert.deepEqual(requestedAfterSequences, [0, 2]);
});

test("MessageSession resumes bounded message catch-up from its validated cursor", async () => {
  const requestedAfterSequences: number[] = [];
  const client = new FakeRahClient(async (operation, input) => {
    if (operation !== "message.list") {
      throw new Error(`unexpected operation ${operation}`);
    }
    const request = input as { afterSeq: number; roomId: string };
    requestedAfterSequences.push(request.afterSeq);
    const roomSeq = request.afterSeq + 1;
    return {
      cursorAfter: roomSeq,
      hasMore: roomSeq < 3,
      messages: [
        {
          actorId: "human-main",
          body: `message ${String(roomSeq)}`,
          createdAt,
          messageId: `message-${String(roomSeq)}`,
          roomId: request.roomId,
          roomSeq,
        },
      ],
    };
  });
  const session = new MessageSession({ client, roomId: "room-main" });

  const partial = await session.syncUntilCurrent({ limit: 1, maxPages: 2 });
  assert.equal(partial.complete, false);
  assert.equal(partial.cursorAfter, 2);
  assert.deepEqual(
    partial.messages.map(({ roomSeq }) => roomSeq),
    [1, 2],
  );

  const complete = await session.syncUntilCurrent({ limit: 1, maxPages: 2 });
  assert.equal(complete.complete, true);
  assert.equal(complete.cursorAfter, 3);
  assert.deepEqual(
    complete.messages.map(({ roomSeq }) => roomSeq),
    [1, 2, 3],
  );
  assert.equal(session.state.complete, true);
  assert.deepEqual(requestedAfterSequences, [0, 1, 2]);
});
