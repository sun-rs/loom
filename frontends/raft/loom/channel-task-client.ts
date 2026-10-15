import type { IntentOutcome } from "@rah-os/client-core/write-intent";
import type { ClientTaskAttentionMutationResponse } from "@rah-os/protocol";
import type { LoomChannelClient } from "./channel-client.ts";
/** Shares the channel's sole Human write slot and causal RoomSession. */
export class ChannelTaskClient {
  readonly channel: LoomChannelClient;
  constructor(channel: LoomChannelClient) {
    this.channel = channel;
  }
  private assertChannel() {
    if (this.channel.room.state.snapshot?.room.kind !== "channel")
      throw Error("任务入口仅适用于频道");
  }
  create(
    title: string,
    onSettled?: (
      outcome: IntentOutcome<ClientTaskAttentionMutationResponse>,
    ) => void,
  ) {
    this.assertChannel();
    return this.channel.writes.submit({
      action: "task-create",
      session: this.channel.room,
      payload: { roomId: this.channel.roomId, title },
      onSettled,
      send: (p, basedOnRoomSeq, idempotencyKey) =>
        this.channel.client.request("task.create", {
          ...p,
          dependencyTaskIds: [],
          basedOnRoomSeq,
          idempotencyKey,
        }),
    });
  }
  convert(
    messageId: string,
    onSettled?: (
      outcome: IntentOutcome<ClientTaskAttentionMutationResponse>,
    ) => void,
  ) {
    this.assertChannel();
    return this.channel.writes.submit({
      action: "task-create",
      session: this.channel.room,
      payload: { roomId: this.channel.roomId, messageId },
      onSettled,
      send: (p, basedOnRoomSeq, idempotencyKey) =>
        this.channel.client.request("task.convert", {
          ...p,
          dependencyTaskIds: [],
          basedOnRoomSeq,
          idempotencyKey,
        }),
    });
  }
}
