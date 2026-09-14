import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { ActivationCredentialScope } from "@rah-os/protocol";
import { roomProjectionFromRow } from "./collaboration-projection.ts";
import { ConflictError, NotFoundError } from "./errors.ts";
import { integer, text, type Row } from "./sqlite-row.ts";
import { requireWorkerRoomVisibility } from "./worker-task-scope.ts";
import { readAgentChannelAttention } from "./agent-channel-attention.ts";
import { fromRow as principalFromRow } from "./principal-profile.ts";
import type { Principal } from "./types.ts";

/** Deliberately lacks Activation, Run, consumer and delivery bounds. */
export type WorkerVisibleRoomScope = Pick<
  ActivationCredentialScope,
  "participantId" | "roomId"
>;
export const WORKER_VISIBLE_ROOMS = `SELECT r.*, r.rowid AS room_order, d.left_principal_id, d.right_principal_id,
  peer.handle AS peer_handle FROM rooms r
  JOIN memberships membership ON membership.room_id=r.room_id AND r.system_hidden=0
  LEFT JOIN direct_room_pairs d ON d.room_id=r.room_id
  LEFT JOIN principals peer ON peer.principal_id=CASE WHEN d.left_principal_id=membership.principal_id
    THEN d.right_principal_id ELSE d.left_principal_id END`;

export function workerRoomEntry(
  database: DatabaseSync,
  participantId: string,
  row: Row,
) {
  const room = roomProjectionFromRow(row);
  return {
    room,
    channel:
      room.kind === "direct" && typeof row.peer_handle === "string"
        ? `dm:@${row.peer_handle}`
        : `#${room.slug}`,
    attention: readAgentChannelAttention(database, participantId, room.roomId),
  };
}

/**
 * The directory an Agent may already see and address: a principal that is a
 * member of a Room the Agent is itself a member of. This is the predicate
 * `profile-show --target @HANDLE` and `room-members` project (the same
 * `memberships` join, `kind IN ('human','agent')`) and the one
 * `mentionableRoomAgentHandles` uses to resolve `@handle` for agent-to-agent
 * addressing. Nothing wider — Workspace membership, the control-Room roster —
 * is treated as addressable.
 */
const AGENT_ADDRESSABLE_PEER = `FROM principals peer
  JOIN memberships peer_shared ON peer_shared.principal_id=peer.principal_id
  JOIN rooms shared ON shared.room_id=peer_shared.room_id AND shared.kind IN ('channel','direct') AND shared.system_hidden=0
  JOIN memberships self_shared ON self_shared.room_id=shared.room_id AND self_shared.principal_id=?
  WHERE peer.kind IN ('human','agent') AND peer.principal_id<>?`;

export function agentSharesVisibleRoom(
  database: DatabaseSync,
  participantId: string,
  peerPrincipalId: string,
): boolean {
  return (
    database
      .prepare(
        `SELECT 1 AS present ${AGENT_ADDRESSABLE_PEER} AND peer.principal_id=? LIMIT 1`,
      )
      .get(participantId, participantId, peerPrincipalId) !== undefined
  );
}

/** Opens the Direct Room for `dm:@handle` when the Agent may address it. */
export type WorkerDirectRoomOpener = (input: {
  participantId: string;
  handle: string;
}) => void;

type DirectRoomOpenPort = {
  openDirectRoom(
    actor: Principal,
    input: {
      basedOnControlRoomSeq: number;
      idempotencyKey: string;
      peerPrincipalId: string;
      workspaceId: string;
    },
  ): { roomId: string };
};

/**
 * Raft's `resolveChannel` — "Resolve a writable channel, DM, or thread target
 * for the bound agent credential" — and the `**Start a NEW DM**` bullet it
 * backs. The Room is created through the one existing creation path,
 * `openDirectRoom`, so `direct_room_pairs` stays the single place a pair can
 * exist; the derived control-Room cursor and the pair-derived idempotency key
 * are the same server-derived facts a target send already uses.
 */
export function workerDirectRoomOpener(
  database: DatabaseSync,
  collaboration: () => DirectRoomOpenPort,
): WorkerDirectRoomOpener {
  return ({ participantId, handle }) => {
    const peers = database
      .prepare(
        `SELECT DISTINCT peer.principal_id AS peer_principal_id ${AGENT_ADDRESSABLE_PEER}
         AND peer.handle=? LIMIT 2`,
      )
      .all(participantId, participantId, handle);
    if (peers.length !== 1) return;
    // The Workspace is the one whose control Room already holds both of them:
    // openDirectRoom's own membership fence, evaluated here only to name the
    // Workspace the pair belongs to.
    const rows = database
      .prepare(
        `SELECT control_room.workspace_id AS workspace_id,
           control_room.next_seq AS control_next_seq
         FROM rooms control_room
         JOIN memberships peer_control ON peer_control.room_id=control_room.room_id
           AND peer_control.principal_id=?
         JOIN memberships self_control ON self_control.room_id=control_room.room_id
           AND self_control.principal_id=?
         WHERE control_room.kind='control' LIMIT 2`,
      )
      .all(text(peers[0]!, "peer_principal_id"), participantId);
    if (rows.length !== 1) return;
    const peerPrincipalId = text(peers[0]!, "peer_principal_id");
    const actor = principalFromRow(
      database
        .prepare("SELECT * FROM principals WHERE principal_id=?")
        .get(participantId)!,
    );
    collaboration().openDirectRoom(actor, {
      basedOnControlRoomSeq: integer(rows[0]!, "control_next_seq") - 1,
      idempotencyKey: `worker.direct-open:${participantId}:${peerPrincipalId}`,
      peerPrincipalId,
      workspaceId: text(rows[0]!, "workspace_id"),
    });
  };
}

export function resolveWorkerReadTarget(
  database: DatabaseSync,
  origin: WorkerVisibleRoomScope,
  channel?: string,
  openDirect?: WorkerDirectRoomOpener,
): WorkerVisibleRoomScope & { threadId?: string } {
  if (channel === undefined) {
    requireWorkerRoomVisibility(database, origin);
    return { participantId: origin.participantId, roomId: origin.roomId };
  }
  let where: string;
  let values: SQLInputValue[];
  let threadRef: string | undefined;
  let directHandle: string | undefined;
  if (channel.startsWith("#")) {
    const [slug, suffix, ...extra] = channel.slice(1).split(":");
    if (!slug || extra.length || suffix === "")
      throw new NotFoundError("read target is unavailable");
    where = "r.kind='channel' AND r.slug=?";
    values = [slug];
    threadRef = suffix;
  } else if (channel.startsWith("dm:@")) {
    const [handle, suffix, ...extra] = channel.slice(4).split(":");
    if (!handle || extra.length || suffix === "")
      throw new NotFoundError("read target is unavailable");
    where =
      "r.kind='direct' AND peer.handle=? AND (d.left_principal_id=? OR d.right_principal_id=?)";
    values = [handle, origin.participantId, origin.participantId];
    threadRef = suffix;
    directHandle = handle;
  } else {
    where = "r.room_id=?";
    values = [channel];
  }
  const lookup = () =>
    database
      .prepare(
        `${WORKER_VISIBLE_ROOMS} WHERE membership.principal_id=?
    AND r.kind IN ('channel','direct') AND ${where} LIMIT 2`,
      )
      .all(origin.participantId, ...values);
  let rows = lookup();
  // Raft resolves a *writable* DM target: addressing a peer the Agent may write
  // to brings the Direct Room into existence. Only an absent Room is opened; an
  // ambiguous one still refuses, and a peer outside the directory above never
  // reaches this point. A Thread suffix names something that cannot exist in a
  // Room that does not, so it never opens one.
  if (
    rows.length === 0 &&
    directHandle !== undefined &&
    threadRef === undefined &&
    openDirect
  ) {
    openDirect({ handle: directHandle, participantId: origin.participantId });
    rows = lookup();
  }
  if (rows.length !== 1)
    throw new NotFoundError(
      "read target is unavailable or ambiguous among joined Rooms",
    );
  const scope = {
    participantId: origin.participantId,
    roomId: text(rows[0]!, "room_id"),
  };
  requireWorkerRoomVisibility(database, scope);
  if (threadRef === undefined) return scope;
  const threads = database
    .prepare(
      `SELECT thread_id FROM threads WHERE room_id=? AND
    (thread_id=? OR root_message_id=? OR (length(?)>=8 AND (substr(thread_id,1,length(?))=? OR substr(root_message_id,1,length(?))=?))) LIMIT 2`,
    )
    .all(
      scope.roomId,
      threadRef,
      threadRef,
      threadRef,
      threadRef,
      threadRef,
      threadRef,
      threadRef,
    );
  if (threads.length !== 1)
    throw new NotFoundError("Thread is unavailable or ambiguous in this Room");
  return { ...scope, threadId: text(threads[0]!, "thread_id") };
}

export function workerReadThread(
  target: { threadId?: string },
  explicit?: string | null,
) {
  if (
    target.threadId !== undefined &&
    explicit !== undefined &&
    explicit !== target.threadId
  )
    throw new ConflictError("channel Thread conflicts with explicit threadId");
  return target.threadId ?? explicit;
}

export function resolveWorkerMessageRoom(
  database: DatabaseSync,
  origin: WorkerVisibleRoomScope,
  messageId: string,
) {
  const row = database
    .prepare(
      `SELECT m.room_id FROM messages m JOIN memberships membership ON membership.room_id=m.room_id
    JOIN rooms r ON r.room_id=m.room_id WHERE m.message_id=? AND membership.principal_id=? AND r.kind IN ('channel','direct') AND r.system_hidden=0`,
    )
    .get(messageId, origin.participantId);
  if (!row) throw new NotFoundError("message is unavailable in joined Rooms");
  return resolveWorkerReadTarget(database, origin, text(row, "room_id"));
}
