import type { DatabaseSync } from "node:sqlite";
import type { SyncResult, WorkerSyncResult } from "./types.ts";
import type { ActivationCredentialScope } from "@rah-os/protocol";
import { readPresentedWindow } from "./activation-presented-window.ts";
import { workerAddressing } from "./worker-addressing.ts";
import { collectWorkerPresentedContext } from "./worker-presented-context.ts";
import { annotateTaskAnchoredEvents } from "./task-anchor-annotation.ts";
import { hideUnreadableMemoryEvents } from "./worker-message-projection.ts";

/** Read-only projections; the delivered range and ACK fence stay unchanged. */
export function presentWorkerSync(
  database: DatabaseSync,
  scope: ActivationCredentialScope,
  delivery: SyncResult,
): WorkerSyncResult {
  const events = hideUnreadableMemoryEvents(
    database,
    scope.participantId,
    delivery.events,
  );
  const presentedContext = collectWorkerPresentedContext(database, {
    events,
    participantId: scope.participantId,
    roomId: scope.roomId,
  });
  // Exact current-Run receipt, never a participant high-water mark or ACK.
  const wake = readPresentedWindow(database, scope);
  const deliveredInWakeSeqs =
    wake?.sentAt === undefined
      ? []
      : events
          .filter(
            (event) =>
              event.type === "message.posted" &&
              wake.presentedSeqs.includes(event.roomSeq),
          )
          .map((event) => event.roomSeq);
  return {
    ...delivery,
    ...(deliveredInWakeSeqs.length ? { deliveredInWakeSeqs } : {}),
    addressing: workerAddressing(database, scope, events),
    events: annotateTaskAnchoredEvents(database, events),
    ...(presentedContext === undefined ? {} : { presentedContext }),
  };
}
