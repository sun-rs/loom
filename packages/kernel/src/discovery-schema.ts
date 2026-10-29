import type { DatabaseSync } from "node:sqlite";
import { messageHasMention } from "@rah-os/protocol";

// A shared view of the existing canonical Message -> Room event mapping.
// Never derives sequence or message truth from provider logs.
export function initializeDiscoverySchema(db: DatabaseSync) {
  const hadMessageSearch =
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'message_search'",
      )
      .get() !== undefined;
  db.function("rah_casefold", { deterministic: true }, (value) =>
    String(value ?? "").toLowerCase(),
  );
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_room_thread ON messages(room_id, thread_id);
    CREATE INDEX IF NOT EXISTS idx_messages_thread_actor ON messages(thread_id, actor_id);
    CREATE INDEX IF NOT EXISTS idx_room_events_aggregate ON room_events(room_id, aggregate_type, aggregate_id, type);
    CREATE INDEX IF NOT EXISTS idx_tasks_source_message ON tasks(source_message_id);
    CREATE INDEX IF NOT EXISTS idx_room_events_payload_message ON room_events(room_id, json_extract(payload_json, '$.messageId'), type);
    CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(
      body,
      content='messages',
      content_rowid='rowid',
      tokenize='trigram case_sensitive 0'
    );
    CREATE TRIGGER IF NOT EXISTS message_search_insert AFTER INSERT ON messages BEGIN
      INSERT INTO message_search(rowid, body) VALUES (new.rowid, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS message_search_delete AFTER DELETE ON messages BEGIN
      INSERT INTO message_search(message_search, rowid, body) VALUES('delete', old.rowid, old.body);
    END;
    CREATE TRIGGER IF NOT EXISTS message_search_update AFTER UPDATE OF body ON messages BEGIN
      INSERT INTO message_search(message_search, rowid, body) VALUES('delete', old.rowid, old.body);
      INSERT INTO message_search(rowid, body) VALUES (new.rowid, new.body);
    END;
    DROP VIEW IF EXISTS discovery_messages;
    CREATE VIEW discovery_messages AS
      SELECT m.*, m.rowid AS message_order, COALESCE(
        (SELECT MIN(e.room_seq) FROM room_events e INDEXED BY idx_room_events_aggregate WHERE e.room_id = m.room_id
          AND e.aggregate_type = 'message' AND e.aggregate_id = m.message_id AND e.type = 'message.posted'),
        (SELECT MIN(e.room_seq) FROM tasks t JOIN room_events e INDEXED BY idx_room_events_aggregate
          ON e.room_id = t.room_id AND e.aggregate_type = 'task' AND e.aggregate_id = t.task_id AND e.type = 'task.created'
          WHERE t.source_message_id = m.message_id),
        (SELECT MIN(e.room_seq) FROM room_events e INDEXED BY idx_room_events_payload_message WHERE e.room_id = m.room_id
          AND json_extract(e.payload_json, '$.messageId') = m.message_id
          AND e.type IN ('task.progressed', 'task.submitted', 'review.submitted'))
      ) AS room_seq FROM messages m;
    CREATE TABLE IF NOT EXISTS human_activity_frontiers (
      principal_id TEXT NOT NULL REFERENCES principals(principal_id),
      room_id TEXT NOT NULL REFERENCES rooms(room_id), scope_id TEXT NOT NULL,
      read_seq INTEGER NOT NULL DEFAULT 0 CHECK(read_seq >= 0),
      done_seq INTEGER NOT NULL DEFAULT 0 CHECK(done_seq >= 0),
      PRIMARY KEY(principal_id, room_id, scope_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS human_activity_manual_unread (
      principal_id TEXT NOT NULL REFERENCES principals(principal_id) ON DELETE CASCADE,
      room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
      scope_id TEXT NOT NULL,
      through_seq INTEGER NOT NULL CHECK(through_seq >= 0),
      PRIMARY KEY(principal_id, room_id, scope_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS human_thread_follows (
      principal_id TEXT NOT NULL REFERENCES principals(principal_id),
      thread_id TEXT NOT NULL REFERENCES threads(thread_id),
      following INTEGER NOT NULL CHECK(following IN (0,1)),
      PRIMARY KEY(principal_id, thread_id)
    ) STRICT;
  `);
  // Schema 90: old unfollows have no captured frontier; never invent one.
  if (
    !db
      .prepare("PRAGMA table_info(human_thread_follows)")
      .all()
      .some((column) => column.name === "retained_seq")
  )
    db.exec(
      "ALTER TABLE human_thread_follows ADD COLUMN retained_seq INTEGER CHECK(retained_seq IS NULL OR retained_seq > 0)",
    );
  // Backfill once when adopting FTS; ordinary daemon starts never rebuild/hash history.
  if (!hadMessageSearch)
    db.exec("INSERT INTO message_search(message_search) VALUES('rebuild')");
  db.function("rah_has_mention", { deterministic: true }, (body, handle) => {
    return Number(messageHasMention(String(body), String(handle)));
  });
}
