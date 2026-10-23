import * as P from "@rah-os/protocol";

import type { AuthenticatedActorContext } from "./auth.ts";
import { requireRoomMember } from "./collaboration-policy.ts";
import { ForbiddenError } from "./errors.ts";
import { requireDiscoveryHuman } from "./global-discovery.ts";
import {
  initializePersonalState,
  personalCommandReplay,
  type PersonalStateContext,
} from "./message-social.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import { RoomWebPushProjection } from "./room-web-push.ts";
import { text } from "./sqlite-row.ts";

const MAX_DISMISSALS = 100;

/** Raft-compatible explicit, per-Human notification dismissal preferences. */
export class HumanNotifications {
  readonly #context: PersonalStateContext;
  readonly webPush: RoomWebPushProjection;

  constructor(context: PersonalStateContext & { events: RoomEventWriter }) {
    this.#context = context;
    this.webPush = new RoomWebPushProjection(context);
  }

  initialize(): void {
    initializePersonalState(this.#context.database);
  }

  local(
    auth: AuthenticatedActorContext,
    request: P.ClientLocalNotificationRequest,
  ) {
    const input = P.ClientLocalNotificationRequestSchema.parse(request);
    const actorId = this.#scope(auth, input.workspaceId);
    const db = this.#context.database;
    const head = Number(
      db.prepare("SELECT COALESCE(MAX(rowid),0) AS n FROM room_events").get()!
        .n,
    );
    if (input.after === undefined || input.after > head)
      return { cursor: head, hasMore: false, notifications: [] };
    const rows = db
      .prepare(
        `SELECT e.rowid AS position,e.room_id,e.room_seq,e.created_at FROM room_events e
      JOIN rooms r ON r.room_id=e.room_id
      JOIN memberships m ON m.room_id=r.room_id AND m.principal_id=?
      WHERE r.workspace_id=? AND e.rowid>? ORDER BY e.rowid LIMIT 100`,
      )
      .all(actorId, input.workspaceId, input.after);
    const cutoff = this.#context.now().getTime() - 15 * 60_000;
    const notifications = rows.flatMap((row) =>
      Date.parse(String(row.created_at)) < cutoff
        ? []
        : this.webPush
            .project({
              roomId: String(row.room_id),
              roomSeq: Number(row.room_seq),
            })
            .filter((candidate) => candidate.principalId === actorId)
            .map((candidate) => candidate.payload),
    );
    return P.ClientLocalNotificationResponseSchema.parse({
      cursor: rows.length === 100 ? Number(rows.at(-1)!.position) : head,
      hasMore: rows.length === 100,
      notifications,
    });
  }

  listDismissals(
    auth: AuthenticatedActorContext,
    request: P.ClientNotificationListRequest,
  ): P.NotificationDismissalList {
    const input = P.ClientNotificationListRequestSchema.parse(request);
    const actorId = this.#scope(auth, input.workspaceId);
    return P.NotificationDismissalListSchema.parse({
      notificationIds: this.#context.database
        .prepare(
          "SELECT notification_id FROM human_notification_dismissals WHERE principal_id=? AND workspace_id=? ORDER BY dismiss_order",
        )
        .all(actorId, input.workspaceId)
        .map((row) => text(row, "notification_id")),
    });
  }

  dismiss(
    auth: AuthenticatedActorContext,
    request: P.ClientNotificationDismissRequest,
  ): P.NotificationDismissalList {
    const input = P.ClientNotificationDismissRequestSchema.parse(request);
    const actorId = this.#scope(auth, input.workspaceId);
    const db = this.#context.database;
    return this.#context.transaction(() => {
      if (
        !personalCommandReplay(
          db,
          actorId,
          "notification-dismissal",
          input.idempotencyKey,
          input,
        )
      ) {
        db.prepare(
          "INSERT OR IGNORE INTO human_notification_dismissals(principal_id,workspace_id,notification_id,dismissed_at) VALUES(?,?,?,?)",
        ).run(
          actorId,
          input.workspaceId,
          input.notificationId,
          this.#context.now().toISOString(),
        );
        db.prepare(
          `DELETE FROM human_notification_dismissals
           WHERE principal_id=? AND workspace_id=? AND dismiss_order NOT IN (
             SELECT dismiss_order FROM human_notification_dismissals
             WHERE principal_id=? AND workspace_id=?
             ORDER BY dismiss_order DESC LIMIT ?
           )`,
        ).run(
          actorId,
          input.workspaceId,
          actorId,
          input.workspaceId,
          MAX_DISMISSALS,
        );
      }
      return this.listDismissals(auth, { workspaceId: input.workspaceId });
    });
  }

  #scope(auth: AuthenticatedActorContext, workspaceId: string): string {
    const actorId = this.#context.requireActor(auth);
    requireDiscoveryHuman(this.#context.database, actorId);
    const row = this.#context.database
      .prepare(
        "SELECT r.room_id FROM workspaces w JOIN rooms r ON r.workspace_id=w.workspace_id AND r.kind='control' WHERE w.workspace_id=? AND w.state='active'",
      )
      .get(workspaceId);
    if (!row) throw new ForbiddenError("workspace unavailable");
    requireRoomMember(this.#context.database, text(row, "room_id"), actorId);
    return actorId;
  }
}
