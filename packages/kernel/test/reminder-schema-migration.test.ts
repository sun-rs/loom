import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { migrateReminderTargetsV36 } from "../src/schema.ts";

test("Reminder target migration preserves legacy anchors and backfills their delivery Room", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE rooms(room_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE messages(message_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE threads(thread_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE reminders(
      reminder_id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(room_id)
    ) STRICT;
    INSERT INTO rooms(room_id) VALUES('room-legacy');
    INSERT INTO reminders(reminder_id, room_id)
    VALUES('reminder-legacy', 'room-legacy');
  `);

  migrateReminderTargetsV36(database);

  assert.deepEqual(
    {
      ...database
        .prepare(
          "SELECT room_id, target_room_id, thread_id, root_message_id FROM reminders",
        )
        .get(),
    },
    {
      room_id: "room-legacy",
      root_message_id: null,
      target_room_id: "room-legacy",
      thread_id: null,
    },
  );
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
});
