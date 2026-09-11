import type { DatabaseSync } from "node:sqlite";
import type { SyncResult, WorkerSyncResult } from "./types.ts";
import type { WorkerVisibleRoomScope } from "./worker-read-targets.ts";
import { workerAddressing } from "./worker-addressing.ts";
import { collectWorkerPresentedContext } from "./worker-presented-context.ts";
import { annotateTaskAnchoredEvents } from "./task-anchor-annotation.ts";

/** Read-only projections; the delivered range and ACK fence stay unchanged. */
export function presentWorkerSync(
  database: DatabaseSync,
  scope: WorkerVisibleRoomScope,
  delivery: SyncResult,
): WorkerSyncResult {
  const presentedContext = collectWorkerPresentedContext(database, {
    events: delivery.events,
    participantId: scope.participantId,
    roomId: scope.roomId,
  });
  return {
    ...delivery,
    addressing: workerAddressing(database, scope, delivery.events),
    events: annotateTaskAnchoredEvents(database, delivery.events),
    ...(presentedContext === undefined ? {} : { presentedContext }),
  };
}
