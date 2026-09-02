import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  createReadStream,
  mkdirSync,
  openSync,
  unlinkSync,
  lstatSync,
  existsSync,
} from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  AttachmentSchema,
  FilePrepareRequestSchema,
  FileUploadSchema,
  RoomFilesRequestSchema,
  RoomFilesResponseSchema,
  TaskArtifactReferenceSchema,
  WorkerArtifactPrepareRequestSchema,
  WorkerArtifactUploadSchema,
  type Attachment,
  type ActivationCredentialScope,
  type RoomDeletionFileGcSummary,
  type TaskArtifactReference,
} from "@rah-os/protocol";
import type {
  AuthenticatedActorContext,
  AuthenticatedWorkerExecutionContext,
} from "./auth.ts";
import { requireRoomMember } from "./collaboration-policy.ts";
import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
} from "./errors.ts";
import { text, integer, type Row } from "./sqlite-row.ts";
import type { z } from "zod";

// Structural port: Raft reservation/verification contract + Multica local atomic blob publication.
// This is local disk, not a replacement for the canonical Message / Room ledger.
export class RoomFiles {
  readonly #db: DatabaseSync;
  readonly #root: string;
  readonly #actor: (actor: AuthenticatedActorContext) => string;
  readonly #worker: (
    worker: AuthenticatedWorkerExecutionContext,
  ) => ActivationCredentialScope;
  readonly #now: () => Date;
  constructor(options: {
    database: DatabaseSync;
    directory: string;
    requireActor: (actor: AuthenticatedActorContext) => string;
    requireWorker: (
      worker: AuthenticatedWorkerExecutionContext,
    ) => ActivationCredentialScope;
    now: () => Date;
  }) {
    this.#db = options.database;
    this.#root = resolve(options.directory);
    this.#actor = options.requireActor;
    this.#worker = options.requireWorker;
    this.#now = options.now;
  }
  initialize() {
    this.#db.exec(`CREATE TABLE IF NOT EXISTS room_files (
      attachment_id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(room_id), actor_id TEXT NOT NULL REFERENCES principals(principal_id),
      request_key TEXT NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT,
      state TEXT NOT NULL, expires_at TEXT NOT NULL, message_id TEXT REFERENCES messages(message_id),
      storage_reclaimed INTEGER NOT NULL DEFAULT 0,
      task_id TEXT REFERENCES tasks(task_id), run_attempt_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(room_id, actor_id, request_key)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_room_files_message ON room_files(room_id, message_id);`);
    if (
      !this.#db
        .prepare("PRAGMA table_info(room_files)")
        .all()
        .some((row) => row.name === "storage_reclaimed")
    )
      this.#db.exec(
        "ALTER TABLE room_files ADD COLUMN storage_reclaimed INTEGER NOT NULL DEFAULT 0",
      );
    const columns = this.#db.prepare("PRAGMA table_info(room_files)").all();
    if (!columns.some((row) => row.name === "task_id"))
      this.#db.exec(
        "ALTER TABLE room_files ADD COLUMN task_id TEXT REFERENCES tasks(task_id)",
      );
    if (!columns.some((row) => row.name === "run_attempt_id"))
      this.#db.exec("ALTER TABLE room_files ADD COLUMN run_attempt_id TEXT");
    if (!columns.some((row) => row.name === "created_at")) {
      this.#db.exec("ALTER TABLE room_files ADD COLUMN created_at TEXT");
      this.#db
        .prepare(
          "UPDATE room_files SET created_at = ? WHERE created_at IS NULL",
        )
        .run(this.#now().toISOString());
    }
    this.#db.exec(
      "CREATE INDEX IF NOT EXISTS idx_room_files_task_unbound ON room_files(task_id, actor_id, state, attachment_id) WHERE task_id IS NOT NULL AND message_id IS NULL",
    );
    this.#db.exec(
      "CREATE INDEX IF NOT EXISTS idx_room_files_reclaim ON room_files(storage_reclaimed, state, expires_at)",
    );
    if (
      !this.#db
        .prepare("PRAGMA table_info(messages)")
        .all()
        .some((r) => r.name === "attachments_json")
    ) {
      this.#db.exec(
        "ALTER TABLE messages ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]'",
      );
    }
    // A process crash cannot turn a partial upload into a verified attachment.
    this.#db.exec(
      "UPDATE room_files SET state = 'failed' WHERE state = 'verifying'",
    );
    this.#reclaimExpired();
    this.#reclaimRoomDeletionRows();
  }

  reclaimRoomDeletionBlobs(deletionId: string): RoomDeletionFileGcSummary {
    this.#reclaimRoomDeletionRows(deletionId);
    return this.roomDeletionGcSummary(deletionId);
  }

  roomDeletionGcSummary(deletionId: string): RoomDeletionFileGcSummary {
    const counts = this.#db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN state='pending' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN state='reclaimed' THEN 1 ELSE 0 END) AS reclaimed,
           SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) AS failed
         FROM room_file_gc_receipts WHERE deletion_id=?`,
      )
      .get(deletionId);
    return {
      failed: Number(counts?.failed ?? 0),
      pending: Number(counts?.pending ?? 0),
      reclaimed: Number(counts?.reclaimed ?? 0),
      total: Number(counts?.total ?? 0),
    };
  }
  prepare(
    actor: AuthenticatedActorContext,
    request: z.input<typeof FilePrepareRequestSchema>,
  ) {
    const input = FilePrepareRequestSchema.parse(request);
    const actorId = this.#actor(actor);
    requireRoomMember(this.#db, input.roomId, actorId);
    this.#reclaimExpired();
    const previous = this.#db
      .prepare(
        "SELECT * FROM room_files WHERE room_id = ? AND actor_id = ? AND request_key = ?",
      )
      .get(input.roomId, actorId, input.idempotencyKey);
    if (previous) {
      if (
        previous.filename !== input.filename ||
        previous.mime_type !== input.mimeType ||
        previous.size !== input.size
      )
        throw new IdempotencyConflictError(
          "upload idempotency key was used for another file",
        );
      return this.#uploadView(this.#expire(previous));
    }
    const active = this.#db
      .prepare(
        "SELECT COUNT(*) AS count FROM room_files WHERE actor_id = ? AND state IN ('pending','verifying','completed') AND expires_at > ?",
      )
      .get(actorId, this.#now().toISOString());
    if (Number(active?.count) >= 20)
      throw new ConflictError(
        "too many pending uploads; send or cancel existing files first",
      );
    const id = randomUUID();
    this.#db
      .prepare(
        "INSERT INTO room_files(attachment_id, room_id, actor_id, request_key, filename, mime_type, size, state, expires_at, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
      )
      .run(
        id,
        input.roomId,
        actorId,
        input.idempotencyKey,
        input.filename,
        input.mimeType,
        input.size,
        new Date(this.#now().getTime() + 60 * 60_000).toISOString(),
        this.#now().toISOString(),
      );
    return this.#uploadView(this.#row(id));
  }
  prepareWorker(
    execution: AuthenticatedWorkerExecutionContext,
    request: z.input<typeof WorkerArtifactPrepareRequestSchema>,
  ) {
    const input = WorkerArtifactPrepareRequestSchema.parse(request);
    const scope = this.#worker(execution);
    this.#reclaimExpired();
    const previous = this.#db
      .prepare(
        "SELECT * FROM room_files WHERE room_id = ? AND actor_id = ? AND request_key = ?",
      )
      .get(scope.roomId, scope.participantId, input.idempotencyKey);
    if (previous) {
      if (
        previous.filename !== input.filename ||
        previous.mime_type !== input.mimeType ||
        previous.size !== input.size ||
        previous.task_id !== input.taskId ||
        previous.run_attempt_id !== scope.runAttemptId
      )
        throw new IdempotencyConflictError(
          "artifact idempotency key was used for another publication",
        );
      return this.#workerUploadView(this.#expire(previous));
    }
    this.#requireActiveTaskOwner(scope, input.taskId);
    const active = this.#db
      .prepare(
        "SELECT COUNT(*) AS count FROM room_files WHERE actor_id = ? AND state IN ('pending','verifying','completed') AND expires_at > ?",
      )
      .get(scope.participantId, this.#now().toISOString());
    if (Number(active?.count) >= 20)
      throw new ConflictError(
        "too many pending uploads; submit or abandon existing artifacts first",
      );
    const attachmentId = randomUUID();
    const createdAt = this.#now().toISOString();
    this.#db
      .prepare(
        `INSERT INTO room_files(
           attachment_id, room_id, actor_id, request_key, filename, mime_type,
           size, state, expires_at, task_id, run_attempt_id, created_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      )
      .run(
        attachmentId,
        scope.roomId,
        scope.participantId,
        input.idempotencyKey,
        input.filename,
        input.mimeType,
        input.size,
        new Date(this.#now().getTime() + 60 * 60_000).toISOString(),
        input.taskId,
        scope.runAttemptId,
        createdAt,
      );
    return this.#workerUploadView(this.#row(attachmentId));
  }
  async upload(
    actor: AuthenticatedActorContext,
    attachmentId: string,
    chunks: AsyncIterable<Uint8Array>,
  ) {
    return await this.#writeUpload(
      attachmentId,
      () => this.#owned(actor, attachmentId),
      chunks,
    );
  }
  async uploadWorker(
    execution: AuthenticatedWorkerExecutionContext,
    attachmentId: string,
    chunks: AsyncIterable<Uint8Array>,
  ) {
    await this.#writeUpload(
      attachmentId,
      () => this.#ownedWorker(execution, attachmentId),
      chunks,
    );
    return this.#workerUploadView(this.#row(attachmentId));
  }
  async #writeUpload(
    attachmentId: string,
    owner: () => Row,
    chunks?: AsyncIterable<Uint8Array>,
  ) {
    const row = owner();
    if (row.state !== "pending")
      throw new ConflictError(
        "upload is not pending (canceled, expired, failed or already uploaded)",
      );
    this.#ensureDirectory();
    this.#db
      .prepare(
        "UPDATE room_files SET state = 'verifying' WHERE attachment_id = ?",
      )
      .run(attachmentId);
    const finalPath = this.#path(attachmentId);
    const temporary = `${finalPath}.part`;
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      let size = 0;
      const hash = createHash("sha256");
      for await (const chunk of chunks ?? []) {
        size += chunk.byteLength;
        if (size > integer(row, "size"))
          throw new ConflictError("attachment size exceeds reserved length");
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.byteLength) {
          const wrote = await handle.write(
            chunk,
            offset,
            chunk.byteLength - offset,
          );
          if (!wrote.bytesWritten)
            throw new Error("file write made no progress");
          offset += wrote.bytesWritten;
        }
      }
      if (size !== integer(row, "size"))
        throw new ConflictError(
          "attachment size does not match reserved length",
        );
      await handle.sync();
      await handle.close();
      handle = undefined;
      // Recheck membership and cancellation after asynchronous IO; no transaction is held across await.
      const current = owner();
      if (current.state !== "verifying")
        throw new ConflictError("upload was canceled or expired");
      await rename(temporary, finalPath);
      const last = owner();
      if (last.state !== "verifying")
        throw new ConflictError("upload was canceled or expired");
      this.#db
        .prepare(
          "UPDATE room_files SET state = 'completed', sha256 = ? WHERE attachment_id = ?",
        )
        .run(hash.digest("hex"), attachmentId);
      return this.#uploadView(this.#row(attachmentId));
    } catch (error) {
      this.#db
        .prepare(
          "UPDATE room_files SET state = 'failed' WHERE attachment_id = ? AND state = 'verifying'",
        )
        .run(attachmentId);
      await unlink(finalPath).catch(() => {});
      throw error;
    } finally {
      await handle?.close();
      await unlink(temporary).catch(() => {});
    }
  }
  forTaskSubmission(
    execution: AuthenticatedWorkerExecutionContext,
    taskId: string,
  ): {
    attachments: Attachment[];
    references: TaskArtifactReference[];
  } {
    const scope = this.#worker(execution);
    this.#requireActiveTaskOwner(scope, taskId);
    const rows = this.#db
      .prepare(
        `SELECT * FROM room_files
         WHERE room_id = ? AND actor_id = ? AND task_id = ?
           AND state = 'completed' AND message_id IS NULL
         ORDER BY created_at, attachment_id`,
      )
      .all(scope.roomId, scope.participantId, taskId);
    if (rows.length > 10)
      throw new ConflictError("at most 10 artifacts per Task submission");
    const attachments = rows.map((row) => this.#attachment(row));
    const references = rows.map((row, index) =>
      TaskArtifactReferenceSchema.parse({
        ...this.#attachment(row),
        ordinal: index + 1,
        producerId: scope.participantId,
        runAttemptId: text(row, "run_attempt_id"),
        taskId,
      }),
    );
    return { attachments, references };
  }
  cancel(actor: AuthenticatedActorContext, input: { attachmentId: string }) {
    const row = this.#owned(actor, input.attachmentId);
    if (row.state === "consumed")
      throw new ConflictError("sent files cannot be canceled");
    this.#db
      .prepare(
        "UPDATE room_files SET state = 'canceled' WHERE attachment_id = ?",
      )
      .run(input.attachmentId);
    try {
      unlinkSync(this.#path(input.attachmentId));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    return this.#uploadView(this.#row(input.attachmentId));
  }
  forMessage(
    actor: AuthenticatedActorContext,
    roomId: string,
    attachmentIds: readonly string[],
    replayMessageId?: string,
  ): Attachment[] {
    if (
      attachmentIds.length > 10 ||
      new Set(attachmentIds).size !== attachmentIds.length
    )
      throw new ConflictError("at most 10 distinct attachments per message");
    return attachmentIds.map((id) => {
      const row = this.#owned(actor, id);
      if (row.room_id !== roomId)
        throw new ForbiddenError("attachment belongs to another Room");
      if (!(
        row.state === "completed" ||
        (replayMessageId &&
          row.state === "consumed" &&
          row.message_id === replayMessageId)
      ))
        throw new ConflictError(
          "attachment must be completed and not already consumed",
        );
      return this.#attachment(row);
    });
  }
  consume(attachments: readonly Attachment[], messageId: string) {
    for (const attachment of attachments)
      this.#db
        .prepare(
          "UPDATE room_files SET state = 'consumed', message_id = ? WHERE attachment_id = ? AND state = 'completed'",
        )
        .run(messageId, attachment.attachmentId);
  }
  list(
    actor: AuthenticatedActorContext,
    request: z.input<typeof RoomFilesRequestSchema>,
  ) {
    const input = RoomFilesRequestSchema.parse(request);
    requireRoomMember(this.#db, input.roomId, this.#actor(actor));
    let before = Number.MAX_SAFE_INTEGER;
    let beforeId = "~";
    if (input.cursor) {
      let cursor;
      try {
        cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
      } catch {
        throw new ConflictError("invalid file cursor");
      }
      if (
        cursor.roomId !== input.roomId ||
        !Number.isSafeInteger(cursor.seq) ||
        typeof cursor.id !== "string"
      )
        throw new ConflictError("invalid file cursor scope");
      before = cursor.seq;
      beforeId = cursor.id;
    }
    const limit = input.limit ?? 50;
    const rows = this.#db
      .prepare(
        `WITH file_message_events(room_id, message_id, room_seq) AS (
           SELECT room_id, aggregate_id, room_seq
           FROM room_events
           WHERE type = 'message.posted'
           UNION ALL
           SELECT room_id, json_extract(payload_json, '$.messageId'), room_seq
           FROM room_events
           WHERE type = 'task.submitted'
         )
         SELECT f.*, e.room_seq, m.created_at
         FROM room_files AS f
         JOIN messages AS m ON m.message_id = f.message_id
         JOIN file_message_events AS e
           ON e.message_id = m.message_id AND e.room_id = m.room_id
         WHERE f.room_id = ? AND f.state = 'consumed'
           AND (e.room_seq < ? OR (e.room_seq = ? AND f.attachment_id < ?))
         ORDER BY e.room_seq DESC, f.attachment_id DESC
         LIMIT ?`,
      )
      .all(input.roomId, before, before, beforeId, limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return RoomFilesResponseSchema.parse({
      files: page.map((row) => ({
        ...this.#attachment(row),
        roomId: row.room_id,
        messageId: row.message_id,
        roomSeq: row.room_seq,
        createdAt: row.created_at,
      })),
      ...(rows.length > limit && last
        ? {
            nextCursor: Buffer.from(
              JSON.stringify({
                roomId: input.roomId,
                seq: last.room_seq,
                id: last.attachment_id,
              }),
            ).toString("base64url"),
          }
        : {}),
    });
  }
  async download(actor: AuthenticatedActorContext, attachmentId: string) {
    const row = this.#row(attachmentId);
    requireRoomMember(this.#db, text(row, "room_id"), this.#actor(actor));
    if (row.state !== "consumed")
      throw new NotFoundError("file is not attached to a sent message");
    this.#ensureDirectory();
    const path = this.#path(attachmentId);
    const descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      // The descriptor is now identity-fixed. Recheck membership before any
      // stream can emit bytes, then transfer descriptor ownership to it.
      requireRoomMember(this.#db, text(row, "room_id"), this.#actor(actor));
      return {
        attachment: this.#attachment(row),
        stream: createReadStream(path, {
          autoClose: true,
          fd: descriptor,
        }),
      };
    } catch (error) {
      closeSync(descriptor);
      throw error;
    }
  }
  #ensureDirectory() {
    mkdirSync(this.#root, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.#root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0
    )
      throw new ForbiddenError(
        "blob directory must be an owner-private non-symlink directory",
      );
  }
  #reclaimExpired() {
    this.#db
      .prepare(
        "UPDATE room_files SET state = 'expired' WHERE state IN ('pending', 'verifying', 'completed') AND expires_at <= ?",
      )
      .run(this.#now().toISOString());
    if (!existsSync(this.#root)) return;
    // Refuse aliased roots before any deletion. Only server-generated, unconsumed blob IDs qualify.
    const stat = lstatSync(this.#root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    const rows = this.#db
      .prepare(
        "SELECT attachment_id FROM room_files WHERE storage_reclaimed = 0 AND state IN ('expired', 'canceled', 'failed') AND message_id IS NULL LIMIT 1000",
      )
      .all();
    for (const row of rows) {
      const id = text(row, "attachment_id");
      for (const path of [this.#path(id), `${this.#path(id)}.part`]) {
        try {
          unlinkSync(path);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      }
      this.#db
        .prepare(
          "UPDATE room_files SET storage_reclaimed = 1 WHERE attachment_id = ?",
        )
        .run(id);
    }
  }
  #reclaimRoomDeletionRows(deletionId?: string) {
    const rows = this.#db
      .prepare(
        `SELECT deletion_id,attachment_id
         FROM room_file_gc_receipts
         WHERE state IN ('pending','failed')
           AND (? IS NULL OR deletion_id = ?)
         ORDER BY created_at,deletion_id,attachment_id`,
      )
      .all(deletionId ?? null, deletionId ?? null);
    for (const row of rows) {
      const receiptDeletionId = text(row, "deletion_id");
      const attachmentId = text(row, "attachment_id");
      const updatedAt = this.#now().toISOString();
      try {
        this.#reclaimBlobBytes(attachmentId);
        this.#db
          .prepare(
            `UPDATE room_file_gc_receipts
             SET state='reclaimed',attempt_count=attempt_count+1,
                 last_error=NULL,updated_at=?
             WHERE deletion_id=? AND attachment_id=?`,
          )
          .run(updatedAt, receiptDeletionId, attachmentId);
      } catch (error) {
        const message = (
          error instanceof Error ? error.message : String(error)
        ).slice(0, 2_000);
        this.#db
          .prepare(
            `UPDATE room_file_gc_receipts
             SET state='failed',attempt_count=attempt_count+1,
                 last_error=?,updated_at=?
             WHERE deletion_id=? AND attachment_id=?`,
          )
          .run(message, updatedAt, receiptDeletionId, attachmentId);
      }
    }
  }
  #reclaimBlobBytes(attachmentId: string) {
    if (!existsSync(this.#root)) return;
    const root = lstatSync(this.#root);
    if (
      !root.isDirectory() ||
      root.isSymbolicLink() ||
      (root.mode & 0o077) !== 0
    ) {
      throw new ForbiddenError(
        "blob directory must be an owner-private non-symlink directory",
      );
    }
    for (const path of [
      this.#path(attachmentId),
      `${this.#path(attachmentId)}.part`,
    ]) {
      try {
        unlinkSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  #path(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new NotFoundError("file not found");
    return join(this.#root, id);
  }
  #row(id: string) {
    const row = this.#db
      .prepare("SELECT * FROM room_files WHERE attachment_id = ?")
      .get(id);
    if (!row) throw new NotFoundError("file not found");
    return row;
  }
  #owned(actor: AuthenticatedActorContext, id: string) {
    const row = this.#row(id);
    const actorId = this.#actor(actor);
    requireRoomMember(this.#db, text(row, "room_id"), actorId);
    if (row.actor_id !== actorId)
      throw new ForbiddenError("upload belongs to another member");
    return this.#expire(row);
  }
  #ownedWorker(
    execution: AuthenticatedWorkerExecutionContext,
    attachmentId: string,
  ) {
    const scope = this.#worker(execution);
    const row = this.#row(attachmentId);
    if (
      row.room_id !== scope.roomId ||
      row.actor_id !== scope.participantId ||
      row.run_attempt_id !== scope.runAttemptId ||
      typeof row.task_id !== "string"
    )
      throw new ForbiddenError(
        "artifact is outside this Worker execution scope",
      );
    this.#requireActiveTaskOwner(scope, text(row, "task_id"));
    return this.#expire(row);
  }
  #requireActiveTaskOwner(
    scope: ActivationCredentialScope,
    taskId: string,
  ): Row {
    const task = this.#db
      .prepare("SELECT * FROM tasks WHERE task_id = ?")
      .get(taskId);
    if (!task) throw new NotFoundError(`Task ${taskId} was not found`);
    if (task.room_id !== scope.roomId)
      throw new ForbiddenError(`Task ${taskId} is outside this Worker Room`);
    if (task.state !== "in_progress" || task.claimed_by !== scope.participantId)
      throw new ConflictError(
        `Task ${taskId} must be in_progress and owned by this Agent`,
      );
    return task;
  }
  #expire(row: Row) {
    if (
      !["consumed", "canceled", "expired", "failed"].includes(
        text(row, "state"),
      ) &&
      text(row, "expires_at") <= this.#now().toISOString()
    ) {
      this.#db
        .prepare(
          "UPDATE room_files SET state = 'expired' WHERE attachment_id = ?",
        )
        .run(text(row, "attachment_id"));
      return { ...row, state: "expired" };
    }
    return row;
  }
  #uploadView(row: Row) {
    return FileUploadSchema.parse({
      attachmentId: row.attachment_id,
      roomId: row.room_id,
      filename: row.filename,
      mimeType: row.mime_type,
      size: row.size,
      state: row.state,
      expiresAt: row.expires_at,
    });
  }
  #workerUploadView(row: Row) {
    return WorkerArtifactUploadSchema.parse({
      ...this.#uploadView(row),
      ...(typeof row.sha256 === "string" ? { sha256: row.sha256 } : {}),
      taskId: text(row, "task_id"),
    });
  }
  #attachment(row: Row) {
    return AttachmentSchema.parse({
      attachmentId: row.attachment_id,
      filename: row.filename,
      mimeType: row.mime_type,
      size: row.size,
      sha256: row.sha256,
    });
  }
}
