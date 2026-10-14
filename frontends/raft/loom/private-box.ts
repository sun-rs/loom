import { RoomSession } from "@rah-os/client-core";
import {
  WriteIntentSlot,
  type IntentOutcome,
} from "@rah-os/client-core/write-intent";
import type { RahClient } from "@rah-os/client-sdk";
import type { ClientDirectRoomOpenResponse } from "@rah-os/protocol";

/** The same authenticated direct-open and intent owner used by the console. */
export class LoomPrivateBoxClient {
  readonly writes = new WriteIntentSlot();
  readonly control: RoomSession;
  readonly client: RahClient;
  readonly workspaceId: string;
  constructor(
    client: RahClient,
    workspaceId: string,
    controlRoomId: string,
    consumerId: string,
  ) {
    this.client = client;
    this.workspaceId = workspaceId;
    this.control = new RoomSession({
      client,
      roomId: controlRoomId,
      consumerId,
    });
  }
  open(
    peerPrincipalId: string,
    onSettled?: (outcome: IntentOutcome<ClientDirectRoomOpenResponse>) => void,
  ) {
    return this.writes.submit({
      action: "direct-open",
      payload: { peerPrincipalId, workspaceId: this.workspaceId },
      session: this.control,
      ...(onSettled ? { onSettled } : {}),
      send: (payload, basedOnControlRoomSeq, idempotencyKey) =>
        this.client.request("room.direct.open", {
          ...payload,
          basedOnControlRoomSeq,
          idempotencyKey,
        }),
    });
  }
}
