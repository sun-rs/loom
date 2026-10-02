import { syncRoomEventWindow } from "../src/room-sync.ts";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  conversationPredicate,
  selectConversationEvents,
} from "../src/conversation-delivery.ts";
import type { RoomEvent } from "@rah-os/protocol";

test("automatic targets have independent lower bounds and unrelated task status does not reintroduce its body", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE messages(message_id TEXT,room_id TEXT,thread_id TEXT); CREATE TABLE tasks(task_id TEXT,room_id TEXT,thread_id TEXT); CREATE TABLE room_events(room_seq INTEGER,type TEXT,aggregate_id TEXT,aggregate_type TEXT,room_id TEXT);
 INSERT INTO messages VALUES ('m1','r',NULL),('m2','r','a'),('m3','r','b'); INSERT INTO tasks VALUES ('ta','r','a'),('tb','r','b');`);
    const events = [
      ["m1", "message.posted", "message", 11],
      ["m2", "message.posted", "message", 7],
      ["m3", "message.posted", "message", 12],
      ["ta", "task.progressed", "task", 13],
      ["tb", "task.submitted", "task", 14],
    ].map(
      ([id, type, aggregateType, seq]) =>
        ({
          aggregateId: id,
          type,
          aggregateType,
          roomSeq: seq,
          roomId: "r",
          payload: {},
        }) as RoomEvent,
    );
    for (const e of events)
      db.prepare("INSERT INTO room_events VALUES(?,?,?,?,?)").run(
        e.roomSeq,
        e.type,
        e.aggregateId,
        e.aggregateType,
        e.roomId,
      );
    db.exec(
      "CREATE TABLE subscription_cursors(room_id TEXT,participant_id TEXT,consumer_id TEXT,last_seq INTEGER); CREATE TABLE rooms(room_id TEXT,next_seq INTEGER); INSERT INTO rooms VALUES('r',15)",
    );
    const pagePolicy = conversationPredicate({
      floors: { "": 10, a: 8 },
      directed: [],
    });
    const page = (afterSeq: number) =>
      syncRoomEventWindow(
        db,
        "agent",
        { roomId: "r", consumerId: "c", afterSeq, throughSeq: 14, limit: 1 },
        {
          eventPredicate: pagePolicy,
          eventFromRow: (row) =>
            events.find((e) => e.roomSeq === row.room_seq)!,
          snapshot: () => {
            throw new Error("not bootstrap");
          },
        },
      );
    assert.deepEqual(
      page(6).events.map((e) => e.aggregateId),
      ["m1"],
      "excluded messages do not use page budget",
    );
    assert.deepEqual(
      page(11).events.map((e) => e.aggregateId),
      ["ta"],
    );
    assert.equal(
      page(13).cursorAfter,
      14,
      "a filtered tail can be scanned without inventing body receipts",
    );
    const policy = { floors: { "": 10, a: 5 }, directed: [] };
    assert.deepEqual(
      selectConversationEvents(db, policy, events).map((e) => e.aggregateId),
      ["m1", "m2", "ta"],
    );
    const p = conversationPredicate(policy);
    assert.deepEqual(
      db
        .prepare(
          `SELECT aggregate_id FROM room_events WHERE ${p.sql} ORDER BY room_seq`,
        )
        .all(...p.params)
        .map((r) => r.aggregate_id),
      ["m2", "m1", "ta"],
    );
    assert.deepEqual(
      selectConversationEvents(
        db,
        { floors: { "": 10, a: 8 }, directed: [12] },
        events,
      ).map((e) => e.aggregateId),
      ["m1", "m3", "ta"],
    );
  } finally {
    db.close();
  }
});
