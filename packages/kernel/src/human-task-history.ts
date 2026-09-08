import * as P from "@rah-os/protocol";
import type { AuthenticatedActorContext } from "./auth.ts";
import { requireRoomMember } from "./collaboration-policy.ts";
import { requireDiscoveryHuman } from "./global-discovery.ts";
import type { PersonalStateContext } from "./message-social.ts";
import { requireRoomTaskProjection } from "./task-projection.ts";
import { readTaskHistory } from "./task-history-projection.ts";

export class HumanTaskHistory {
  private readonly context: PersonalStateContext;
  constructor(context: PersonalStateContext) {
    this.context = context;
  }
  list(
    auth: AuthenticatedActorContext,
    raw: P.ClientTaskHistoryRequest,
  ): P.ClientTaskHistoryResponse {
    return this.context.transaction(() => {
      const actorId = this.context.requireActor(auth);
      const input = P.ClientTaskHistoryRequestSchema.parse(raw);
      const database = this.context.database;
      requireDiscoveryHuman(database, actorId);
      requireRoomMember(database, input.roomId, actorId);
      requireRoomTaskProjection(database, input.roomId, input.taskId);
      return readTaskHistory(
        database,
        actorId,
        input.roomId,
        input,
        `human-read-v1:task-history:${input.roomId}`,
      );
    });
  }
}
