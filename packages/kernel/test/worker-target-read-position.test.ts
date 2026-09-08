import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  findActiveHeldMessageDraftForTarget,
  migrateHeldMessageDraftLifecycle,
} from "../src/held-message-drafts.ts";
import { deriveWorkerMessageIdempotencyKey } from "../src/worker-message-identity.ts";
import {
  detectThreadContextParentSend,
  migrateWorkerTargetReadPositions,
  readWorkerTargetReadPosition,
  recordWorkerTargetReadPosition,
} from "../src/worker-target-read-position.ts";

function positions(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE principals (principal_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE rooms (room_id TEXT PRIMARY KEY) STRICT;
    INSERT INTO principals VALUES('agent-1'),('agent-2');
    INSERT INTO rooms VALUES('room-1'),('room-2'),('dm-room');
  `);
  migrateWorkerTargetReadPositions(database);
  return database;
}

const at = "2026-09-09T00:00:00.000Z";

test("a target read position is monotonic per (participant, target) and never rewinds", () => {
  const database = positions();
  try {
    assert.equal(
      readWorkerTargetReadPosition(database, {
        participantId: "agent-1",
        roomId: "room-1",
      }),
      undefined,
    );
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      throughRoomSeq: 7,
      updatedAt: at,
    });
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      throughRoomSeq: 3,
      updatedAt: at,
    });
    assert.equal(
      readWorkerTargetReadPosition(database, {
        participantId: "agent-1",
        roomId: "room-1",
      }),
      7,
      "an older page must not rewind what the participant already saw",
    );
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      throughRoomSeq: 0,
      updatedAt: at,
    });
    assert.equal(
      readWorkerTargetReadPosition(database, {
        participantId: "agent-1",
        roomId: "room-1",
      }),
      7,
      "Raft records nothing for a non-positive sequence",
    );
  } finally {
    database.close();
  }
});

test("two Threads in one Room, the Room itself, a DM and another participant are five separate positions", () => {
  const database = positions();
  try {
    const targets = [
      { participantId: "agent-1", roomId: "room-1" },
      { participantId: "agent-1", roomId: "room-1", threadId: "thread-a" },
      { participantId: "agent-1", roomId: "room-1", threadId: "thread-b" },
      { participantId: "agent-1", roomId: "dm-room" },
      { participantId: "agent-2", roomId: "room-1" },
    ];
    targets.forEach((target, index) =>
      recordWorkerTargetReadPosition(database, {
        ...target,
        throughRoomSeq: index + 1,
        updatedAt: at,
      }),
    );
    assert.deepEqual(
      targets.map((target) => readWorkerTargetReadPosition(database, target)),
      [1, 2, 3, 4, 5],
    );
    // A Thread read must not claim its parent Room, nor the reverse.
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      threadId: "thread-a",
      throughRoomSeq: 99,
      updatedAt: at,
    });
    assert.equal(
      readWorkerTargetReadPosition(database, {
        participantId: "agent-1",
        roomId: "room-1",
      }),
      1,
    );
  } finally {
    database.close();
  }
});

function drafts(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE held_message_drafts (
      held_draft_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      activation_id TEXT NOT NULL,
      thread_id TEXT,
      body TEXT NOT NULL,
      based_on_room_seq INTEGER NOT NULL,
      seen_up_to_seq INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
  migrateHeldMessageDraftLifecycle(database);
  return database;
}

function insertDraft(
  database: DatabaseSync,
  row: {
    id: string;
    participantId: string;
    roomId: string;
    threadId: string | null;
    expiresAtMs: number;
    state?: string;
  },
): void {
  database
    .prepare(
      `INSERT INTO held_message_drafts(
         held_draft_id, room_id, participant_id, activation_id, thread_id, body,
         based_on_room_seq, seen_up_to_seq, idempotency_key, state, expires_at_ms,
         created_at, updated_at
       ) VALUES(?, ?, ?, ?, ?, ?, 3, 4, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.roomId,
      row.participantId,
      "activation-1",
      row.threadId,
      `body of ${row.id}`,
      `key-${row.id}`,
      row.state ?? "held",
      row.expiresAtMs,
      at,
      at,
    );
}

test("the current held draft for a target ignores expiry, another participant, and the parent Room", () => {
  const database = drafts();
  const nowMs = Date.parse(at);
  try {
    insertDraft(database, {
      id: "live-room",
      participantId: "agent-1",
      roomId: "room-1",
      threadId: null,
      expiresAtMs: nowMs + 1,
    });
    insertDraft(database, {
      id: "expired-thread",
      participantId: "agent-1",
      roomId: "room-1",
      threadId: "thread-a",
      expiresAtMs: nowMs,
    });
    insertDraft(database, {
      id: "other-agent",
      participantId: "agent-2",
      roomId: "room-1",
      threadId: "thread-b",
      expiresAtMs: nowMs + 1,
    });
    insertDraft(database, {
      id: "live-thread",
      participantId: "agent-1",
      roomId: "room-1",
      threadId: "thread-b",
      expiresAtMs: nowMs + 1,
    });
    const find = (threadId: string | undefined, participantId = "agent-1") =>
      findActiveHeldMessageDraftForTarget(database, {
        participantId,
        roomId: "room-1",
        ...(threadId === undefined ? {} : { threadId }),
        nowMs,
      })?.held_draft_id;
    assert.equal(find(undefined), "live-room");
    assert.equal(find("thread-b"), "live-thread");
    assert.equal(
      find("thread-a"),
      undefined,
      "an expired draft is not returned, exactly as Raft returns null past its TTL",
    );
    assert.equal(find("thread-b", "agent-3"), undefined);
  } finally {
    database.close();
  }
});

test("the derived idempotency key separates content, target, Activation and read position", () => {
  const base = {
    participantId: "agent-1",
    activationId: "activation-1",
    roomId: "room-1",
    basedOnRoomSeq: 4,
    content: { kind: "compose" as const, body: "Answer" },
  };
  const key = deriveWorkerMessageIdempotencyKey(base);
  assert.equal(
    key,
    deriveWorkerMessageIdempotencyKey({ ...base }),
    "an identical retry of the same logical send must derive the same key",
  );
  const distinct = new Set([
    key,
    deriveWorkerMessageIdempotencyKey({
      ...base,
      content: { kind: "compose", body: "Different" },
    }),
    deriveWorkerMessageIdempotencyKey({ ...base, threadId: "thread-a" }),
    deriveWorkerMessageIdempotencyKey({ ...base, roomId: "room-2" }),
    deriveWorkerMessageIdempotencyKey({
      ...base,
      activationId: "activation-2",
    }),
    deriveWorkerMessageIdempotencyKey({ ...base, basedOnRoomSeq: 5 }),
    deriveWorkerMessageIdempotencyKey({
      ...base,
      content: { kind: "draft", heldDraftId: "held-1", reholdCount: 1 },
    }),
    deriveWorkerMessageIdempotencyKey({
      ...base,
      content: { kind: "draft", heldDraftId: "held-1", reholdCount: 2 },
    }),
  ]);
  assert.equal(distinct.size, 8);
});

test("Raft's narrow thread-context guard fires only when the latest read under a Room is a Thread", () => {
  const database = positions();
  const detect = (participantId = "agent-1", roomId = "room-1") =>
    detectThreadContextParentSend(database, { participantId, roomId });
  try {
    assert.equal(
      detect(),
      undefined,
      "no consumed Thread context means nothing to confirm",
    );
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      threadId: "thread-a",
      throughRoomSeq: 5,
      updatedAt: at,
    });
    assert.deepEqual(detect(), { threadId: "thread-a", threadSeq: 5 });
    assert.equal(
      detect("agent-2"),
      undefined,
      "another participant's Thread read never confirms this participant's send",
    );
    assert.equal(
      detect("agent-1", "room-2"),
      undefined,
      "a Thread read in another Room never confirms this Room's send",
    );
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      threadId: "thread-b",
      throughRoomSeq: 9,
      updatedAt: at,
    });
    assert.deepEqual(
      detect(),
      { threadId: "thread-b", threadSeq: 9 },
      "two Threads in one Room name the most recently read one",
    );
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      throughRoomSeq: 11,
      updatedAt: at,
    });
    assert.equal(
      detect(),
      undefined,
      "Raft's parentReadOrder >= latestThread.readOrder: a later parent read clears the guard",
    );
    recordWorkerTargetReadPosition(database, {
      participantId: "agent-1",
      roomId: "room-1",
      threadId: "thread-a",
      throughRoomSeq: 12,
      updatedAt: at,
    });
    assert.deepEqual(
      detect(),
      { threadId: "thread-a", threadSeq: 12 },
      "reading a Thread again after the parent re-arms the guard",
    );
  } finally {
    database.close();
  }
});
