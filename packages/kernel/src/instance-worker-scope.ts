import { sideSession } from "./side-session.ts";
import type { DatabaseSync } from "node:sqlite";
import { ForbiddenError } from "./errors.ts";

/** Role instances share one execution lane between channel and private box.
 * Private targets are exposed only while executing that target. Public channel
 * history stays readable under existing membership. Legacy Agents
 * retain their cross-Room addressing policy. No second capability queue. */
export function instanceWorkerRoomPredicate(participant: string, room: string) {
  return `(NOT EXISTS (SELECT 1 FROM role_instances ri WHERE ri.instance_id=${participant})
    OR EXISTS (SELECT 1 FROM rooms public_room WHERE public_room.room_id=${room} AND public_room.kind='channel')
    OR EXISTS (SELECT 1 FROM run_attempts ra WHERE ra.participant_id=${participant}
      AND ra.room_id=${room} AND ra.state IN ('starting','running')))`;
}

export function requireInstanceWorkerRoom(
  database: DatabaseSync,
  participantId: string,
  roomId: string,
) {
  const allowed = database
    .prepare(
      `SELECT 1 WHERE ${instanceWorkerRoomPredicate(":participant", ":room")}`,
    )
    .get({ participant: participantId, room: roomId });
  if (!allowed)
    throw new ForbiddenError(
      "Room is outside this instance execution scope (private box isolation)",
    );
}

export function isRoleInstance(
  database: DatabaseSync,
  participantId: string,
): boolean {
  return (
    database
      .prepare("SELECT 1 FROM role_instances WHERE instance_id=?")
      .get(participantId) !== undefined
  );
}

/**
 * Contract §2: a legacy persona Agent (an Agent definition that is not a Role
 * instance) takes no part in evo scheduling — no Inbox item, no Activation.
 * A bare Agent principal without a definition is not a persona.
 */
export function isLegacyPersonaAgent(
  database: DatabaseSync,
  participantId: string,
): boolean {
  return (
    database
      .prepare(
        `SELECT 1 FROM agent_definitions a WHERE a.participant_id=?
         AND NOT EXISTS (SELECT 1 FROM role_instances i WHERE i.instance_id=a.participant_id)
         LIMIT 1`,
      )
      .get(participantId) !== undefined
  );
}

export function requireInstanceReplyTarget(
  database: DatabaseSync,
  participantId: string,
  originRoomId: string,
  targetRoomId: string,
) {
  if (originRoomId !== targetRoomId && isRoleInstance(database, participantId))
    throw new ForbiddenError(
      "Instance reply must stay in its active execution target",
    );
}

/** New private work requires both peers to remain in the instance's source channel.
 * Historical private messages remain readable to their original Human. */
export function activeInstancePrivateBoxPredicate(room: string) {
  return `NOT EXISTS (
    SELECT 1 FROM rooms r WHERE r.room_id=${room} AND (
      EXISTS (SELECT 1 FROM side_sessions s WHERE s.room_id=r.room_id AND s.discarded_at IS NOT NULL)
      OR (r.kind='direct' AND EXISTS (
        SELECT 1 FROM memberships peer JOIN role_instances i ON i.instance_id=peer.principal_id
        WHERE peer.room_id=r.room_id
          AND EXISTS (SELECT 1 FROM memberships member WHERE member.room_id=r.room_id
            AND NOT EXISTS (SELECT 1 FROM memberships source
              WHERE source.room_id=i.channel_id AND source.principal_id=member.principal_id))
      ))
    )
  )`;
}
/** The Room projection's `instancePrivateBox`: which instance a Direct Room
 * is the private box of, and whether it accepts new private work. */
export function withInstancePrivateBox<
  T extends { kind: string; roomId: string },
>(database: DatabaseSync, room: T): T {
  if (room.kind !== "direct") return room;
  const row = database
    .prepare(
      `SELECT i.instance_id,
         EXISTS (SELECT 1 WHERE ${activeInstancePrivateBoxPredicate("d.room_id")}) AS active
       FROM direct_room_pairs d
       JOIN role_instances i
         ON i.instance_id IN (d.left_principal_id, d.right_principal_id)
       WHERE d.room_id=? LIMIT 1`,
    )
    .get(room.roomId);
  if (row === undefined) return room;
  const side = sideSession(database, String(row.instance_id));
  return {
    ...room,
    ...(side
      ? {
          side: {
            sourceInstanceId: String(side.source_instance_id),
            sourceChannelId: String(side.source_channel_id),
            discarded: side.discarded_at != null,
          },
        }
      : {}),
    instancePrivateBox: {
      instanceId: String(row.instance_id),
      active: Number(row.active) === 1,
    },
  };
}

export function requireActiveInstancePrivateBox(
  database: DatabaseSync,
  roomId: string,
) {
  if (
    !database
      .prepare(`SELECT 1 WHERE ${activeInstancePrivateBoxPredicate("?")}`)
      .get(roomId)
  )
    throw new ForbiddenError(
      "Instance private box is inactive: source channel membership removed",
    );
}

/**
 * The single admission check of every generic membership entry for a Role
 * instance: it may only be re-confirmed in its own channel while it is still
 * a member there. A removed instance never rejoins under its old ID, which
 * would revive its old principal, session binding and private box; re-adding
 * the Role is `roles.instantiate`, which creates a new instance.
 */
export function requireRoleInstanceMembershipEntry(
  database: DatabaseSync,
  principalId: string,
  roomId: string,
): void {
  const instance = database
    .prepare("SELECT channel_id FROM role_instances WHERE instance_id=?")
    .get(principalId);
  if (instance === undefined) return;
  if (instance.channel_id !== roomId)
    throw new ForbiddenError("Role instance cannot join another channel");
  if (
    !database
      .prepare("SELECT 1 FROM memberships WHERE room_id=? AND principal_id=?")
      .get(roomId, principalId)
  )
    throw new ForbiddenError(
      "removed Role instance cannot rejoin; instantiate the Role again to add a new instance",
    );
}
