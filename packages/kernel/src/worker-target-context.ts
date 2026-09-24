import { assertWorkerReplyTarget } from "./worker-reply-target-guard.ts";
import { requireInstanceReplyTarget } from "./instance-worker-scope.ts";
import {
  workerAddressing,
  workerAddressingBudget,
} from "./worker-addressing.ts";
import type { RoomFiles } from "./room-files.ts";
import { workerMessageAttachments } from "./worker-message-attachments.ts";
import { WorkerReadService } from "./worker-read-tools.ts";
import type { AttachmentCommentsService } from "./attachment-comments.ts";
import type { RoomSnapshot } from "./types.ts";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import * as P from "@rah-os/protocol";
import type { AuthenticatedWorkerExecutionContext } from "./auth.ts";
import type { CollaborationService } from "./collaboration-service.ts";
import { fromRow as principalFromRow } from "./principal-profile.ts";
import { ForbiddenError, NotFoundError, StaleContextError } from "./errors.ts";
import {
  findActiveHeldMessageDraftForTarget,
  saveHeldMessageDraft,
  SEND_DRAFT_NOT_FOUND_MESSAGE,
} from "./held-message-drafts.ts";
import { deriveWorkerMessageIdempotencyKey } from "./worker-message-identity.ts";
import {
  detectThreadContextParentSend,
  readWorkerTargetContextWindow,
  readWorkerTargetReadPosition,
  recordWorkerTargetContextWindow,
  recordWorkerTargetReadPosition,
} from "./worker-target-read-position.ts";
import { syncRoomEventWindow } from "./room-sync.ts";
import { annotateTaskAnchoredEvents } from "./task-anchor-annotation.ts";
import { integer, text, type Row } from "./sqlite-row.ts";
import {
  resolveWorkerReadTarget,
  workerReadThread,
  workerRoomEntry,
  WORKER_VISIBLE_ROOMS,
  type WorkerDirectRoomOpener,
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
  /** Present only where Raft's `resolveChannel` may open a writable DM target. */
  openDirect?: WorkerDirectRoomOpener;
  requireWorker: (
    execution: AuthenticatedWorkerExecutionContext,
  ) => P.ActivationCredentialScope;
  transaction: <T>(operation: () => T) => T;
  eventFromRow: (row: Row) => P.RoomEvent;
  snapshot: (roomId: string) => RoomSnapshot;
  collaboration: () => CollaborationService;
  attachmentComments: () => AttachmentCommentsService;
  files: () => RoomFiles;
  /**
   * The Kernel's single post-confirmation entry point. The `--target` route is
   * a second way to publish the same mutation, so it must reach the same
   * confirmation the originating route reaches — but it passes the Room the
   * post actually landed in (a cross-Room or DM target confirms nothing about
   * this Activation's Room) and the model's *own* `basedOnRoomSeq`, never the
   * one `#resolveSendWindow` derived from Kernel state.
   */
  acknowledgePresentedDelivery: (
    scope: P.ActivationCredentialScope,
    input: { postedRoomId: string; modelBasedOnRoomSeq: number | undefined },
  ) => void;
  /** Final-reply marker for a committed `final` post (never an ACK). */
  recordFinalReply: (
    scope: P.ActivationCredentialScope,
    event: P.RoomEvent,
  ) => void;
  /**
   * The freshness floor a *sent* presented rendering justifies on one target:
   * the presented prefix, or 0. A hold exists to stop an Agent answering past
   * facts it has not seen; a range the Host really put in front of this
   * RunAttempt is seen, so holding it again buys nothing but a round trip.
   * Content past the first degraded event is genuinely unread and still holds.
   */
  presentedFreshnessFloor: (
    scope: P.ActivationCredentialScope,
    roomId: string,
  ) => number;
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
      // Raft's read command keeps its paging position in the tool's own state,
      // so a continuation carries no token. RAH keeps the same fact server-side
      // per (participant, RunAttempt, target): the stored window is the frozen
      // snapshot — same `through`, same floor, same Thread facts — and it is
      // dropped as soon as it is complete or its hour is up, so the next
      // `room-read` opens a fresh window at the head. A presented receipt is
      // still verified, and a forged or tampered one is still rejected.
      const prior = input.contextReceipt
        ? this.#verify(input.contextReceipt, origin, target)
        : readWorkerTargetContextWindow(this.#context.database, {
            participantId: origin.participantId,
            roomId: target.roomId,
            ...(target.threadId === undefined
              ? {}
              : { threadId: target.threadId }),
            runAttemptId: origin.runAttemptId,
            nowMs: this.#context.now().getTime(),
          });
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
          eventOverheadBytes: workerAddressingBudget(
            this.#context.database,
            origin,
          ),
          responseOverheadBytes:
            Buffer.byteLength(JSON.stringify(envelope)) - 4 + 48,
        },
      );
      receipt.cursor = window.cursorAfter;
      recordWorkerTargetContextWindow(
        this.#context.database,
        {
          participantId: origin.participantId,
          roomId: target.roomId,
          ...(target.threadId === undefined
            ? {}
            : { threadId: target.threadId }),
          runAttemptId: origin.runAttemptId,
          updatedAt: this.#context.now().toISOString(),
        },
        {
          through,
          floor,
          cursor: receipt.cursor,
          threadContextHash: receipt.threadContextHash,
          causalEventId: receipt.causalEventId,
          expires: receipt.expires,
        },
      );
      // Raft's read commands record the consumed sequence for the target so the
      // send never has to carry it. This is the same fact, kept server-side.
      recordWorkerTargetReadPosition(this.#context.database, {
        messageSeqs: window.events
          .filter((event) => event.type === "message.posted")
          .map((event) => event.roomSeq),
        participantId: origin.participantId,
        roomId: target.roomId,
        ...(target.threadId === undefined ? {} : { threadId: target.threadId }),
        throughRoomSeq: receipt.cursor,
        updatedAt: this.#context.now().toISOString(),
      });
      const response = P.WorkerRoomContextResponseSchema.parse({
        ...envelope,
        addressing: workerAddressing(
          this.#context.database,
          origin,
          window.events,
        ),
        complete: receipt.cursor === through,
        contextReceipt: this.#sign(receipt),
        // The same `[task #N status=...]` suffix the Agent sees in
        // `message-read`; the receipt is signed over the unannotated window.
        window: {
          ...window,
          events: annotateTaskAnchoredEvents(
            this.#context.database,
            window.events,
          ),
        },
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
      if (input.channel === undefined)
        throw new ForbiddenError("target post requires a target channel");
      const target = resolveWorkerReadTarget(
        this.#context.database,
        origin,
        input.channel,
        this.#context.openDirect,
      );
      requireInstanceReplyTarget(
        this.#context.database,
        origin.participantId,
        origin.roomId,
        target.roomId,
      );
      const threadId = workerReadThread(target, input.threadId) ?? undefined;
      // A presented receipt or a saved draft already fixed its own target.
      if (input.contextReceipt === undefined && input.sendDraft !== true)
        assertWorkerReplyTarget(this.#context.database, origin, {
          roomId: target.roomId,
          threadId,
          modelBasedOnRoomSeq: input.basedOnRoomSeq,
        });
      const draft = this.#resolveOutgoingDraft(origin, target, threadId, input);
      const window = this.#resolveSendWindow(
        origin,
        target,
        threadId,
        input,
        draft,
      );
      const principal = principalFromRow(
        this.#context.database
          .prepare("SELECT * FROM principals WHERE principal_id=?")
          .get(origin.participantId)!,
      );
      // Downstream helpers see the resolved send: the derived cursor and key,
      // and the draft the server itself looked up for this target.
      const resolved = {
        ...input,
        basedOnRoomSeq: window.basedOnRoomSeq,
        idempotencyKey: window.idempotencyKey,
        ...(draft === undefined ? {} : { heldDraftId: draft.heldDraftId }),
      };
      const metadata = this.#context
        .attachmentComments()
        .workerMetadata(execution, resolved, {
          roomId: target.roomId,
          ...(threadId ? { threadId } : {}),
        });
      const attachments = workerMessageAttachments({
        database: this.#context.database,
        roomId: target.roomId,
        input: resolved,
        eventFromRow: this.#context.eventFromRow,
        resolveLive: (ids) =>
          this.#context
            .files()
            .forWorkerMessage(execution, ids, undefined, target.roomId),
      });
      const confirmation = this.#threadContextTargetConfirmation(
        origin,
        target,
        threadId,
        input,
        { basedOnRoomSeq: window.basedOnRoomSeq, key: window.idempotencyKey },
        attachments,
        metadata,
      );
      if (confirmation !== undefined) return confirmation;
      const body =
        input.sendDraft === true
          ? draft === undefined
            ? undefined
            : text(draft.row, "body")
          : input.body;
      const result = this.#context
        .collaboration()
        .postActivationMessage(principal, {
          ...(metadata ? { attachmentComment: metadata } : {}),
          activationId: origin.activationId,
          roomId: target.roomId,
          basedOnRoomSeq: window.basedOnRoomSeq,
          freshnessFloorSeq: window.freshnessFloorSeq,
          idempotencyKey: window.idempotencyKey,
          attachments,
          ...(input.sendDraft === true
            ? {
                heldDraftId: draft!.heldDraftId,
                ...(input.anyway ? { continueAnyway: true } : {}),
              }
            : { body: input.body ?? "" }),
          ...(threadId ? { threadId } : {}),
          recipients: workerReplyRecipients({
            database: this.#context.database,
            participantId: origin.participantId,
            roomId: target.roomId,
            causalEvent: this.#context.eventFromRow(window.causal),
            ...(threadId ? { threadId } : {}),
            ...(typeof body === "string" ? { body } : {}),
          }),
        });
      if ("event" in result && !result.deduplicated)
        this.#context.files().consume(attachments, result.event.aggregateId);
      this.#context.attachmentComments().bindWorkerResult(metadata, result);
      if ("event" in result)
        this.#context.acknowledgePresentedDelivery(origin, {
          postedRoomId: result.event.roomId,
          modelBasedOnRoomSeq: input.basedOnRoomSeq,
        });
      if ("event" in result && input.final === true)
        this.#context.recordFinalReply(origin, result.event);
      return P.WorkerMessagePostResponseSchema.parse(result);
    });
  }

  /**
   * Raft's `detectThreadContextParentSend`, evaluated in `handleMessageSend`
   * only when `!opts.sendDraft && !opts.targetConfirmed`. RAH's confirmation is
   * the same affordance Raft uses — `--send-draft` on that target — so no new
   * flag exists and `sendDraft` is exactly the confirmed case.
   *
   * Deliberately narrow: never for a Thread target, never when the parent Room
   * was read at least as recently as the Thread, never for `sendDraft`. It also
   * only exists on this explicit-target route; the originating route (no
   * `--target`) is Raft's unguarded default send and keeps today's behavior.
   *
   * On a hit the composition is saved as this target's draft and nothing is
   * published; no read position is consumed or advanced.
   */
  #threadContextTargetConfirmation(
    origin: P.ActivationCredentialScope,
    target: { roomId: string },
    threadId: string | undefined,
    input: P.WorkerMessagePostRequest,
    window: { basedOnRoomSeq: number; key: string },
    attachments: unknown[],
    attachmentComment: { attachmentId: string; anchor: null } | undefined,
  ): P.WorkerMessageTargetConfirmationResponse | undefined {
    if (input.sendDraft === true || threadId !== undefined) return undefined;
    const detected = detectThreadContextParentSend(this.#context.database, {
      participantId: origin.participantId,
      roomId: target.roomId,
    });
    if (detected === undefined) return undefined;
    const createdAt = this.#context.now().toISOString();
    const draft = saveHeldMessageDraft(this.#context.database, {
      activationId: origin.activationId,
      ...(attachmentComment === undefined ? {} : { attachmentComment }),
      attachments,
      basedOnRoomSeq: window.basedOnRoomSeq,
      body: input.body?.trim() ?? "",
      createdAt,
      heldDraftId: `held_draft_${randomUUID()}`,
      idempotencyKey: window.key,
      participantId: origin.participantId,
      roomId: target.roomId,
      // The column requires a strictly greater seen bound; the Room head is the
      // honest one, and this row is never rendered as a freshness hold.
      seenUpToSeq: Math.max(
        this.#head(target.roomId),
        window.basedOnRoomSeq + 1,
      ),
    });
    const room = this.#context.database
      .prepare(
        `${WORKER_VISIBLE_ROOMS} WHERE membership.principal_id=? AND r.room_id=?`,
      )
      .get(origin.participantId, target.roomId)!;
    const channel = workerRoomEntry(
      this.#context.database,
      origin.participantId,
      room,
    ).channel;
    return P.WorkerMessageTargetConfirmationResponseSchema.parse({
      activationIds: [],
      heldDraftId: text(draft, "held_draft_id"),
      parentTarget: channel,
      threadTarget: `${channel}:${detected.threadId}`,
      threadSeq: detected.threadSeq,
      reason: "thread_context_target_mismatch",
      state: "target_confirmation_required",
    });
  }

  /** Raft's tool resolves the saved draft for (agent, target) internally; the
   * model supplies only `--send-draft`. An explicitly presented heldDraftId is
   * still honoured and still fenced by the Kernel. */
  #resolveOutgoingDraft(
    origin: P.ActivationCredentialScope,
    target: { roomId: string },
    threadId: string | undefined,
    input: P.WorkerMessagePostRequest,
  ): { heldDraftId: string; row: Row } | undefined {
    if (input.sendDraft !== true) return undefined;
    const heldDraftId =
      input.heldDraftId ??
      (() => {
        const saved = findActiveHeldMessageDraftForTarget(
          this.#context.database,
          {
            participantId: origin.participantId,
            roomId: target.roomId,
            ...(threadId === undefined ? {} : { threadId }),
            nowMs: this.#context.now().getTime(),
          },
        );
        if (saved === undefined)
          throw new NotFoundError(SEND_DRAFT_NOT_FOUND_MESSAGE);
        return text(saved, "held_draft_id");
      })();
    const row = this.#context.database
      .prepare("SELECT * FROM held_message_drafts WHERE held_draft_id=?")
      .get(heldDraftId);
    if (row === undefined)
      throw new NotFoundError(`Held draft ${heldDraftId} was not found`);
    return { heldDraftId, row };
  }

  #contentIdentity(
    input: P.WorkerMessagePostRequest,
    draft: { heldDraftId: string; row: Row } | undefined,
  ) {
    return draft === undefined
      ? {
          kind: "compose" as const,
          ...(input.body === undefined ? {} : { body: input.body }),
          ...(input.attachmentIds === undefined
            ? {}
            : { attachmentIds: input.attachmentIds }),
          ...(input.commentAttachmentId === undefined
            ? {}
            : { commentAttachmentId: input.commentAttachmentId }),
        }
      : {
          kind: "draft" as const,
          heldDraftId: draft.heldDraftId,
          reholdCount: integer(draft.row, "rehold_count"),
        };
  }

  /** Either the presented receipt's window (verified exactly as before) or the
   * server's own stored read position for this target. */
  #resolveSendWindow(
    origin: P.ActivationCredentialScope,
    target: { roomId: string; threadId?: string },
    threadId: string | undefined,
    input: P.WorkerMessagePostRequest,
    draft: { heldDraftId: string; row: Row } | undefined,
  ): {
    basedOnRoomSeq: number;
    freshnessFloorSeq: number;
    causal: Row;
    idempotencyKey: string;
  } {
    const database = this.#context.database;
    const derive = (basedOnRoomSeq: number) =>
      input.idempotencyKey ??
      deriveWorkerMessageIdempotencyKey({
        participantId: origin.participantId,
        activationId: origin.activationId,
        roomId: target.roomId,
        ...(threadId === undefined ? {} : { threadId }),
        basedOnRoomSeq,
        content: this.#contentIdentity(input, draft),
      });
    if (input.contextReceipt !== undefined) {
      // Presented-receipt path: unchanged, including the replay allowance that
      // lets an already-committed mutation re-verify an expired receipt.
      const presentedKey = input.idempotencyKey;
      const replay =
        presentedKey === undefined
          ? undefined
          : database
              .prepare(
                "SELECT 1 FROM room_events WHERE room_id=? AND idempotency_key=?",
              )
              .get(target.roomId, presentedKey);
      const receipt = this.#verify(
        input.contextReceipt,
        origin,
        target,
        replay !== undefined,
      );
      if (
        receipt.cursor !== receipt.through ||
        (input.basedOnRoomSeq !== undefined &&
          input.basedOnRoomSeq !== receipt.through)
      )
        throw new ForbiddenError(
          "target context window is incomplete or cursor differs",
        );
      if ((threadId ?? null) !== receipt.threadId)
        throw new ForbiddenError(
          "target receipt does not authorize another Thread",
        );
      const idempotencyKey = derive(receipt.through);
      const previous =
        replay ??
        database
          .prepare(
            "SELECT 1 FROM room_events WHERE room_id=? AND idempotency_key=?",
          )
          .get(target.roomId, idempotencyKey);
      const previousHeld = database
        .prepare(
          "SELECT 1 FROM held_message_drafts WHERE room_id=? AND idempotency_key=?",
        )
        .get(target.roomId, idempotencyKey);
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
          ? database
              .prepare(
                "SELECT * FROM room_events WHERE room_id=? AND room_seq=?",
              )
              .get(target.roomId, receipt.through)
          : database
              .prepare(
                "SELECT * FROM room_events WHERE room_id=? AND room_seq<=? AND event_id=?",
              )
              .get(target.roomId, receipt.through, receipt.causalEventId);
      if (!causal)
        throw new ForbiddenError("target context causal event is unavailable");
      return {
        basedOnRoomSeq: receipt.through,
        freshnessFloorSeq: receipt.through,
        causal,
        idempotencyKey,
      };
    }
    // Derived path: the server verifies against its own stored read position
    // instead of a client-presented receipt. There is no presented window, so
    // there is nothing for the Room-head staleness gate to compare against; the
    // freshness hold below is the fence, computed from the same target-message
    // numbers as before. An explicit basedOnRoomSeq may only narrow the floor.
    const stored =
      readWorkerTargetReadPosition(database, {
        participantId: origin.participantId,
        roomId: target.roomId,
        ...(threadId === undefined ? {} : { threadId }),
      }) ?? 0;
    const basedOnRoomSeq =
      input.basedOnRoomSeq === undefined
        ? stored
        : Math.min(input.basedOnRoomSeq, stored);
    const own = database
      .prepare(
        `SELECT room_events.room_seq AS seq
         FROM messages
         JOIN room_events ON room_events.room_id=messages.room_id
           AND room_events.aggregate_id=messages.message_id
           AND room_events.type='message.posted'
         WHERE messages.room_id=? AND messages.thread_id IS ? AND messages.actor_id=?
         ORDER BY room_events.room_seq DESC LIMIT 1`,
      )
      .get(target.roomId, threadId ?? null, origin.participantId);
    const causal =
      (threadId === undefined
        ? undefined
        : database
            .prepare(
              `SELECT * FROM room_events WHERE room_id=?
               AND json_extract(payload_json, '$.threadId')=?
               ORDER BY room_seq DESC LIMIT 1`,
            )
            .get(target.roomId, threadId)) ??
      database
        .prepare(
          "SELECT * FROM room_events WHERE room_id=? ORDER BY room_seq DESC LIMIT 1",
        )
        .get(target.roomId);
    if (!causal)
      throw new ForbiddenError("target context causal event is unavailable");
    return {
      basedOnRoomSeq,
      // An Agent has necessarily seen what it published itself, so its own
      // latest message in this target never re-holds its next one. This widens
      // nothing: no other participant's message is treated as seen.
      //
      // The presented prefix joins it for the same reason and with the same
      // narrowness: it is a range the Kernel rendered and the Host reported
      // sending to this very RunAttempt. It raises the FLOOR only — never
      // `basedOnRoomSeq`, which stays the server's own read position, so the
      // implicit acknowledgement still needs the model's own causal marker.
      freshnessFloorSeq: Math.max(
        basedOnRoomSeq,
        own === undefined ? 0 : integer(own, "seq"),
        this.#context.presentedFreshnessFloor(origin, target.roomId),
      ),
      causal,
      idempotencyKey: derive(basedOnRoomSeq),
    };
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
