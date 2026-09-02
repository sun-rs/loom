import * as P from "@rah-os/protocol";
import type { AuthenticatedActorContext } from "./auth.ts";
import { requireRoomMember } from "./collaboration-policy.ts";
import {
  requireDiscoveryHuman,
  discoveryVisibleRooms,
} from "./global-discovery.ts";
import { ConflictError, ForbiddenError } from "./errors.ts";
import {
  personalCommandReplay,
  type PersonalStateContext,
} from "./message-social.ts";

/** Raft sidebar-order typed identities + version-fenced personal preferences. */
export class HumanSidebar {
  private readonly context: PersonalStateContext;
  constructor(context: PersonalStateContext) {
    this.context = context;
  }
  private scope(auth: AuthenticatedActorContext, workspaceId: string) {
    const db = this.context.database,
      id = this.context.requireActor(auth);
    requireDiscoveryHuman(db, id);
    const row = db
      .prepare(
        "SELECT r.room_id AS control_room_id FROM workspaces w JOIN rooms r ON r.workspace_id=w.workspace_id AND r.kind='control' WHERE w.workspace_id=? AND w.state='active'",
      )
      .get(workspaceId);
    if (!row) throw new ForbiddenError("workspace unavailable");
    requireRoomMember(db, String(row.control_room_id), id);
    return { actorId: id, controlRoomId: String(row.control_room_id) };
  }
  private visible(actorId: string, workspaceId: string, controlRoomId: string) {
    const db = this.context.database;
    const rooms = db
      .prepare(
        `SELECT r.room_id,r.kind,(SELECT MAX(created_at) FROM messages m WHERE m.room_id=r.room_id) AS recent FROM rooms r WHERE ${discoveryVisibleRooms}`,
      )
      .all(workspaceId, actorId);
    const keys = new Set<string>(),
      recent: Record<string, string> = {};
    for (const r of rooms) {
      if (r.kind !== "direct") {
        const key = `room:${r.room_id}`;
        keys.add(key);
        if (r.recent) recent[key] = String(r.recent);
      } else
        for (const peer of db
          .prepare(
            "SELECT principal_id FROM memberships WHERE room_id=? AND principal_id<>?",
          )
          .all(String(r.room_id), actorId)) {
          const key = `peer:${peer.principal_id}`;
          keys.add(key);
          if (r.recent) recent[key] = String(r.recent);
        }
    }
    for (const p of db
      .prepare(
        "SELECT principal_id FROM memberships WHERE room_id=? AND principal_id<>? UNION SELECT participant_id AS principal_id FROM agent_definitions WHERE control_room_id=? AND state<>'tombstoned'",
      )
      .all(controlRoomId, actorId, controlRoomId))
      keys.add(`peer:${p.principal_id}`);
    return { keys, recent };
  }
  get(auth: AuthenticatedActorContext, request: { workspaceId: string }) {
    const input = P.SidebarGetRequestSchema.parse(request),
      { actorId, controlRoomId } = this.scope(auth, input.workspaceId),
      db = this.context.database;
    const row = db
      .prepare(
        "SELECT preferences_json FROM human_sidebar_preferences WHERE principal_id=? AND workspace_id=?",
      )
      .get(actorId, input.workspaceId);
    const preferences = P.SidebarPreferencesSchema.parse(
      row
        ? JSON.parse(String(row.preferences_json))
        : P.DEFAULT_SIDEBAR_PREFERENCES,
    );
    const { keys, recent } = this.visible(
      actorId,
      input.workspaceId,
      controlRoomId,
    );
    for (const field of [
      "pinned",
      "channelOrder",
      "dmOrder",
      "mutedActivity",
      "notifyAllMessages",
      "expandedLongMessages",
    ] as const)
      preferences[field] = preferences[field].filter((key) => keys.has(key));
    return { preferences, recent };
  }
  patch(auth: AuthenticatedActorContext, request: P.SidebarPatchRequest) {
    const input = P.SidebarPatchRequestSchema.parse(request),
      { actorId, controlRoomId } = this.scope(auth, input.workspaceId),
      db = this.context.database;
    return this.context.transaction(() => {
      if (
        personalCommandReplay(
          db,
          actorId,
          "sidebar",
          input.idempotencyKey,
          input,
        )
      )
        return this.get(auth, { workspaceId: input.workspaceId });
      const current = this.get(auth, { workspaceId: input.workspaceId });
      if (current.preferences.version !== input.expectedVersion)
        throw new ConflictError(
          "sidebar version conflict; reload before retrying",
        );
      const { keys } = this.visible(actorId, input.workspaceId, controlRoomId);
      for (const field of [
        "pinned",
        "channelOrder",
        "dmOrder",
        "mutedActivity",
        "notifyAllMessages",
        "expandedLongMessages",
      ] as const)
        for (const key of input.patch[field] ?? []) {
          if (
            !keys.has(key) ||
            (field === "channelOrder" && !key.startsWith("room:")) ||
            (field === "dmOrder" && !key.startsWith("peer:")) ||
            ((field === "mutedActivity" ||
              field === "notifyAllMessages" ||
              field === "expandedLongMessages") &&
              !key.startsWith("room:"))
          )
            throw new ForbiddenError(
              "sidebar target is unavailable or inaccessible in this section",
            );
        }
      const preferences = {
        ...current.preferences,
        ...input.patch,
        version: current.preferences.version + 1,
      };
      db.prepare(
        "INSERT INTO human_sidebar_preferences VALUES(?,?,?) ON CONFLICT(principal_id,workspace_id) DO UPDATE SET preferences_json=excluded.preferences_json",
      ).run(actorId, input.workspaceId, JSON.stringify(preferences));
      return { ...current, preferences };
    });
  }
}
