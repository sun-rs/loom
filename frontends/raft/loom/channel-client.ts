import { MessageSession, RoomSession } from "@rah-os/client-core";
import {
  WriteIntentSlot,
  type IntentOutcome,
} from "@rah-os/client-core/write-intent";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  Message,
  Principal,
  Room,
  ClientMessageMutationResponse,
} from "@rah-os/protocol";
import type { Message as OfficialMessage } from "../packages/web/src/store/messageStore.ts";

/** Presentation mapping only. Stable IDs and canonical sequence stay owned by Loom. */
export function toOfficialMessage(
  message: Message,
  members: readonly Principal[],
): OfficialMessage {
  const author = members.find(
    (member) => member.principalId === message.actorId,
  );
  const name = author?.displayName ?? author?.handle ?? "已离开的成员";
  return {
    id: message.messageId,
    channelId: message.roomId,
    seq: message.roomSeq,
    senderId: message.actorId,
    senderType: author?.kind === "agent" ? "agent" : "user",
    senderName: name,
    senderDisplayName: name,
    content: [
      message.body,
      message.attachments?.length
        ? `（此消息含 ${message.attachments.length} 个附件；附件预览尚未接入。）`
        : "",
      message.forwardedBundle ? "（此消息含转发内容；转发预览尚未接入。）" : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    createdAt: message.createdAt,
  };
}

export async function loadChannelDirectory(client: RahClient) {
  const [identity, directory] = await Promise.all([
    client.request("principal.me", {}),
    client.request("workspace.list", {}),
  ]);
  const workspace = directory.workspaces.find(
    (item) => item.state === "active",
  );
  if (!workspace) throw new Error("没有可用的工作区");
  const { rooms } = await client.request("room.list", {
    workspaceId: workspace.workspaceId,
  });
  return {
    principal: identity.principal,
    workspace,
    channels: rooms.filter(
      (room) => room.kind === "channel" && !room.archivedAt,
    ),
  };
}

/** A view delegates its only cursors and mutation barriers to existing client-core owners. */
export class LoomChannelClient {
  readonly writes = new WriteIntentSlot();
  readonly room: RoomSession;
  readonly messages: MessageSession;
  readonly client: RahClient;
  readonly roomId: string;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(client: RahClient, roomId: string, consumerId: string) {
    this.client = client;
    this.roomId = roomId;
    this.room = new RoomSession({ client, roomId, consumerId });
    this.messages = new MessageSession({ client, roomId });
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }
  refresh() {
    return this.serial(async () => {
      await this.room.syncUntilCurrent({ maxPages: 10 });
      await this.messages.syncUntilCurrent({ limit: 50, maxPages: 2 });
      return this.view();
    });
  }
  older() {
    return this.serial(async () => {
      await this.messages.loadEarlier({ limit: 50 });
      return this.view();
    });
  }
  view(): {
    room: Room | null;
    messages: OfficialMessage[];
    hasOlder: boolean;
  } {
    return {
      room: this.room.state.snapshot?.room ?? null,
      messages: this.messages.state.messages.map((message) =>
        toOfficialMessage(message, this.room.state.snapshot?.members ?? []),
      ),
      hasOlder: this.messages.state.hasEarlier,
    };
  }
  send(
    body: string,
    onSettled?: (result: IntentOutcome<ClientMessageMutationResponse>) => void,
  ) {
    return this.writes.submit({
      action: "message",
      payload: { body },
      session: this.room,
      ...(onSettled ? { onSettled } : {}),
      send: (payload, basedOnRoomSeq, idempotencyKey) =>
        this.client.request("message.post", {
          roomId: this.roomId,
          body: payload.body,
          basedOnRoomSeq,
          idempotencyKey,
          recipients: [],
        }),
    });
  }
}
