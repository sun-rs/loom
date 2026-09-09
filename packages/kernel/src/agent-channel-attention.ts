import { resolveWorkerReadTarget } from "./worker-read-targets.ts";
import type { WorkerTargetContextService } from "./worker-target-context.ts";
import type { DatabaseSync } from "node:sqlite";
import * as P from "@rah-os/protocol";
import type { AuthenticatedWorkerExecutionContext } from "./auth.ts";
import {
  ForbiddenError,
  IdempotencyConflictError,
  StaleContextError,
} from "./errors.ts";
import type {
  AttentionRecipient,
  RoomEventWriter,
} from "./room-event-writer.ts";
import { deriveWorkerCommandIdempotencyKey } from "./worker-message-identity.ts";
import { integer, jsonObject, text } from "./sqlite-row.ts";
import { requireWorkerRoomVisibility } from "./worker-task-scope.ts";

export function readAgentChannelAttention(
  database: DatabaseSync,
  participantId: string,
  roomId: string,
): P.AgentChannelAttention {
  const row = database
    .prepare(
      "SELECT activity_muted,mute_from_seq FROM agent_channel_attention WHERE participant_id=? AND room_id=?",
    )
    .get(participantId, roomId);
  return {
    activityMuted: row?.activity_muted === 1,
    muteFromSeq:
      row?.mute_from_seq === null || row === undefined
        ? null
        : integer(row, "mute_from_seq"),
  };
}
/** One attention boundary, before canonical Inbox/Activation/Outbox creation. Visibility and existing queued work are unchanged. */
export function allowsAgentChannelAttention(
  database: DatabaseSync,
  event: P.RoomEvent,
  recipient: AttentionRecipient,
): boolean {
  const setting = readAgentChannelAttention(
    database,
    recipient.participantId,
    event.roomId,
  );
  if (
    !setting.activityMuted ||
    setting.muteFromSeq === null ||
    event.roomSeq <= setting.muteFromSeq
  )
    return true;
  const room = database
    .prepare("SELECT kind FROM rooms WHERE room_id=?")
    .get(event.roomId);
  if (room?.kind !== "channel") return true;
  if (["mention", "dm", "thread_subscription"].includes(recipient.reason))
    return true;
  // RAH typed direct responsibility is the local equivalent of a personal task assignment receipt.
  if (
    ["task_assigned", "task_collaboration", "input_resolved"].includes(
      recipient.reason,
    )
  )
    return true;
  if (
    recipient.obligations?.some(
      (item) =>
        item.kind === "task_owner_follow_up" || item.kind === "task_review",
    )
  )
    return true;
  if (recipient.reason === "dependency_resolved") {
    const ready = event.payload.readyTaskIds;
    if (
      Array.isArray(ready) &&
      ready.some(
        (id) =>
          typeof id === "string" &&
          database
            .prepare(
              "SELECT 1 FROM tasks WHERE room_id=? AND task_id=? AND assignee_id=?",
            )
            .get(event.roomId, id, recipient.participantId),
      )
    )
      return true;
  }
  if (event.aggregateType === "task") {
    const principal = database
      .prepare(
        "SELECT handle FROM principals WHERE principal_id=? AND kind='agent'",
      )
      .get(recipient.participantId);
    if (principal) {
      const changes = P.TaskAmendChangesSchema.safeParse(event.payload.changes);
      const prose = [
        event.payload.title,
        event.payload.description,
        ...(changes.success
          ? [changes.data.title?.to, changes.data.description?.to]
          : []),
      ]
        .filter((v): v is string => typeof v === "string")
        .join("\n");
      if (
        P.messageMentionCandidates(prose, [text(principal, "handle")]).some(
          (item) => item.handle === text(principal, "handle"),
        )
      )
        return true;
    }
  }
  // Reminders/manual execution controls are not ordinary Channel Activity.
  return ![
    "room_policy",
    "task_available",
    "task_updated",
    "task_review",
    "dependency_resolved",
  ].includes(recipient.reason);
}

type Context = {
  database: DatabaseSync;
  events: RoomEventWriter;
  requireWorker(
    execution: AuthenticatedWorkerExecutionContext,
  ): P.ActivationCredentialScope;
  transaction<T>(fn: () => T): T;
  targetContext: () => WorkerTargetContextService;
};
export class AgentChannelAttentionService {
  private readonly context: Context;
  constructor(context: Context) {
    this.context = context;
  }
  private lastOppositeSeq(
    participantId: string,
    roomId: string,
    activityMuted: boolean,
  ): number {
    const row = this.context.database
      .prepare(
        `SELECT MAX(room_seq) AS seq FROM room_events
         WHERE room_id=? AND actor_id=? AND type='channel.attention_changed'
           AND json_extract(payload_json, '$.activityMuted')=?`,
      )
      .get(roomId, participantId, activityMuted ? 0 : 1);
    return row === undefined || row.seq === null ? 0 : integer(row, "seq");
  }
  private head(roomId: string): number {
    return integer(
      this.context.database
        .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
        .get(roomId)!,
      "n",
    );
  }
  set(
    execution: AuthenticatedWorkerExecutionContext,
    raw: P.WorkerChannelAttentionRequest,
    activityMuted: boolean,
  ): P.WorkerChannelAttentionResponse {
    return this.context.transaction(() => {
      const { database, events } = this.context,
        scope = this.context.requireWorker(execution),
        presented = P.WorkerChannelAttentionRequestSchema.parse(raw);
      requireWorkerRoomVisibility(database, scope);
      const target = resolveWorkerReadTarget(
        database,
        scope,
        presented.channel,
      );
      const roomId = target.roomId;
      if (target.threadId)
        throw new ForbiddenError(
          "Channel mute cannot target a Thread; use Thread follow controls",
        );
      // Raft's `channel mute --target '#channel'` carries no causality at all.
      // The cursor is provenance only — the mute takes effect from the event's
      // own sequence — so an omitted one is the target Room's current head,
      // which is exactly the fact the server already owns. An omitted key names
      // the operation: this participant, this Run, this Channel, mute or
      // unmute, so a retry deduplicates and the opposite command does not.
      const activityMutedLabel = activityMuted ? "mute" : "unmute";
      const input = {
        ...presented,
        basedOnRoomSeq:
          presented.basedOnRoomSeq ??
          (presented.channel === undefined ? scope.toSeq : this.head(roomId)),
        idempotencyKey:
          presented.idempotencyKey ??
          deriveWorkerCommandIdempotencyKey({
            participantId: scope.participantId,
            activationId: scope.activationId,
            roomId,
            operation: "channel-attention",
            subjectId: roomId,
            // The sequence of the last opposite transition. It is stable across
            // this command's own commit, so a retry still deduplicates, while
            // mute → unmute → mute is three distinct operations rather than a
            // replay of the first mute.
            content: [
              activityMutedLabel,
              String(
                this.lastOppositeSeq(
                  scope.participantId,
                  roomId,
                  activityMuted,
                ),
              ),
            ],
          }),
      };
      const room = database
        .prepare("SELECT kind FROM rooms WHERE room_id=?")
        .get(roomId);
      if (room?.kind !== "channel")
        throw new ForbiddenError(
          "only a joined regular Channel can be muted; DMs and the control Room remain independent",
        );
      const old = database
        .prepare(
          "SELECT * FROM room_events WHERE room_id=? AND idempotency_key=?",
        )
        .get(roomId, input.idempotencyKey);
      if (old) {
        const event = events.eventFromRow(old);
        if (
          event.type !== "channel.attention_changed" ||
          event.actorId !== scope.participantId ||
          event.aggregateId !== scope.participantId ||
          event.payload.activityMuted !== activityMuted
        )
          throw new IdempotencyConflictError(
            "idempotency key was used for another channel attention command",
          );
        if (input.contextReceipt !== undefined)
          this.context.targetContext().verifyPresented(
            execution,
            {
              channel: input.channel!,
              contextReceipt: input.contextReceipt,
              ...(presented.basedOnRoomSeq === undefined
                ? {}
                : { basedOnRoomSeq: presented.basedOnRoomSeq }),
            },
            { allowExpired: true },
          );
        return {
          ...readAgentChannelAttention(database, scope.participantId, roomId),
          roomId: roomId,
          event,
          deduplicated: true,
        };
      }
      if (input.contextReceipt !== undefined)
        this.context.targetContext().verifyPresented(
          execution,
          {
            channel: input.channel!,
            contextReceipt: input.contextReceipt,
            ...(presented.basedOnRoomSeq === undefined
              ? {}
              : { basedOnRoomSeq: presented.basedOnRoomSeq }),
          },
          {},
        );
      const row = database
        .prepare("SELECT * FROM room_events WHERE room_id=? AND room_seq=?")
        .get(roomId, input.basedOnRoomSeq);
      const payload = row ? jsonObject(row, "payload_json") : {};
      if (
        input.channel === undefined &&
        input.basedOnRoomSeq !== scope.toSeq &&
        (!row ||
          text(row, "actor_id") !== scope.participantId ||
          (payload.runAttemptId !== scope.runAttemptId &&
            payload.activationId !== scope.activationId))
      )
        throw new StaleContextError(input.basedOnRoomSeq, scope.toSeq);
      const current = database
        .prepare(
          "SELECT updated_seq FROM agent_channel_attention WHERE participant_id=? AND room_id=?",
        )
        .get(scope.participantId, roomId);
      if (current && integer(current, "updated_seq") > input.basedOnRoomSeq)
        throw new StaleContextError(
          input.basedOnRoomSeq,
          integer(current, "updated_seq"),
        );
      const event = events.append({
        actorId: scope.participantId,
        aggregateId: scope.participantId,
        aggregateType: "room_attention",
        roomId: roomId,
        type: "channel.attention_changed",
        idempotencyKey: input.idempotencyKey,
        payload: {
          activityMuted,
          basedOnRoomSeq: input.basedOnRoomSeq,
          runAttemptId: scope.runAttemptId,
        },
      });
      database
        .prepare(
          "INSERT INTO agent_channel_attention(participant_id,room_id,activity_muted,mute_from_seq,updated_seq,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(participant_id,room_id) DO UPDATE SET activity_muted=excluded.activity_muted,mute_from_seq=excluded.mute_from_seq,updated_seq=excluded.updated_seq,updated_at=excluded.updated_at",
        )
        .run(
          scope.participantId,
          roomId,
          activityMuted ? 1 : 0,
          activityMuted ? event.roomSeq : null,
          event.roomSeq,
          event.createdAt,
        );
      return {
        ...readAgentChannelAttention(database, scope.participantId, roomId),
        roomId: roomId,
        event,
        deduplicated: false,
      };
    });
  }
}
