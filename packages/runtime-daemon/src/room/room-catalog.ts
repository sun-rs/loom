import type { DatabaseSync } from "node:sqlite";

import type {
  RoomMembership,
  RoomPrincipal,
  RoomRecord,
} from "@rah/runtime-protocol";

import { roomError } from "./room-errors";
import {
  integer,
  optionalText,
  roomFromRow,
  text,
  type RoomSqlRow as Row,
} from "./room-rows";

export interface RoomCatalogLedgerItem {
  catalogSeq: number;
  room: RoomRecord;
  membership: RoomMembership;
  latestRoomSeq: number;
  participantCount: number;
  pendingAttentionCount: number;
  directPeer?: RoomPrincipal;
}

export interface RoomCatalogLedgerPage {
  items: RoomCatalogLedgerItem[];
  throughCatalogSeq: number;
  cursorBefore: number;
  hasMore: boolean;
}

export interface RoomCatalogReadOptions {
  beforeCatalogSeq?: number;
  throughCatalogSeq?: number;
  limit?: number;
}

function requireWindow(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw roomError("invalid_argument", `${name} must be a non-negative safe integer`);
  }
}

/** Stable membership-catalog projection. Caller owns authorization and read transaction. */
export function readRoomCatalog(
  database: DatabaseSync,
  actorId: string,
  options: RoomCatalogReadOptions,
  maximumLimit: number,
): RoomCatalogLedgerPage {
  const limit = options.limit ?? maximumLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumLimit) {
    throw roomError("invalid_argument", `list limit must be between 1 and ${maximumLimit}`);
  }
  if (options.throughCatalogSeq !== undefined) {
    requireWindow(options.throughCatalogSeq, "throughCatalogSeq");
  }
  if (options.beforeCatalogSeq !== undefined) {
    requireWindow(options.beforeCatalogSeq, "beforeCatalogSeq");
    if (options.beforeCatalogSeq < 1) {
      throw roomError("invalid_argument", "beforeCatalogSeq must be positive");
    }
  }

  const headRow = database.prepare(
    `SELECT COALESCE(MAX(catalog_seq), 0) AS catalog_head
     FROM room_catalog_memberships
     WHERE principal_id = ?`,
  ).get(actorId) as Row;
  const catalogHead = integer(headRow, "catalog_head");
  const throughCatalogSeq = options.throughCatalogSeq ?? catalogHead;
  if (throughCatalogSeq > catalogHead) {
    throw roomError(
      "invalid_argument",
      "throughCatalogSeq cannot exceed the principal Room catalog head",
    );
  }
  const beforeCatalogSeq = options.beforeCatalogSeq ?? throughCatalogSeq + 1;
  if (beforeCatalogSeq > throughCatalogSeq + 1) {
    throw roomError(
      "invalid_argument",
      "beforeCatalogSeq must be within the frozen Room catalog window",
    );
  }
  const rows = database.prepare(
    `SELECT
       catalog.catalog_seq,
       room.*,
       membership.role AS membership_role,
       membership.joined_at AS membership_joined_at,
       (room.next_seq - 1) AS latest_room_seq,
       (SELECT COUNT(*) FROM room_memberships count_membership
         WHERE count_membership.room_id = room.room_id) AS participant_count,
       (SELECT COUNT(*) FROM room_inbox_items inbox
         WHERE inbox.room_id = room.room_id
           AND inbox.participant_id = ?
           AND inbox.state = 'pending') AS pending_attention_count,
       peer.principal_id AS peer_principal_id,
       peer.handle AS peer_handle,
       peer.kind AS peer_kind,
       peer.display_name AS peer_display_name,
       peer.created_at AS peer_created_at
     FROM room_catalog_memberships AS catalog
     JOIN rooms AS room ON room.room_id = catalog.room_id
     JOIN room_memberships AS membership
       ON membership.room_id = catalog.room_id
      AND membership.principal_id = catalog.principal_id
     LEFT JOIN room_memberships AS peer_membership
       ON room.kind = 'direct'
      AND peer_membership.room_id = room.room_id
      AND peer_membership.principal_id <> catalog.principal_id
     LEFT JOIN room_principals AS peer
       ON peer.principal_id = peer_membership.principal_id
     WHERE catalog.principal_id = ?
       AND catalog.catalog_seq <= ?
       AND catalog.catalog_seq < ?
     ORDER BY catalog.catalog_seq DESC
     LIMIT ?`,
  ).all(actorId, actorId, throughCatalogSeq, beforeCatalogSeq, limit + 1) as Row[];
  const hasMore = rows.length > limit;
  const accepted = hasMore ? rows.slice(0, limit) : rows;
  const items = accepted.map((row): RoomCatalogLedgerItem => {
    const peerPrincipalId = optionalText(row, "peer_principal_id");
    const peerDisplayName = optionalText(row, "peer_display_name");
    const directPeer = peerPrincipalId
      ? {
          principalId: peerPrincipalId,
          handle: text(row, "peer_handle"),
          kind: text(row, "peer_kind") as RoomPrincipal["kind"],
          ...(peerDisplayName ? { displayName: peerDisplayName } : {}),
          createdAt: text(row, "peer_created_at"),
        }
      : undefined;
    return {
      catalogSeq: integer(row, "catalog_seq"),
      room: roomFromRow(row),
      membership: {
        roomId: text(row, "room_id"),
        principalId: actorId,
        role: text(row, "membership_role") as RoomMembership["role"],
        joinedAt: text(row, "membership_joined_at"),
      },
      latestRoomSeq: integer(row, "latest_room_seq"),
      participantCount: integer(row, "participant_count"),
      pendingAttentionCount: integer(row, "pending_attention_count"),
      ...(directPeer ? { directPeer } : {}),
    };
  });
  return {
    items,
    throughCatalogSeq,
    cursorBefore: items.at(-1)?.catalogSeq ?? beforeCatalogSeq,
    hasMore,
  };
}
