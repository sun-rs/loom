import type { RoomFiles } from "./room-files.ts";
import { workerMessageAttachments } from "./worker-message-attachments.ts";
import { WorkerReadService } from "./worker-read-tools.ts";
import type { AttachmentCommentsService } from "./attachment-comments.ts";
import type { RoomSnapshot } from "./types.ts";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import * as P from "@rah-os/protocol";
import type { AuthenticatedWorkerExecutionContext } from "./auth.ts";
import type { CollaborationService } from "./collaboration-service.ts";
import { fromRow as principalFromRow } from "./principal-profile.ts";
import { ForbiddenError, StaleContextError } from "./errors.ts";
import { syncRoomEventWindow } from "./room-sync.ts";
import { integer, text, type Row } from "./sqlite-row.ts";
import {
  resolveWorkerReadTarget,
  workerReadThread,
} from "./worker-read-targets.ts";
import { requireWorkerRoomVisibility } from "./worker-task-scope.ts";
import { workerReplyRecipients } from "./worker-message-routing.ts";

type Receipt = {
  domain: "rah-worker-target-v1";
  participantId: string;
  runAttemptId: string;
  roomId: string;
  threadId: string | null;
  threadContextHash: string | null;
  causalEventId: string | null;
  through: number;
  floor: number;
  cursor: number;
  expires: number;
};
type Context = {
  database: DatabaseSync;
  now: () => Date;
  requireWorker: (
    execution: AuthenticatedWorkerExecutionContext,
  ) => P.ActivationCredentialScope;
  transaction: <T>(operation: () => T) => T;
  eventFromRow: (row: Row) => P.RoomEvent;
  snapshot: (roomId: string) => RoomSnapshot;
  collaboration: () => CollaborationService;
  attachmentComments: () => AttachmentCommentsService;
  files: () => RoomFiles;
};
/** Signed presentation receipts reuse canonical bounded Room sync. They never
 * mutate subscriptions, Activations, execution scope or task ownership. */
export class WorkerTargetContextService {
  readonly #context: Context;
  constructor(context: Context) {
    this.#context = context;
  }
  verifyPresented(
    execution: AuthenticatedWorkerExecutionContext,
    input: { channel: string; contextReceipt: string; basedOnRoomSeq?: number },
    options: { allowExpired?: boolean } = {},
  ) {
    const origin = this.#authorize(execution);
    const target = resolveWorkerReadTarget(
      this.#context.database,
      origin,
      input.channel,
    );
    const receipt = this.#verify(
      input.contextReceipt,
      origin,
      target,
      options.allowExpired,
    );
    if (
      receipt.cursor !== receipt.through ||
      (input.basedOnRoomSeq !== undefined &&
        input.basedOnRoomSeq !== receipt.through)
    )
      throw new ForbiddenError(
        "target context window is incomplete or cursor differs",
      );
    return {
      roomId: target.roomId,
      ...(target.threadId ? { threadId: target.threadId } : {}),
      throughRoomSeq: receipt.through,
      participantId: origin.participantId,
    };
  }
  read(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerRoomContextRequest,
  ): P.WorkerRoomContextResponse {
    return this.#context.transaction(() => {
      const origin = this.#authorize(execution),
        input = P.WorkerRoomContextRequestSchema.parse(raw);
      const target = resolveWorkerReadTarget(
        this.#context.database,
        origin,
        input.channel,
      );
      const prior = input.contextReceipt
        ? this.#verify(input.contextReceipt, origin, target)
        : undefined;
      const through = prior?.through ?? this.#head(target.roomId);
      const floor = prior?.floor ?? Math.max(0, through - input.limit);
      const threadContext =
        !prior && target.threadId
          ? this.#threadContext(
              execution,
              target.roomId,
              target.threadId,
              input.limit,
            )
          : undefined;
      const lastMessage =
        threadContext?.history.messages.at(-1) ?? threadContext?.rootMessage;
      const causalEventId =
        prior?.causalEventId ??
        (lastMessage
          ? text(
              this.#context.database
                .prepare(
                  "SELECT event_id FROM room_events WHERE room_id=? AND aggregate_type='message' AND aggregate_id=? AND type='message.posted'",
                )
                .get(target.roomId, lastMessage.messageId)!,
              "event_id",
            )
          : null);
      const receipt: Receipt = {
        domain: "rah-worker-target-v1",
        participantId: origin.participantId,
        runAttemptId: origin.runAttemptId,
        roomId: target.roomId,
        threadId: target.threadId ?? null,
        threadContextHash:
          prior?.threadContextHash ??
          (threadContext
            ? createHash("sha256")
                .update(JSON.stringify(threadContext))
                .digest("hex")
            : null),
        causalEventId,
        through,
        floor,
        cursor: through,
        expires:
          prior?.expires ?? this.#context.now().getTime() + 60 * 60 * 1000,
      };
      const envelope = {
        roomId: target.roomId,
        ...(target.threadId ? { threadId: target.threadId } : {}),
        ...(threadContext ? { threadContext } : {}),
        throughRoomSeq: through,
        eventFloorSeq: floor,
        complete: false,
        contextReceipt: this.#sign(receipt),
        window: null,
      };
      const window = syncRoomEventWindow(
        this.#context.database,
        origin.participantId,
        {
          roomId: target.roomId,
          consumerId: `target-context:${origin.runAttemptId}`,
          throughSeq: through,
          limit: input.limit,
          ...(prior
            ? { afterSeq: prior.cursor }
            : { bootstrap: "latest" as const }),
        },
        {
          eventFromRow: this.#context.eventFromRow,
          snapshot: this.#context.snapshot,
          responseOverheadBytes:
            Buffer.byteLength(JSON.stringify(envelope)) - 4,
        },
      );
      receipt.cursor = window.cursorAfter;
      const response = P.WorkerRoomContextResponseSchema.parse({
        ...envelope,
        complete: receipt.cursor === through,
        contextReceipt: this.#sign(receipt),
        window,
      });
      if (
        Buffer.byteLength(JSON.stringify(response)) >
        P.ROOM_SYNC_RESPONSE_MAX_BYTES
      )
        throw new ForbiddenError(
          "target context exceeds complete JSON byte limit",
        );
      return response;
    });
  }
  post(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerMessagePostRequest,
  ): P.WorkerMessagePostResponse {
    return this.#context.transaction(() => {
      const origin = this.#authorize(execution),
        input = P.WorkerMessagePostRequestSchema.parse(raw);
      if (input.channel === undefined || input.contextReceipt === undefined)
        throw new ForbiddenError(
          "target post requires a presented context receipt",
        );
      const target = resolveWorkerReadTarget(
        this.#context.database,
        origin,
        input.channel,
      );
      const previous = this.#context.database
        .prepare(
          "SELECT 1 FROM room_events WHERE room_id=? AND idempotency_key=?",
        )
        .get(target.roomId, input.idempotencyKey);
      const receipt = this.#verify(
        input.contextReceipt,
        origin,
        target,
        previous !== undefined,
      );
      if (
        receipt.cursor !== receipt.through ||
        input.basedOnRoomSeq !== receipt.through
      )
        throw new ForbiddenError(
          "target context window is incomplete or cursor differs",
        );
      const threadId = workerReadThread(target, input.threadId) ?? undefined;
      if ((threadId ?? null) !== receipt.threadId)
        throw new ForbiddenError(
          "target receipt does not authorize another Thread",
        );
      const previousHeld = this.#context.database
        .prepare(
          "SELECT 1 FROM held_message_drafts WHERE room_id=? AND idempotency_key=?",
        )
        .get(target.roomId, input.idempotencyKey);
      const newerMessage = this.#context
        .collaboration()
        .hasNewerTargetMessages(target.roomId, threadId, receipt.through);
      if (
        !previous &&
        !previousHeld &&
        !newerMessage &&
        this.#head(target.roomId) !== receipt.through
      )
        throw new StaleContextError(receipt.through, this.#head(target.roomId));
      const causal =
        threadId === undefined
          ? this.#context.database
              .prepare(
                "SELECT * FROM room_events WHERE room_id=? AND room_seq=?",
              )
              .get(target.roomId, receipt.through)
          : this.#context.database
              .prepare(
                "SELECT * FROM room_events WHERE room_id=? AND room_seq<=? AND event_id=?",
              )
              .get(target.roomId, receipt.through, receipt.causalEventId);
      if (!causal)
        throw new ForbiddenError("target context causal event is unavailable");
      const principal = principalFromRow(
        this.#context.database
          .prepare("SELECT * FROM principals WHERE principal_id=?")
          .get(origin.participantId)!,
      );
      const metadata = this.#context
        .attachmentComments()
        .workerMetadata(execution, input, {
          roomId: target.roomId,
          ...(threadId ? { threadId } : {}),
        });
      const attachments = workerMessageAttachments({
        database: this.#context.database,
        roomId: target.roomId,
        input,
        eventFromRow: this.#context.eventFromRow,
        resolveLive: (ids) =>
          this.#context
            .files()
            .forWorkerMessage(execution, ids, undefined, target.roomId),
      });
      const body =
        input.sendDraft === true
          ? this.#context.database
              .prepare(
                "SELECT body FROM held_message_drafts WHERE held_draft_id=?",
              )
              .get(input.heldDraftId!)?.body
          : input.body;
      const result = this.#context
        .collaboration()
        .postActivationMessage(principal, {
          ...(metadata ? { attachmentComment: metadata } : {}),
          activationId: origin.activationId,
          roomId: target.roomId,
          basedOnRoomSeq: receipt.through,
          idempotencyKey: input.idempotencyKey,
          attachments,
          ...(input.sendDraft === true
            ? {
                heldDraftId: input.heldDraftId!,
                ...(input.anyway ? { continueAnyway: true } : {}),
              }
            : { body: input.body ?? "" }),
          ...(threadId ? { threadId } : {}),
          recipients: workerReplyRecipients({
            database: this.#context.database,
            participantId: origin.participantId,
            roomId: target.roomId,
            causalEvent: this.#context.eventFromRow(causal),
            ...(threadId ? { threadId } : {}),
            ...(typeof body === "string" ? { body } : {}),
          }),
        });
      if ("event" in result && !result.deduplicated)
        this.#context.files().consume(attachments, result.event.aggregateId);
      this.#context.attachmentComments().bindWorkerResult(metadata, result);
      return P.WorkerMessagePostResponseSchema.parse(result);
    });
  }
  #threadContext(
    execution: AuthenticatedWorkerExecutionContext,
    roomId: string,
    threadId: string,
    limit: number,
  ) {
    // Reuse read projections inside the caller's transaction, without nesting one.
    const reads = new WorkerReadService({
      database: this.#context.database,
      requireWorker: this.#context.requireWorker,
    });
    const root = this.#context.database
      .prepare(
        "SELECT root_message_id FROM threads WHERE room_id=? AND thread_id=?",
      )
      .get(roomId, threadId)!;
    return {
      rootMessage: reads.resolve(execution, {
        channel: roomId,
        messageId: text(root, "root_message_id"),
      }).message,
      history: reads.history(execution, { channel: roomId, threadId, limit }),
    };
  }
  #authorize(execution: AuthenticatedWorkerExecutionContext) {
    const scope = this.#context.requireWorker(execution);
    requireWorkerRoomVisibility(this.#context.database, scope);
    return scope;
  }
  #head(roomId: string) {
    return (
      integer(
        this.#context.database
          .prepare("SELECT next_seq FROM rooms WHERE room_id=?")
          .get(roomId)!,
        "next_seq",
      ) - 1
    );
  }
  #key(): Buffer {
    const name = "worker-target-context-hmac-v1";
    let row = this.#context.database
      .prepare(
        "SELECT secret_value FROM kernel_runtime_secrets WHERE secret_name=?",
      )
      .get(name);
    if (!row) {
      this.#context.database
        .prepare(
          "INSERT OR IGNORE INTO kernel_runtime_secrets(secret_name,secret_value) VALUES(?,?)",
        )
        .run(name, randomBytes(32).toString("hex"));
      row = this.#context.database
        .prepare(
          "SELECT secret_value FROM kernel_runtime_secrets WHERE secret_name=?",
        )
        .get(name);
    }
    return Buffer.from(text(row!, "secret_value"), "hex");
  }
  #sign(receipt: Receipt) {
    const body = Buffer.from(JSON.stringify(receipt)).toString("base64url");
    return `${body}.${createHmac("sha256", this.#key()).update(body).digest("base64url")}`;
  }
  #verify(
    token: string,
    origin: P.ActivationCredentialScope,
    target: { roomId: string; threadId?: string },
    allowExpiredReplay = false,
  ): Receipt {
    try {
      const [body, signature, ...extra] = token.split(".");
      if (!body || !signature || extra.length) throw new Error();
      const expected = createHmac("sha256", this.#key()).update(body).digest(),
        actual = Buffer.from(signature, "base64url");
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Error();
      const r = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      ) as Receipt;
      if (
        r.domain !== "rah-worker-target-v1" ||
        r.participantId !== origin.participantId ||
        r.runAttemptId !== origin.runAttemptId ||
        r.roomId !== target.roomId ||
        r.threadId !== (target.threadId ?? null) ||
        (target.threadId !== undefined &&
          (typeof r.threadContextHash !== "string" ||
            !/^[a-f0-9]{64}$/u.test(r.threadContextHash) ||
            typeof r.causalEventId !== "string")) ||
        ![r.floor, r.cursor, r.through, r.expires].every(
          Number.isSafeInteger,
        ) ||
        r.floor < 0 ||
        r.floor > r.cursor ||
        r.cursor > r.through ||
        r.through > this.#head(target.roomId) ||
        (!allowExpiredReplay && r.expires <= this.#context.now().getTime())
      )
        throw new Error();
      return r;
    } catch {
      throw new ForbiddenError(
        "invalid, expired or mismatched target context receipt",
      );
    }
  }
}
