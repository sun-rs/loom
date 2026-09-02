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
