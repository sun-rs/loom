import type { RahClient } from "@rah-os/client-sdk";
import { RoomSession } from "@rah-os/client-core";
import {
  WriteIntentSlot,
  type IntentOutcome,
} from "@rah-os/client-core/write-intent";
import type {
  ClientAgentGetResponse,
  RoleInstantiateResponse,
  SideCreateResponse,
  SideDiscardResponse,
} from "@rah-os/protocol";
export function branchSupported(
  current: ClientAgentGetResponse,
  runtimes: {
    runtimeOfferId?: string;
    available: boolean;
    sessionBranches?: readonly string[];
  }[],
  mode: "fork" | "side",
) {
  if (current.policy.required.allowedOfferIds?.length !== 1) return false;
  const runtime = runtimes.find(
    (r) => r.runtimeOfferId === current.policy.required.allowedOfferIds?.[0],
  );
  return (
    !!runtime?.available &&
    runtime.sessionBranches?.includes(mode) === true &&
    current.agent.currentRevision.executionWorkspace?.kind === "channel_home"
  );
}
/** Transport only. Kernel/Host own identity, native copy, membership and lifecycle. */
export class BranchClient {
  readonly client: RahClient;
  readonly room: RoomSession;
  readonly writes: WriteIntentSlot;
  constructor(
    client: RahClient,
    roomId: string,
    writes = new WriteIntentSlot(),
    room?: RoomSession,
  ) {
    this.client = client;
    this.writes = writes;
    this.room =
      room ??
      new RoomSession({
        client,
        roomId,
        consumerId: `loom-branches-${roomId}`,
      });
  }
  create(
    instanceId: string,
    mode: "fork" | "side",
    onSettled: (
      outcome: IntentOutcome<RoleInstantiateResponse | SideCreateResponse>,
    ) => void,
  ) {
    return this.writes.submit({
      action: mode === "fork" ? "instance-fork" : "side-create",
      session: this.room,
      payload: { instanceId },
      send: (payload, basedOnRoomSeq, idempotencyKey) =>
        this.client.request(mode === "fork" ? "instance.fork" : "side.create", {
          ...payload,
          basedOnRoomSeq,
          idempotencyKey,
        }),
      onSettled,
    });
  }
  discard(
    sideId: string,
    onSettled: (outcome: IntentOutcome<SideDiscardResponse>) => void,
  ) {
    return this.writes.submit({
      action: "side-discard",
      session: this.room,
      payload: { sideId },
      send: (payload, basedOnRoomSeq, idempotencyKey) =>
        this.client.request("side.discard", {
          ...payload,
          basedOnRoomSeq,
          idempotencyKey,
        }),
      onSettled,
    });
  }
}
