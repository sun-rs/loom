import type { DatabaseSync } from "node:sqlite";
import type { ActivationCredentialScope } from "@rah-os/protocol";
import type { RoomSyncInput } from "./room-sync.ts";
import type { SyncResult, WorkerSyncResult } from "./types.ts";
import {
  conversationDelivery,
  conversationFloor,
  conversationPredicate,
} from "./conversation-delivery.ts";
import { workerDeliveryReplayStart } from "./worker-delivery-window.ts";
import { presentWorkerSync } from "./worker-sync-presentation.ts";

export type AutomaticWorkerSyncInput = {
  afterSeq?: number;
  limit?: number;
  replayDelivery?: boolean;
  automatic?: boolean;
};
/** Called inside the authenticated Kernel transaction; select before paging/budgeting. */
export function syncAutomaticWorker(
  db: DatabaseSync,
  scope: ActivationCredentialScope,
  input: AutomaticWorkerSyncInput,
  sync: (
    input: RoomSyncInput,
    predicate?: { sql: string; params: string[] },
  ) => SyncResult,
): WorkerSyncResult {
  const policy = input.automatic ? conversationDelivery(db, scope) : undefined;
  const replayStart = input.replayDelivery
    ? conversationFloor(policy, workerDeliveryReplayStart(db, scope) + 1) - 1
    : undefined;
  const delivery = sync(
    {
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(replayStart === undefined
        ? input.afterSeq === undefined
          ? {}
          : { afterSeq: input.afterSeq }
        : { afterSeq: replayStart }),
      consumerId: scope.consumerId,
      roomId: scope.roomId,
      throughSeq: scope.toSeq,
    },
    policy ? conversationPredicate(policy) : undefined,
  );
  return presentWorkerSync(db, scope, delivery);
}
