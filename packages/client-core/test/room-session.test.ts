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
  const emptyPoll = applyRoomSync(
    first,
    { ...delivery(2, [], 2), snapshot: null },
    { afterSeq: 2 },
  );
  assert.equal(emptyPoll, first);

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

test("RoomSession serializes overlapping syncs so a late acknowledgement cannot regress state", async () => {
  const requestedAfterSequences: number[] = [];
  let syncCalls = 0;
  let releaseOlderAcknowledgement!: () => void;
  let markOlderAcknowledgementStarted!: () => void;
  let markNewerAcknowledgementStarted!: () => void;
  const olderAcknowledgementGate = new Promise<void>((resolve) => {
    releaseOlderAcknowledgement = resolve;
  });
  const olderAcknowledgementStarted = new Promise<void>((resolve) => {
    markOlderAcknowledgementStarted = resolve;
  });
  const newerAcknowledgementStarted = new Promise<void>((resolve) => {
    markNewerAcknowledgementStarted = resolve;
  });
  const client = new FakeRahClient(async (operation, input) => {
    if (operation === "room.sync") {
      const afterSeq = (input as ClientRoomSyncRequest).afterSeq ?? 0;
      requestedAfterSequences.push(afterSeq);
      syncCalls += 1;
      if (syncCalls === 1) return delivery(0, [event(1)], 2);
      return afterSeq === 0
        ? delivery(0, [event(1), event(2)], 2)
        : { ...delivery(1, [event(2)], 2), snapshot: null };
    }
    if (operation === "room.acknowledge") {
      const throughSeq = (input as ClientAcknowledgeRequest).throughSeq;
      if (throughSeq === 1) {
        markOlderAcknowledgementStarted();
        await olderAcknowledgementGate;
      } else {
        markNewerAcknowledgementStarted();
      }
      return { acknowledgedThrough: throughSeq };
    }
    throw new Error(`unexpected operation ${operation}`);
  });
  const session = new RoomSession({
    client,
    consumerId: "browser-overlap",
    roomId: "room-main",
  });

  const older = session.syncOnce();
  await olderAcknowledgementStarted;
  const newer = session.syncOnce();
  await Promise.race([
    newerAcknowledgementStarted,
    new Promise((resolve) => setTimeout(resolve, 20)),
  ]);
  releaseOlderAcknowledgement();
  await Promise.all([older, newer]);

  assert.equal(session.state.cursor, 2);
  assert.equal(session.state.acknowledgedThrough, 2);
  assert.deepEqual(requestedAfterSequences, [0, 1]);
});

test("RoomSession cold reload replays from local zero when the durable consumer cursor is ahead", async () => {
  const requestedAfterSequences: number[] = [];
  let syncCount = 0;
  const client = new FakeRahClient(async (operation, input) => {
    if (operation === "room.sync") {
      const syncInput = input as ClientRoomSyncRequest;
      requestedAfterSequences.push(syncInput.afterSeq ?? 0);
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
        (input as ClientRoomSyncRequest).afterSeq ?? 0,
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
      const afterSeq = (input as ClientRoomSyncRequest).afterSeq ?? 0;
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

test("RoomSession cold bootstrap retains only a trusted latest event window", async () => {
  const total = 100_000;
  const limit = 500;
  const requests: ClientRoomSyncRequest[] = [];
  const client = new FakeRahClient(async (operation, input) => {
    if (operation === "room.acknowledge") {
      return {
        acknowledgedThrough: (input as ClientAcknowledgeRequest).throughSeq,
      };
    }
    assert.equal(operation, "room.sync");
    const request = input as ClientRoomSyncRequest;
    requests.push(request);
    assert.equal(request.bootstrap, "latest");
    assert.equal(request.afterSeq, undefined);
    const eventFloorSeq = total - limit;
    return {
      cursorAfter: total,
      cursorBefore: 0,
      eventFloorSeq,
      events: Array.from({ length: limit }, (_, index) =>
        event(eventFloorSeq + index + 1),
      ),
      latestRoomSeq: total,
      snapshot: delivery(0, []).snapshot,
      snapshotSeq: total,
    };
  });
  const session = new RoomSession({
    client,
    consumerId: "browser-long-room",
    roomId: "room-main",
  });

  const result = await session.syncUntilCurrent({ limit, maxPages: 100 });

  assert.equal(result.caughtUp, true);
  assert.equal(result.pages, 1);
  assert.equal(requests.length, 1);
  assert.equal(result.state.cursor, total);
  assert.equal(result.state.events.length, limit);
  assert.equal(result.state.events[0]?.roomSeq, total - limit + 1);
  assert.equal(result.state.events.at(-1)?.roomSeq, total);
  assert.equal(result.state.eventFloorSeq, total - limit);
  assert.equal(result.state.historyComplete, false);
  assert.equal(result.state.snapshotSeq, total);
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
      cursorBefore: roomSeq,
      hasMoreAfter: roomSeq === 2,
      hasMoreBefore: request.afterSeq > 0,
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

test("MessageSession opens the 50-item Raft window, pages upward, and follows new Messages", async () => {
  const requests: Array<{
    afterSeq?: number;
    beforeSeq?: number;
    limit?: number;
  }> = [];
  const client = new FakeRahClient(async (operation, input) => {
    if (operation !== "message.list") {
      throw new Error(`unexpected operation ${operation}`);
    }
    const request = input as {
      afterSeq?: number;
      beforeSeq?: number;
      limit: number;
      roomId: string;
    };
    requests.push({
      ...(request.afterSeq === undefined ? {} : { afterSeq: request.afterSeq }),
      ...(request.beforeSeq === undefined
        ? {}
        : { beforeSeq: request.beforeSeq }),
      limit: request.limit,
    });
    const sequences =
      request.beforeSeq === 3 ? [1, 2] : request.afterSeq === 3 ? [4] : [3];
    return {
      cursorAfter: sequences.at(-1),
      cursorBefore: sequences[0],
      hasMoreAfter: request.beforeSeq !== undefined,
      hasMoreBefore: request.beforeSeq === undefined,
      messages: sequences.map((roomSeq) => ({
        actorId: "human-main",
        body: `message ${String(roomSeq)}`,
        createdAt,
        messageId: `message-${String(roomSeq)}`,
        roomId: request.roomId,
        roomSeq,
      })),
    };
  });
  const session = new MessageSession({ client, roomId: "room-main" });

  const latest = await session.syncUntilCurrent({ maxPages: 2 });
  assert.equal(latest.complete, true);
  assert.equal(latest.hasEarlier, true);
  assert.equal(latest.cursorBefore, 3);
  assert.deepEqual(
    latest.messages.map(({ roomSeq }) => roomSeq),
    [3],
  );

  const earlier = await session.loadEarlier();
  assert.equal(earlier.hasEarlier, false);
  assert.equal(earlier.cursorBefore, 1);
  assert.deepEqual(
    earlier.messages.map(({ roomSeq }) => roomSeq),
    [1, 2, 3],
  );

  const followed = await session.syncUntilCurrent({ maxPages: 2 });
  assert.equal(followed.complete, true);
  assert.equal(followed.cursorAfter, 4);
  assert.deepEqual(
    followed.messages.map(({ roomSeq }) => roomSeq),
    [1, 2, 3, 4],
  );
  assert.equal(session.state.complete, true);
  assert.deepEqual(requests, [
    { limit: 50 },
    { beforeSeq: 3, limit: 50 },
    { afterSeq: 3, limit: 50 },
  ]);
});
