import { boundRows } from "./bounded-read-rows.ts";
import type { DatabaseSync } from "node:sqlite";
import * as P from "@rah-os/protocol";
import type {
  AuthenticatedActorContext,
  AuthenticatedWorkerExecutionContext,
} from "./auth.ts";
import { requireRoomMember } from "./collaboration-policy.ts";
import { requireDiscoveryHuman } from "./global-discovery.ts";
import { NotFoundError, IdempotencyConflictError } from "./errors.ts";
import { text, integer, type Row } from "./sqlite-row.ts";
import type { CollaborationService } from "./collaboration-service.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import type { MessageMutationResult, Principal } from "./types.ts";
type Context = {
  database: DatabaseSync;
  transaction<T>(fn: () => T): T;
  requireActor(auth: AuthenticatedActorContext): Principal;
  requireWorker(
    auth: AuthenticatedWorkerExecutionContext,
  ): P.ActivationCredentialScope;
  collaboration: CollaborationService;
  events: RoomEventWriter;
};
export class AttachmentCommentsService {
  readonly #c: Context;
  constructor(context: Context) {
    this.#c = context;
  }
  initialize() {
    if (
      !this.#c.database
        .prepare("PRAGMA table_info(held_message_drafts)")
        .all()
        .some((row) => row.name === "attachment_comment_json")
    )
      this.#c.database.exec(
        "ALTER TABLE held_message_drafts ADD COLUMN attachment_comment_json TEXT NOT NULL DEFAULT 'null' CHECK(json_valid(attachment_comment_json))",
      );
    this.#c.database
      .exec(`CREATE TABLE IF NOT EXISTS attachment_comment_links(message_id TEXT PRIMARY KEY REFERENCES messages(message_id),attachment_id TEXT NOT NULL REFERENCES room_files(attachment_id),room_id TEXT NOT NULL REFERENCES rooms(room_id),anchor_json TEXT) STRICT;
 CREATE INDEX IF NOT EXISTS idx_attachment_comments ON attachment_comment_links(attachment_id,message_id);`);
  }
  list(
    auth: AuthenticatedActorContext,
    raw: P.AttachmentCommentsRequest,
  ): P.AttachmentCommentsResponse {
    return this.#c.transaction(() => {
      const actor = this.#c.requireActor(auth);
      requireDiscoveryHuman(this.#c.database, actor.principalId);
      return this.#list(actor.principalId, raw);
    });
  }
  workerList(
    auth: AuthenticatedWorkerExecutionContext,
    raw: P.AttachmentCommentsRequest,
  ): P.AttachmentCommentsResponse {
    return this.#c.transaction(() => {
      const scope = this.#c.requireWorker(auth);
      return this.#list(scope.participantId, raw);
    });
  }
  #file(actorId: string, id: string): Row {
    const file = this.#c.database
      .prepare(
        "SELECT f.*,r.archived_at FROM room_files f JOIN rooms r USING(room_id) WHERE attachment_id=? AND state='consumed' AND message_id IS NOT NULL",
      )
      .get(id);
    if (!file) throw new NotFoundError("published attachment is unavailable");
    requireRoomMember(this.#c.database, text(file, "room_id"), actorId);
    return file;
  }
  #list(
    actorId: string,
    raw: P.AttachmentCommentsRequest,
  ): P.AttachmentCommentsResponse {
    const input = P.AttachmentCommentsRequestSchema.parse(raw),
      file = this.#file(actorId, input.attachmentId),
      db = this.#c.database;
    const rows = db
      .prepare(
        `SELECT m.*,e.room_seq,e.payload_json AS comment_payload,l.anchor_json,p.kind,p.handle,p.display_name FROM attachment_comment_links l JOIN messages m USING(message_id) JOIN room_events e ON e.aggregate_id=m.message_id AND e.type='message.posted' AND e.room_id=m.room_id JOIN principals p ON p.principal_id=m.actor_id WHERE l.attachment_id=? AND e.room_seq<? ORDER BY e.room_seq DESC LIMIT ?`,
      )
      .all(
        input.attachmentId,
        input.beforeRoomSeq ?? Number.MAX_SAFE_INTEGER,
        input.limit + 1,
      );
    const projected = new Map<
      Row,
      P.AttachmentCommentsResponse["comments"][number]
    >();
    for (const row of rows.slice(0, input.limit))
      projected.set(row, {
        id: text(row, "message_id"),
        roomId: text(row, "room_id"),
        roomSeq: integer(row, "room_seq"),
        senderId: text(row, "actor_id"),
        senderType: text(row, "kind") as "human" | "agent",
        senderName:
          typeof row.display_name === "string"
            ? row.display_name
            : text(row, "handle"),
        reactions: this.#reactions(text(row, "message_id")),
        content: JSON.parse(text(row, "comment_payload")).body,
        createdAt: text(row, "created_at"),
        anchor: row.anchor_json ? JSON.parse(text(row, "anchor_json")) : null,
      });
    const selected = boundRows(
        [...projected.keys()],
        (row) => projected.get(row),
        "last",
      ),
      more = rows.length > selected.length;
    const thread = this.#thread(file);
    return P.AttachmentCommentsResponseSchema.parse({
      roomId: text(file, "room_id"),
      messageId: text(file, "message_id"),
      comments: selected.reverse().map((row) => projected.get(row)),
      ...(thread
        ? {
            threadId: text(thread, "thread_id"),
            threadRootMessageId: text(thread, "root_message_id"),
          }
        : {}),
      ...(more ? { nextBeforeRoomSeq: integer(selected[0]!, "room_seq") } : {}),
      viewer: { canComment: file.archived_at === null },
    });
  }
  #thread(file: Row): Row | undefined {
    const row = this.#c.database
      .prepare(
        "SELECT COALESCE(m.thread_id,t.thread_id) AS thread_id,COALESCE(parent.root_message_id,t.root_message_id) AS root_message_id FROM messages m LEFT JOIN threads t ON t.root_message_id=m.message_id LEFT JOIN threads parent ON parent.thread_id=m.thread_id WHERE m.message_id=? AND m.room_id=?",
      )
      .get(text(file, "message_id"), text(file, "room_id"));
    return row?.thread_id ? row : undefined;
  }
  #reactions(messageId: string) {
    return this.#c.database
      .prepare(
        `SELECT r.emoji,r.principal_id,p.kind,(SELECT e.created_at FROM room_events e WHERE e.aggregate_id=r.message_id AND e.type='message.reaction_changed' AND e.actor_id=r.principal_id AND json_extract(e.payload_json,'$.emoji')=r.emoji AND json_extract(e.payload_json,'$.active')=1 ORDER BY e.room_seq DESC LIMIT 1) AS created_at FROM message_reactions r JOIN principals p ON p.principal_id=r.principal_id WHERE r.message_id=? ORDER BY r.emoji,r.principal_id`,
      )
      .all(messageId)
      .map((row) => ({
        emoji: text(row, "emoji"),
        reactorId: text(row, "principal_id"),
        reactorType: text(row, "kind") as "human" | "agent",
        createdAt: text(row, "created_at"),
      }));
  }
  // Called inside the existing Worker message transaction, after target resolution.
  workerMetadata(
    execution: AuthenticatedWorkerExecutionContext,
    input: P.WorkerMessagePostRequest,
    target: { roomId: string; threadId?: string },
  ): { attachmentId: string; anchor: null } | undefined {
    const scope = this.#c.requireWorker(execution);
    const held =
      input.sendDraft === true
        ? this.#c.database
            .prepare(
              "SELECT attachment_comment_json FROM held_message_drafts WHERE held_draft_id=? AND participant_id=? AND room_id=?",
            )
            .get(input.heldDraftId!, scope.participantId, target.roomId)
        : undefined;
    const saved = held
      ? JSON.parse(text(held, "attachment_comment_json"))
      : null;
    const id =
      input.sendDraft === true
        ? saved?.attachmentId
        : input.commentAttachmentId;
    if (id === undefined) return undefined;
    const file = this.#file(scope.participantId, id),
      thread = this.#thread(file);
    if (
      text(file, "room_id") !== target.roomId ||
      !thread ||
      text(thread, "thread_id") !== target.threadId
    )
      throw new NotFoundError(
        "attachment comment target does not match this Room/Thread",
      );
    return { attachmentId: id, anchor: null };
  }
  bindWorkerResult(
    metadata: { attachmentId: string; anchor: null } | undefined,
    result: ReturnType<CollaborationService["postActivationMessage"]>,
  ): void {
    if (!metadata) return;
    if ("event" in result) {
      if (!result.deduplicated)
        this.#c.database
          .prepare(
            "INSERT INTO attachment_comment_links(message_id,attachment_id,room_id,anchor_json) VALUES(?,?,?,?)",
          )
          .run(
            result.event.aggregateId,
            metadata.attachmentId,
            result.event.roomId,
            "null",
          );
    } else
      this.#c.database
        .prepare(
          "UPDATE held_message_drafts SET attachment_comment_json=? WHERE held_draft_id=?",
        )
        .run(JSON.stringify(metadata), result.heldDraftId);
  }
  post(
    auth: AuthenticatedActorContext,
    raw: P.AttachmentCommentPostRequest,
  ): MessageMutationResult {
    return this.#c.transaction(() => {
      const c = this.#c,
        db = c.database,
        actor = c.requireActor(auth);
      requireDiscoveryHuman(db, actor.principalId);
      const input = P.AttachmentCommentPostRequestSchema.parse(raw),
        file = this.#file(actor.principalId, input.attachmentId),
        roomId = text(file, "room_id");
      const previous = db
        .prepare(
          "SELECT * FROM room_events WHERE room_id=? AND idempotency_key=?",
        )
        .get(roomId, input.idempotencyKey);
      const metadata = {
        attachmentId: input.attachmentId,
        anchor: input.anchor ?? null,
      };
      if (previous) {
        const event = c.events.eventFromRow(previous);
        if (
          event.type !== "message.posted" ||
          event.actorId !== actor.principalId ||
          event.payload.body !== input.body ||
          JSON.stringify(event.payload.attachmentComment) !==
            JSON.stringify(metadata) ||
          JSON.stringify(event.payload.requestedRecipientIds) !==
            JSON.stringify(
              [...new Set(input.recipientIds)]
                .filter((id) => id !== actor.principalId)
                .sort(),
            )
        )
          throw new IdempotencyConflictError(
            "idempotency key already used for another comment",
          );
        return { event, deduplicated: true, activationIds: [] };
      }
      let thread = this.#thread(file),
        seq = input.basedOnRoomSeq;
      if (!thread) {
        const created = c.collaboration.createThread(actor, {
          roomId,
          rootMessageId: text(file, "message_id"),
          recipientIds: [],
          basedOnRoomSeq: seq,
          idempotencyKey: `comment-thread:${input.idempotencyKey}`,
        });
        thread = { thread_id: created.thread.threadId };
        seq = created.event.roomSeq;
      }
      const result = c.collaboration.replyThread(actor, {
        roomId,
        threadId: text(thread, "thread_id"),
        body: input.body,
        recipientIds: input.recipientIds,
        basedOnRoomSeq: seq,
        idempotencyKey: input.idempotencyKey,
        attachmentComment: metadata,
      });
      db.prepare(
        "INSERT INTO attachment_comment_links(message_id,attachment_id,room_id,anchor_json) VALUES(?,?,?,?)",
      ).run(
        result.event.aggregateId,
        input.attachmentId,
        roomId,
        JSON.stringify(input.anchor ?? null),
      );
      return result;
    });
  }
}
