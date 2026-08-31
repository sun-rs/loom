import type { DatabaseSync } from "node:sqlite";
import { integer, text } from "./sqlite-row.ts";

// Existing pre-collaboration migrations, extracted without changing their SQL.
export function migrateLegacyTaskSchema(database: DatabaseSync): void {
  const taskTable = database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'",
    )
    .get();
  if (
    taskTable !== undefined &&
    !text(taskTable, "sql").includes("'waiting_input'")
  ) {
    database.exec("PRAGMA foreign_keys = OFF");
    try {
      database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE tasks RENAME TO tasks_before_waiting_input;
        CREATE TABLE tasks (
          task_id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL REFERENCES rooms(room_id),
          creator_id TEXT NOT NULL REFERENCES principals(principal_id),
          assignee_id TEXT NOT NULL REFERENCES principals(principal_id),
          title TEXT NOT NULL,
          description TEXT,
          state TEXT NOT NULL CHECK (state IN ('todo', 'claimed', 'in_progress', 'waiting_input', 'submitted', 'completed')),
          claimed_by TEXT REFERENCES principals(principal_id),
          claim_until TEXT,
          claim_until_ms INTEGER,
          last_progress TEXT,
          submission_summary TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          submitted_at TEXT,
          completed_at TEXT
        ) STRICT;
        INSERT INTO tasks SELECT * FROM tasks_before_waiting_input;
        DROP TABLE tasks_before_waiting_input;
        COMMIT;
      `);
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    } finally {
      database.exec("PRAGMA foreign_keys = ON");
    }
  }
  const taskColumns = database.prepare("PRAGMA table_info(tasks)").all();
  const assigneeColumn = taskColumns.find(
    (row) => text(row, "name") === "assignee_id",
  );
  if (
    taskColumns.length > 0 &&
    (assigneeColumn === undefined ||
      integer(assigneeColumn, "notnull") === 1 ||
      !taskColumns.some((row) => text(row, "name") === "blocked_reason"))
  ) {
    database.exec("PRAGMA foreign_keys = OFF");
    try {
      database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE tasks_coordination_v1 (
          task_id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL REFERENCES rooms(room_id),
          creator_id TEXT NOT NULL REFERENCES principals(principal_id),
          assignee_id TEXT REFERENCES principals(principal_id),
          title TEXT NOT NULL,
          description TEXT,
          state TEXT NOT NULL CHECK (state IN ('todo', 'claimed', 'in_progress', 'waiting_input', 'blocked', 'submitted', 'completed', 'cancelled')),
          claimed_by TEXT REFERENCES principals(principal_id),
          claim_until TEXT,
          claim_until_ms INTEGER,
          last_progress TEXT,
          submission_summary TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          submitted_at TEXT,
          completed_at TEXT,
          blocked_reason TEXT,
          blocked_at TEXT,
          cancellation_reason TEXT,
          cancelled_at TEXT
        ) STRICT;
        INSERT INTO tasks_coordination_v1(
          task_id, room_id, creator_id, assignee_id, title, description,
          state, claimed_by, claim_until, claim_until_ms, last_progress,
          submission_summary, created_at, updated_at, submitted_at,
          completed_at
        )
        SELECT
          task_id, room_id, creator_id, assignee_id, title, description,
          state, claimed_by, claim_until, claim_until_ms, last_progress,
          submission_summary, created_at, updated_at, submitted_at,
          completed_at
        FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_coordination_v1 RENAME TO tasks;
        COMMIT;
      `);
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    } finally {
      database.exec("PRAGMA foreign_keys = ON");
    }
  }
}
