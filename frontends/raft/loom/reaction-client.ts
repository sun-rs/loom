import type { LoomChannelClient } from "./channel-client.ts";
import type { IntentOutcome } from "@rah-os/client-core/write-intent";
export type ReactionBridge = Pick<
  LoomChannelClient,
  "client" | "roomId" | "room" | "writes"
>;
export type SocialItem = Awaited<ReturnType<ReactionClient["read"]>>[number];
export class ReactionClient {
  readonly bridge: ReactionBridge;
  constructor(bridge: ReactionBridge) {
    this.bridge = bridge;
  }
  async read(ids: string[], signal?: AbortSignal) {
    const items = [];
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 100) {
      const result = await this.bridge.client.request(
        "message.social",
        { roomId: this.bridge.roomId, messageIds: unique.slice(i, i + 100) },
        { signal },
      );
      items.push(...result.items);
    }
    return items;
  }
  save(
    messageId: string,
    saved: boolean,
    onSettled: (outcome: IntentOutcome<SocialItem>) => void,
  ) {
    return this.bridge.writes.submitRevisioned({
      action: "message-save",
      payload: { roomId: this.bridge.roomId, messageId, saved },
      send: (payload, idempotencyKey) =>
        this.bridge.client.request("message.save", {
          ...payload,
          idempotencyKey,
        }),
      onSettled,
    });
  }
  set(
    messageId: string,
    emoji: string,
    active: boolean,
    onSettled: (outcome: IntentOutcome<SocialItem>) => void,
  ) {
    return this.bridge.writes.submit({
      action: "message-reaction",
      session: this.bridge.room,
      payload: { roomId: this.bridge.roomId, messageId, emoji, active },
      send: (payload, basedOnRoomSeq, idempotencyKey) =>
        this.bridge.client.request("message.react", {
          ...payload,
          basedOnRoomSeq,
          idempotencyKey,
        }),
      onSettled,
    });
  }
}
/** Match the existing conversation composer read-only boundary. */
export function reactionRoomWritable(
  room: import("@rah-os/protocol").Room | null | undefined,
) {
  return (
    !!room &&
    !room.archivedAt &&
    (!room.instancePrivateBox || room.instancePrivateBox.active === true)
  );
}
