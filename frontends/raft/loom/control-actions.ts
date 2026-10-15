import type { IntentOutcome } from "@rah-os/client-core/write-intent";
import type { RuntimeSettings } from "@rah-os/protocol";
import type { ManagementClient } from "./management-client.ts";
export function controlChannel(
  manager: ManagementClient,
  roomId: string,
  action: "stop" | "resume",
  guidance: string,
  done: (result: IntentOutcome<unknown>) => void,
) {
  return manager.writes.submit({
    action: `sos-${action}`,
    session: manager.session(roomId),
    payload: { roomId, guidance: guidance.trim() },
    send: (p, basedOnRoomSeq, idempotencyKey) =>
      action === "stop"
        ? manager.client.request("room.sos.stop", {
            roomId: p.roomId,
            basedOnRoomSeq,
            idempotencyKey,
          })
        : manager.client.request("room.sos.resume", {
            ...p,
            basedOnRoomSeq,
            idempotencyKey,
          }),
    onSettled: done,
  });
}
export function saveConcurrency(
  manager: ManagementClient,
  expectedRevision: number,
  maxConcurrentRuns: number,
  done: (result: IntentOutcome<RuntimeSettings>) => void,
) {
  // This API uses revision CAS, not Room events or idempotency keys. Retrying
  // the exact revision cannot overwrite another save, including our lost reply.
  return manager.writes.submitRevisioned({
    action: "runtime-settings",
    payload: { expectedRevision, maxConcurrentRuns },
    send: (p) => manager.client.request("runtime.settings.update", p),
    onSettled: done,
  });
}

export function abandonInstanceWork(
  manager: ManagementClient,
  instance: { channelId: string; instanceId: string },
  activationId: string,
  done: (result: IntentOutcome<unknown>) => void,
) {
  return manager.writes.submit({
    action: "activation-abandon",
    // Lifecycle mutations are recorded in the home Channel, even for private work.
    session: manager.session(instance.channelId),
    payload: { instanceId: instance.instanceId, activationId },
    send: (payload, basedOnRoomSeq, idempotencyKey) =>
      manager.client.request("instance.activation.abandon", {
        ...payload,
        basedOnRoomSeq,
        idempotencyKey,
      }),
    onSettled: done,
  });
}
