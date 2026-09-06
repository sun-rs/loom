import type { DatabaseSync } from "node:sqlite";

import type {
  RoomEvent,
  RoomMessage,
  RoomSnapshot,
} from "@rah/runtime-protocol";

import { roomError } from "./room-errors";
import {
  eventFromRow,
  membershipFromRow,
  messageFromRow,
  principalFromRow,
  roomFromRow,
  type RoomSqlRow as Row,
} from "./room-rows";

const RESPONSE_BYTE_LIMIT = 1_048_576;

export class RoomMessageReadService {
  constructor(private readonly database: DatabaseSync) {}

  snapshot(roomId: string): RoomSnapshot {
    const roomRow = this.database
      .prepare("SELECT * FROM rooms WHERE room_id = ?")
      .get(roomId) as Row | undefined;
    if (!roomRow) throw roomError("not_found", `Room ${roomId} was not found`);
    const memberships = (
      this.database
        .prepare(
          "SELECT * FROM room_memberships WHERE room_id = ? ORDER BY joined_at, principal_id",
        )
        .all(roomId) as Row[]
    ).map(membershipFromRow);
    const principals = (
      this.database
        .prepare(
          "SELECT p.* FROM room_principals p JOIN room_memberships m ON m.principal_id = p.principal_id WHERE m.room_id = ? ORDER BY m.joined_at, p.principal_id",
        )
        .all(roomId) as Row[]
    ).map(principalFromRow);
    return { room: roomFromRow(roomRow), memberships, principals };
  }

  eventWindow(input: {
    roomId: string;
    afterSeq: number;
    throughSeq: number;
    limit: number;
  }): RoomEvent[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM (
           SELECT candidate.*,
             SUM(length(CAST(candidate.payload_json AS BLOB)) + 1024)
               OVER (ORDER BY candidate.room_seq) AS cumulative_bytes
           FROM (
             SELECT * FROM room_events
             WHERE room_id = ? AND room_seq > ? AND room_seq <= ?
             ORDER BY room_seq LIMIT ?
           ) AS candidate
         ) WHERE cumulative_bytes <= ? ORDER BY room_seq`,
        )
        .all(
          input.roomId,
          input.afterSeq,
          input.throughSeq,
          input.limit,
          RESPONSE_BYTE_LIMIT,
        ) as Row[]
    ).map(eventFromRow);
  }

  recentMessages(
    roomId: string,
    throughSeq: number,
    limit: number,
  ): RoomMessage[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM (
           SELECT candidate.*,
             SUM(length(CAST(json_quote(candidate.body) AS BLOB)) + 512)
               OVER (ORDER BY candidate.room_seq DESC) AS cumulative_bytes
           FROM (
             SELECT * FROM room_messages
             WHERE room_id = ? AND room_seq <= ?
             ORDER BY room_seq DESC LIMIT ?
           ) AS candidate
         ) WHERE cumulative_bytes <= ? ORDER BY room_seq DESC`,
        )
        .all(roomId, throughSeq, limit, RESPONSE_BYTE_LIMIT) as Row[]
    ).map(messageFromRow);
  }

  messagePage(
    roomId: string,
    anchor: number,
    throughRoomSeq: number,
    limit: number,
    backward: boolean,
  ): RoomMessage[] {
    const comparison = backward ? "<" : ">";
    const direction = backward ? "DESC" : "ASC";
    const rows = this.database
      .prepare(
        `SELECT * FROM (
         SELECT candidate.*,
           SUM(length(CAST(json_quote(candidate.body) AS BLOB)) + 512)
             OVER (ORDER BY candidate.room_seq ${direction}) AS cumulative_bytes
         FROM (
           SELECT * FROM room_messages
           WHERE room_id = ? AND room_seq ${comparison} ? AND room_seq <= ?
           ORDER BY room_seq ${direction} LIMIT ?
         ) AS candidate
       ) WHERE cumulative_bytes <= ? ORDER BY room_seq ${direction}`,
      )
      .all(roomId, anchor, throughRoomSeq, limit, RESPONSE_BYTE_LIMIT) as Row[];
    if (backward) rows.reverse();
    return rows.map(messageFromRow);
  }

  hasMoreMessages(
    roomId: string,
    cursor: number,
    throughRoomSeq: number,
    backward: boolean,
  ): boolean {
    const comparison = backward ? "<" : ">";
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM room_messages
           WHERE room_id = ? AND room_seq ${comparison} ? AND room_seq <= ? LIMIT 1`,
        )
        .get(roomId, cursor, throughRoomSeq),
    );
  }
}

export function withRoomResponseBytes<T extends { responseBytes: number }>(
  input: T,
): T {
  let result = { ...input, responseBytes: 0 };
  for (let pass = 0; pass < 8; pass += 1) {
    const responseBytes = Buffer.byteLength(JSON.stringify(result));
    if (responseBytes === result.responseBytes) return result;
    result = { ...result, responseBytes };
  }
  return result;
}
