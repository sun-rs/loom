import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type { RoomEvent } from "@rah-os/protocol";

import { collectWorkerPresentedContext } from "../src/worker-presented-context.ts";
import {
  migrateWorkerTargetReadPositions,
  recordWorkerTargetReadPosition,
} from "../src/worker-target-read-position.ts";

const at = "2026-09-09T00:00:00.000Z";

function ledger(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE principals (principal_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE rooms (room_id TEXT PRIMARY KEY) STRICT;
    INSERT INTO principals VALUES('human-1'),('agent-1');
    INSERT INTO rooms VALUES('room-1');
    CREATE TABLE messages (
      message_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      thread_id TEXT
    ) STRICT;
    CREATE TABLE room_events (
      event_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      room_seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      aggregate_id TEXT NOT NULL
    ) STRICT;
  `);
  migrateWorkerTargetReadPositions(database);
  return database;
}

function post(
  database: DatabaseSync,
  input: {
    actorId: string;
    messageId: string;
    roomSeq: number;
    threadId?: string;
  },
): RoomEvent {
  database
    .prepare("INSERT INTO messages VALUES(?, 'room-1', ?, ?)")
    .run(input.messageId, input.actorId, input.threadId ?? null);
  database
    .prepare(
      "INSERT INTO room_events VALUES(?, 'room-1', ?, 'message.posted', ?, ?)",
    )
    .run(
      `event-${input.roomSeq}`,
      input.roomSeq,
      input.actorId,
      input.messageId,
    );
  return {
    actorId: input.actorId,
    aggregateId: input.messageId,
    aggregateType: "message",
    createdAt: at,
    eventId: `event-${input.roomSeq}`,
    payload: {
      body: `body-${input.roomSeq}`,
      messageId: input.messageId,
      ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
    },
    roomId: "room-1",
    roomSeq: input.roomSeq,
    type: "message.posted",
  } as unknown as RoomEvent;
}

test("an event the participant has never been shown carries no presented context", () => {
  const database = ledger();
  try {
    const events = [
      post(database, {
        actorId: "human-1",
        messageId: "message-a",
        roomSeq: 3,
      }),
    ];
    assert.equal(
      collectWorkerPresentedContext(database, {
        events,
        participantId: "agent-1",
        roomId: "room-1",
      }),
      undefined,
    );
  } finally {
    database.close();
  }
});

test("a re-delivered event reports alreadyPresented with the participant's own later reply", () => {
  const database = ledger();
  try {
    const human = post(database, {
      actorId: "human-1",
      messageId: "message-follow-up",
      roomSeq: 8,
    });
    post(database, {
      actorId: "agent-1",
      messageId: "message-reply",
      roomSeq: 9,
    });
    // The freshness hold showed this participant through seq 8.
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      throughRoomSeq: 8,
      messageSeqs: [8],
      updatedAt: at,
    });
    const context = collectWorkerPresentedContext(database, {
      events: [human],
      participantId: "agent-1",
      roomId: "room-1",
    });
    assert.ok(context);
    assert.deepEqual(context.targets, [
      { presentedThroughSeq: 8, roomId: "room-1" },
    ]);
    assert.deepEqual(context.events, [
      {
        alreadyPresented: true,
        messageId: "message-follow-up",
        presentedThroughSeq: 8,
        respondedAfter: { count: 1, messageIds: ["message-reply"] },
        roomSeq: 8,
      },
    ]);
  } finally {
    database.close();
  }
});

test("respondedAfter counts only this participant's own later messages at the same target", () => {
  const database = ledger();
  try {
    const human = post(database, {
      actorId: "human-1",
      messageId: "message-room",
      roomSeq: 4,
    });
    // Another participant's later message, and this participant's own reply in
    // a Thread, are both at different targets or different actors.
    post(database, {
      actorId: "human-1",
      messageId: "message-other",
      roomSeq: 5,
    });
    post(database, {
      actorId: "agent-1",
      messageId: "message-thread",
      roomSeq: 6,
      threadId: "thread-1",
    });
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      throughRoomSeq: 6,
      messageSeqs: [4],
      updatedAt: at,
    });
    const context = collectWorkerPresentedContext(database, {
      events: [human],
      participantId: "agent-1",
      roomId: "room-1",
    });
    assert.ok(context);
    assert.deepEqual(context.events[0]?.respondedAfter, {
      count: 0,
      messageIds: [],
    });
  } finally {
    database.close();
  }
});

test("respondedAfter caps the listed message ids while reporting the whole count", () => {
  const database = ledger();
  try {
    const human = post(database, {
      actorId: "human-1",
      messageId: "message-root",
      roomSeq: 1,
    });
    for (let index = 0; index < 7; index += 1) {
      post(database, {
        actorId: "agent-1",
        messageId: `message-own-${index}`,
        roomSeq: 2 + index,
      });
    }
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      throughRoomSeq: 9,
      messageSeqs: [1],
      updatedAt: at,
    });
    const context = collectWorkerPresentedContext(database, {
      events: [human],
      participantId: "agent-1",
      roomId: "room-1",
    });
    assert.deepEqual(context?.events[0]?.respondedAfter, {
      count: 7,
      messageIds: [
        "message-own-0",
        "message-own-1",
        "message-own-2",
        "message-own-3",
        "message-own-4",
      ],
    });
  } finally {
    database.close();
  }
});

test("a Thread event is scored against the Thread read position, not the Room one", () => {
  const database = ledger();
  try {
    const threadMessage = post(database, {
      actorId: "human-1",
      messageId: "message-in-thread",
      roomSeq: 5,
      threadId: "thread-1",
    });
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      throughRoomSeq: 9,
      messageSeqs: [1],
      updatedAt: at,
    });
    assert.equal(
      collectWorkerPresentedContext(database, {
        events: [threadMessage],
        participantId: "agent-1",
        roomId: "room-1",
      }),
      undefined,
      "the Room-level position must not mark a Thread message as presented",
    );
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      threadId: "thread-1",
      throughRoomSeq: 5,
      messageSeqs: [5],
      updatedAt: at,
    });
    const context = collectWorkerPresentedContext(database, {
      events: [threadMessage],
      participantId: "agent-1",
      roomId: "room-1",
    });
    assert.deepEqual(context?.targets, [
      { presentedThroughSeq: 5, roomId: "room-1", threadId: "thread-1" },
    ]);
    assert.equal(context?.events[0]?.threadId, "thread-1");
  } finally {
    database.close();
  }
});

test("collecting presented context never advances the recorded read position", () => {
  const database = ledger();
  try {
    const human = post(database, {
      actorId: "human-1",
      messageId: "message-a",
      roomSeq: 3,
    });
    const later = post(database, {
      actorId: "human-1",
      messageId: "message-b",
      roomSeq: 8,
    });
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      throughRoomSeq: 3,
      updatedAt: at,
    });
    collectWorkerPresentedContext(database, {
      events: [human, later],
      participantId: "agent-1",
      roomId: "room-1",
    });
    assert.deepEqual(
      database
        .prepare(
          "SELECT through_room_seq FROM worker_target_read_positions WHERE participant_id = 'agent-1'",
        )
        .all()
        .map((row) => Number(row.through_room_seq)),
      [3],
    );
  } finally {
    database.close();
  }
});

test("non-message events are never scored against a target read position", () => {
  const database = ledger();
  try {
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      throughRoomSeq: 9,
      messageSeqs: [1],
      updatedAt: at,
    });
    const membership = {
      actorId: "human-1",
      aggregateId: "agent-1",
      aggregateType: "membership",
      createdAt: at,
      eventId: "event-2",
      payload: { participantId: "agent-1" },
      roomId: "room-1",
      roomSeq: 2,
      type: "member.added",
    } as unknown as RoomEvent;
    assert.equal(
      collectWorkerPresentedContext(database, {
        events: [membership],
        participantId: "agent-1",
        roomId: "room-1",
      }),
      undefined,
    );
  } finally {
    database.close();
  }
});

test("reading a later message does not label earlier unseen Human work as presented", () => {
  const database = ledger();
  try {
    const earlier = post(database, {
      actorId: "human-1",
      messageId: "unseen",
      roomSeq: 3,
    });
    post(database, { actorId: "human-1", messageId: "seen", roomSeq: 8 });
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      throughRoomSeq: 8,
      updatedAt: at,
    });
    assert.equal(
      collectWorkerPresentedContext(database, {
        events: [earlier],
        participantId: "agent-1",
        roomId: "room-1",
      }),
      undefined,
    );
  } finally {
    database.close();
  }
});
