import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ROOM_SYNC_RESPONSE_MAX_BYTES, type RoomEvent } from "@rah-os/protocol";
import { syncRoomEventWindow } from "../src/room-sync.ts";

test("Worker display overhead reserves bytes without skipping the next complete event", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE rooms(room_id TEXT, next_seq INTEGER);
      CREATE TABLE subscription_cursors(room_id TEXT, participant_id TEXT, consumer_id TEXT, last_seq INTEGER);
      CREATE TABLE room_events(room_id TEXT, room_seq INTEGER);
      INSERT INTO rooms VALUES('room',3);
      INSERT INTO room_events VALUES('room',1),('room',2);`);
    const owners = {
      snapshot: () => null as any,
      eventFromRow: (row: Record<string, unknown>) =>
        ({
          roomId: "room",
          actorId: "principal",
          roomSeq: Number(row.room_seq),
          eventId: `event-${row.room_seq}`,
          type: "message.posted",
          aggregateType: "message",
          aggregateId: `message-${row.room_seq}`,
          idempotencyKey: `message-${row.room_seq}`,
          schemaVersion: 1,
          createdAt: "2026-09-11T00:00:00Z",
          payload: { body: "x".repeat(ROOM_SYNC_RESPONSE_MAX_BYTES / 2 - 400) },
        }) as RoomEvent,
      eventOverheadBytes: () => 1000,
      responseOverheadBytes: 48,
    };
    const first = syncRoomEventWindow(
      db,
      "principal",
      { roomId: "room", consumerId: "worker" },
      owners,
    );
    assert.equal(first.events.length, 1);
    assert.equal(first.cursorAfter, 1);
    assert.ok(
      Buffer.byteLength(JSON.stringify(first)) + 1048 <=
        ROOM_SYNC_RESPONSE_MAX_BYTES,
    );
    const second = syncRoomEventWindow(
      db,
      "principal",
      { roomId: "room", consumerId: "worker", afterSeq: first.cursorAfter },
      owners,
    );
    assert.equal(second.events.length, 1);
    assert.equal(second.events[0]!.roomSeq, 2);
    assert.equal(second.cursorAfter, 2);
  } finally {
    db.close();
  }
});
