import type { DatabaseSync } from "node:sqlite";
import type { Attachment } from "@rah-os/protocol";

import { ConflictError, ForbiddenError, NotFoundError } from "./errors.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { integer, nullableText, text, type Row } from "./sqlite-row.ts";

type CreateId = (prefix: string) => string;

export type TaskCreateCommand = {
  assigneeId?: string;
  basedOnRoomSeq?: number;
  collaboratorIds?: string[];
  dependencyTaskIds?: string[];
  description?: string;
  idempotencyKey: string;
  roomId: string;
  reviewerIds?: string[];
  sourceMessageId?: string;
  title?: string;
};

type NormalizedTaskCreateCommand = Omit<
  TaskCreateCommand,
  | "collaboratorIds"
  | "dependencyTaskIds"
  | "description"
  | "reviewerIds"
  | "title"
> & {
  collaboratorIds: readonly string[];
  dependencyTaskIds: readonly string[];
  description: string | undefined;
  reviewerIds: readonly string[];
  title: string;
};

export type TaskAnchor = {
  eventPayload: Record<string, unknown>;
  sourceMessageId: string;
  taskNumber: number;
  threadId: string;
};

export function createAnchoredTaskProjection(
  database: DatabaseSync,
  createId: CreateId,
  input: {
    actorId: string;
    command: NormalizedTaskCreateCommand;
    createdAt: string;
    taskId: string;
  },
): TaskAnchor {
  const command = input.command;
  const sourceMessageId = command.sourceMessageId ?? createId("message");
  const existingThread = database
    .prepare("SELECT thread_id FROM threads WHERE root_message_id = ?")
    .get(sourceMessageId);
  const threadId =
    existingThread === undefined
      ? createId("thread")
      : text(existingThread, "thread_id");
  const taskNumber = integer(
    database
      .prepare(
        `SELECT COALESCE(MAX(task_number), 0) + 1 AS task_number FROM (
          SELECT task_number FROM tasks WHERE room_id = ?
          UNION ALL
          SELECT json_extract(payload_json, '$.taskNumber') AS task_number
          FROM room_events WHERE room_id = ? AND aggregate_type = 'task'
            AND type IN ('task.created', 'task.deleted')
            AND json_type(payload_json, '$.taskNumber') = 'integer'
        )`,
      )
      .get(command.roomId, command.roomId)!,
    "task_number",
  );
  if (command.sourceMessageId === undefined) {
    database
      .prepare(
        "INSERT INTO messages(message_id, room_id, actor_id, body, created_at) VALUES(?, ?, ?, ?, ?)",
      )
      .run(
        sourceMessageId,
        command.roomId,
        input.actorId,
        command.title,
        input.createdAt,
      );
  }
  if (existingThread === undefined) {
    database
      .prepare(
        "INSERT INTO threads(thread_id, room_id, root_message_id, created_by, reply_count, created_at) VALUES(?, ?, ?, ?, 0, ?)",
      )
      .run(
        threadId,
        command.roomId,
        sourceMessageId,
        input.actorId,
        input.createdAt,
      );
  }
  database
    .prepare(
      "INSERT INTO tasks(task_id, room_id, creator_id, assignee_id, task_number, source_message_id, thread_id, title, description, state, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?)",
    )
    .run(
      input.taskId,
      command.roomId,
      input.actorId,
      command.assigneeId ?? null,
      taskNumber,
      sourceMessageId,
      threadId,
      command.title,
      command.description ?? null,
      input.createdAt,
      input.createdAt,
    );
  const insertDependency = database.prepare(
    "INSERT INTO task_dependencies(task_id, dependency_task_id, created_at) VALUES(?, ?, ?)",
  );
  for (const dependencyTaskId of command.dependencyTaskIds) {
    insertDependency.run(input.taskId, dependencyTaskId, input.createdAt);
  }
  const insertParticipant = database.prepare(
    "INSERT INTO task_participants(task_id, participant_id, role, created_at) VALUES(?, ?, ?, ?)",
  );
  for (const participantId of command.collaboratorIds) {
    insertParticipant.run(
      input.taskId,
      participantId,
      "collaborator",
      input.createdAt,
    );
  }
  for (const participantId of command.reviewerIds) {
    insertParticipant.run(
      input.taskId,
      participantId,
      "reviewer",
      input.createdAt,
    );
  }
  return {
    eventPayload: {
      ...(command.assigneeId === undefined
        ? {}
        : { assigneeId: command.assigneeId }),
      collaboratorIds: command.collaboratorIds,
      creatorId: input.actorId,
      dependencyTaskIds: command.dependencyTaskIds,
      ...(command.description === undefined
        ? {}
        : { description: command.description }),
      reviewerIds: command.reviewerIds,
      sourceMessageId,
      taskId: input.taskId,
      taskNumber,
      threadId,
      title: command.title,
      ...(command.basedOnRoomSeq === undefined
        ? {}
        : { basedOnRoomSeq: command.basedOnRoomSeq }),
    },
    sourceMessageId,
    taskNumber,
    threadId,
  };
}

export function resolveTaskAnchorTitle(
  database: DatabaseSync,
  input: Pick<TaskCreateCommand, "roomId" | "sourceMessageId" | "title">,
): string {
  if (input.sourceMessageId === undefined) {
    const title = input.title?.trim() ?? "";
    if (title.length === 0) throw new Error("task title is required");
    return title;
  }
  if (input.title !== undefined) {
    throw new ConflictError(
      "A converted Task title must come from its canonical Message",
    );
  }
  const message = database
    .prepare("SELECT * FROM messages WHERE message_id = ?")
    .get(input.sourceMessageId);
  if (message === undefined) {
    throw new NotFoundError(`message ${input.sourceMessageId} was not found`);
  }
  if (text(message, "room_id") !== input.roomId) {
    throw new ForbiddenError(
      `Message ${input.sourceMessageId} is outside Room ${input.roomId}`,
    );
  }
  if (nullableText(message, "thread_id") !== null) {
    throw new ConflictError("Only a top-level Message can become a Task");
  }
  const body = text(message, "body");
  if (body.trim().length === 0)
    throw new ConflictError(
      "A Message without text needs an explicit titled Task; attachment-only conversion is unavailable",
    );
  return body;
}

export function assertTaskAnchorAvailable(
  database: DatabaseSync,
  sourceMessageId: string | undefined,
): void {
  if (
    sourceMessageId !== undefined &&
    database
      .prepare("SELECT 1 FROM tasks WHERE source_message_id = ?")
      .get(sourceMessageId) !== undefined
  ) {
    throw new ConflictError(`Message ${sourceMessageId} is already a Task`);
  }
}

export function createTaskThreadReply(
  database: DatabaseSync,
  createId: CreateId,
  taskRow: Row,
  input: {
    actorId: string;
    attachments?: readonly Attachment[];
    body: string;
    createdAt: string;
    roomId: string;
  },
): { messageId: string; threadId: string } {
  const messageId = createId("message");
  const threadId = text(taskRow, "thread_id");
  database
    .prepare(
      "INSERT INTO messages(message_id, room_id, actor_id, thread_id, body, attachments_json, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      messageId,
      input.roomId,
      input.actorId,
      threadId,
      input.body,
      JSON.stringify(input.attachments ?? []),
      input.createdAt,
    );
  database
    .prepare(
      "UPDATE threads SET reply_count = reply_count + 1, last_reply_at = ? WHERE thread_id = ? AND room_id = ?",
    )
    .run(input.createdAt, threadId, input.roomId);
  return { messageId, threadId };
}

export function migrateTaskAnchorsV9(
  database: DatabaseSync,
  createId: CreateId,
  events: RoomEventWriter,
): void {
  const taskColumns = database.prepare("PRAGMA table_info(tasks)").all();
  if (
    taskColumns.length === 0 ||
    taskColumns.some((row) => text(row, "name") === "task_number")
  ) {
    return;
  }

  const legacyTasks = database
    .prepare("SELECT * FROM tasks ORDER BY room_id, created_at, task_id")
    .all();
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE tasks_task_anchor_v9 (
        task_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(room_id),
        creator_id TEXT NOT NULL REFERENCES principals(principal_id),
        assignee_id TEXT REFERENCES principals(principal_id),
        task_number INTEGER NOT NULL CHECK (task_number > 0),
        source_message_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
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
        cancelled_at TEXT,
        UNIQUE (room_id, task_number),
        UNIQUE (source_message_id),
        UNIQUE (thread_id),
        FOREIGN KEY (room_id, source_message_id)
          REFERENCES messages(room_id, message_id),
        FOREIGN KEY (room_id, thread_id)
          REFERENCES threads(room_id, thread_id)
      ) STRICT;
    `);
    const insertTask = database.prepare(`
      INSERT INTO tasks_task_anchor_v9(
        task_id, room_id, creator_id, assignee_id, task_number,
        source_message_id, thread_id, title, description, state, claimed_by,
        claim_until, claim_until_ms, last_progress, submission_summary,
        created_at, updated_at, submitted_at, completed_at, blocked_reason,
        blocked_at, cancellation_reason, cancelled_at
      )
      SELECT
        task_id, room_id, creator_id, assignee_id, ?, ?, ?, title,
        description, state, claimed_by, claim_until, claim_until_ms,
        last_progress, submission_summary, created_at, updated_at,
        submitted_at, completed_at, blocked_reason, blocked_at,
        cancellation_reason, cancelled_at
      FROM tasks WHERE task_id = ?
    `);
    const insertMessage = database.prepare(
      "INSERT INTO messages(message_id, room_id, actor_id, body, created_at) VALUES(?, ?, ?, ?, ?)",
    );
    const insertThread = database.prepare(
      "INSERT INTO threads(thread_id, room_id, root_message_id, created_by, reply_count, created_at) VALUES(?, ?, ?, ?, 0, ?)",
    );
    let previousRoomId: string | undefined;
    let taskNumber = 0;
    for (const taskRow of legacyTasks) {
      const roomId = text(taskRow, "room_id");
      if (roomId !== previousRoomId) {
        previousRoomId = roomId;
        taskNumber = 0;
      }
      taskNumber += 1;
      const taskId = text(taskRow, "task_id");
      const creatorId = text(taskRow, "creator_id");
      const title = text(taskRow, "title");
      const createdAt = text(taskRow, "created_at");
      const sourceMessageId = createId("message");
      const threadId = createId("thread");
      insertMessage.run(sourceMessageId, roomId, creatorId, title, createdAt);
      insertThread.run(threadId, roomId, sourceMessageId, creatorId, createdAt);
      insertTask.run(taskNumber, sourceMessageId, threadId, taskId);

      const creationEvent = database
        .prepare(
          "SELECT 1 FROM room_events WHERE room_id = ? AND aggregate_type = 'task' AND aggregate_id = ? AND type = 'task.created' LIMIT 1",
        )
        .get(roomId, taskId);
      if (creationEvent === undefined) {
        const assigneeId = nullableText(taskRow, "assignee_id");
        const description = nullableText(taskRow, "description");
        const dependencyTaskIds = database
          .prepare(
            "SELECT dependency_task_id FROM task_dependencies WHERE task_id = ? ORDER BY dependency_task_id",
          )
          .all(taskId)
          .map((row) => text(row, "dependency_task_id"));
        events.append({
          actorId: creatorId,
          aggregateId: taskId,
          aggregateType: "task",
          idempotencyKey: `migration-task-anchor:${taskId}`,
          payload: {
            ...(assigneeId === null ? {} : { assigneeId }),
            creatorId,
            dependencyTaskIds,
            ...(description === null ? {} : { description }),
            sourceMessageId,
            taskId,
            taskNumber,
            threadId,
            title,
          },
          roomId,
          type: "task.created",
        });
      }
    }
    database.exec(`
      DROP TABLE tasks;
      ALTER TABLE tasks_task_anchor_v9 RENAME TO tasks;
      CREATE INDEX idx_tasks_room_state
        ON tasks(room_id, state, created_at, task_id);
      CREATE INDEX idx_tasks_assignee_claim
        ON tasks(assignee_id, state, claim_until_ms);
    `);
    const foreignKeyFailures = database
      .prepare("PRAGMA foreign_key_check")
      .all();
    if (foreignKeyFailures.length > 0) {
      throw new Error(
        `schema v9 migration violated ${String(foreignKeyFailures.length)} foreign key constraint(s)`,
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}
