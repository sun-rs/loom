import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  mkdirSync,
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
  type Attachment,
} from "@rah-os/protocol";
import type { AuthenticatedActorContext } from "./auth.ts";
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
  readonly #now: () => Date;
  constructor(options: {
    database: DatabaseSync;
    directory: string;
    requireActor: (actor: AuthenticatedActorContext) => string;
    now: () => Date;
  }) {
    this.#db = options.database;
    this.#root = resolve(options.directory);
    this.#actor = options.requireActor;
    this.#now = options.now;
  }
  initialize() {
    this.#db.exec(`CREATE TABLE IF NOT EXISTS room_files (
      attachment_id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(room_id), actor_id TEXT NOT NULL REFERENCES principals(principal_id),
      request_key TEXT NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT,
      state TEXT NOT NULL, expires_at TEXT NOT NULL, message_id TEXT REFERENCES messages(message_id),
      storage_reclaimed INTEGER NOT NULL DEFAULT 0,
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
        "INSERT INTO room_files(attachment_id, room_id, actor_id, request_key, filename, mime_type, size, state, expires_at) VALUES(?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
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
      );
    return this.#uploadView(this.#row(id));
  }
  async upload(
    actor: AuthenticatedActorContext,
    attachmentId: string,
    chunks: AsyncIterable<Uint8Array>,
  ) {
    const row = this.#owned(actor, attachmentId);
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
      for await (const chunk of chunks) {
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
      const current = this.#owned(actor, attachmentId);
      if (current.state !== "verifying")
        throw new ConflictError("upload was canceled or expired");
      await rename(temporary, finalPath);
      const last = this.#owned(actor, attachmentId);
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
        `SELECT f.*, e.room_seq, m.created_at FROM room_files f JOIN messages m ON m.message_id = f.message_id JOIN room_events e ON e.aggregate_id = m.message_id AND e.room_id = m.room_id AND e.type = 'message.posted' WHERE f.room_id = ? AND f.state = 'consumed' AND (e.room_seq < ? OR (e.room_seq = ? AND f.attachment_id < ?)) ORDER BY e.room_seq DESC, f.attachment_id DESC LIMIT ?`,
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
    const handle = await open(
      this.#path(attachmentId),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      requireRoomMember(this.#db, text(row, "room_id"), this.#actor(actor));
    } catch (error) {
      await handle.close();
      throw error;
    }
    return {
      attachment: this.#attachment(row),
      stream: handle.createReadStream({ autoClose: true }),
    };
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
