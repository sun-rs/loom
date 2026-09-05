import * as P from "@rah-os/protocol";
import type { AuthenticatedActorContext } from "./auth.ts";
import { requireRoomMember, roomRole } from "./collaboration-policy.ts";
import { ForbiddenError } from "./errors.ts";
import { requireDiscoveryHuman } from "./global-discovery.ts";
import type { PersonalStateContext } from "./message-social.ts";
import { text } from "./sqlite-row.ts";
import { fromRow as principalFromRow } from "./principal-profile.ts";
import { listCreatedAgentDefinitionIds } from "./workspace-agent-management.ts";

export class HumanProfiles {
  private readonly context: PersonalStateContext;
  constructor(context: PersonalStateContext) {
    this.context = context;
  }

  get(
    auth: AuthenticatedActorContext,
    request: P.HumanProfileRequest,
  ): P.HumanProfileResponse {
    const actorId = this.context.requireActor(auth);
    const input = P.HumanProfileRequestSchema.parse(request);
    const db = this.context.database;
    requireDiscoveryHuman(db, actorId);
    return this.context.transaction(() => {
      const workspace = db
        .prepare(
          "SELECT room_id AS control_room_id FROM rooms WHERE workspace_id=? AND kind='control' AND archived_at IS NULL",
        )
        .get(input.workspaceId);
      if (!workspace) throw new ForbiddenError("Human profile is unavailable");
      const controlRoomId = text(workspace, "control_room_id");
      requireRoomMember(db, controlRoomId, actorId);
      const row = db
        .prepare(
          `SELECT p.*, m.role, m.joined_at FROM principals p
        JOIN memberships m ON m.principal_id=p.principal_id AND m.room_id=?
        WHERE p.principal_id=? AND p.kind='human'`,
        )
        .get(controlRoomId, input.principalId);
      if (!row) throw new ForbiddenError("Human profile is unavailable");
      const role = roomRole(db, controlRoomId, actorId);
      // Match Agent catalog authority; ordinary members may read a public Human
      // identity, but not enumerate the managed catalog through creation edges.
      const canReadCreatedAgents = role === "owner" || role === "admin";
      const ids = canReadCreatedAgents
        ? listCreatedAgentDefinitionIds(
            db,
            controlRoomId,
            input.principalId,
            501,
          )
        : [];
      return P.HumanProfileResponseSchema.parse({
        workspaceId: input.workspaceId,
        principal: principalFromRow(row),
        membership: {
          role: text(row, "role"),
          joinedAt: text(row, "joined_at"),
        },
        canReadCreatedAgents,
        createdAgentDefinitionIds: ids.slice(0, 500),
        truncated: ids.length > 500,
      });
    });
  }
}
