import type { RoomSession } from "@rah-os/client-core";
import {
  WriteIntentSlot,
  type IntentOutcome,
} from "@rah-os/client-core/write-intent";
import type { RahClient } from "@rah-os/client-sdk";
import type { RoleInstantiateResponse } from "@rah-os/protocol";

/** Existing Role/Channel mutation; the caller supplies the channel's sole RoomSession. */
export class LoomInstanceClient {
  readonly writes = new WriteIntentSlot();
  readonly room: RoomSession;
  readonly client: RahClient;
  constructor(client: RahClient, room: RoomSession) {
    this.client = client;
    this.room = room;
  }
  add(
    roleId: string,
    onSettled?: (outcome: IntentOutcome<RoleInstantiateResponse>) => void,
  ) {
    return this.writes.submit({
      action: "instantiate",
      payload: { roleId, channelId: this.room.state.roomId },
      session: this.room,
      ...(onSettled ? { onSettled } : {}),
      send: (payload, basedOnRoomSeq, idempotencyKey) =>
        this.client.request("role.instantiate", {
          ...payload,
          basedOnRoomSeq,
          idempotencyKey,
        }),
    });
  }
}
