import { projectChannelMembers } from "./channel-members.ts";
import { RoomTimelineSession, RoomSession } from "@rah-os/client-core";
import {
  WriteIntentSlot,
  type IntentOutcome,
} from "@rah-os/client-core/write-intent";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  Message,
  Thread,
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
      message.forwardedBundle ? "（此消息含转发内容；转发预览尚未接入。）" : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    attachments: message.attachments?.map((a) => ({
      id: a.attachmentId,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.size,
    })),
    // Kernel bindings retain identity across renamed/re-created display names.
    // The native renderer resolves current labels by ID, not by current handle.
    mentions: message.mentions?.map((mention) => ({
      type: mention.agentId ? "agent" : "user",
      id: mention.principalId,
      name: mention.handle,
    })),
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
    privateBoxes: rooms.filter(
      (room) =>
        room.kind === "direct" &&
        room.instancePrivateBox !== undefined &&
        room.side === undefined,
    ),
    principal: identity.principal,
    workspace,
    archivedChannels: rooms.filter(
      (room) => room.kind === "channel" && Boolean(room.archivedAt),
    ),
    channels: rooms.filter(
      (room) => room.kind === "channel" && !room.archivedAt,
    ),
  };
}

/** A view delegates its only cursors and mutation barriers to existing client-core owners. */
export class LoomChannelClient {
  readonly writes = new WriteIntentSlot();
  readonly room: RoomSession;
  messages: RoomTimelineSession;
  readonly client: RahClient;
  readonly roomId: string;
  private threads: Thread[] = [];
  private directRoom: Room | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(client: RahClient, roomId: string, consumerId: string) {
    this.client = client;
    this.roomId = roomId;
    this.room = new RoomSession({ client, roomId, consumerId });
    this.messages = new RoomTimelineSession(client, roomId);
  }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private focusId?: string;
  refresh(focusId?: string) {
    return this.serial(async () => {
      await this.room.syncUntilCurrent({ maxPages: 10 });
      if (!focusId && this.focusId)
        this.messages = new RoomTimelineSession(this.client, this.roomId);
      if (focusId && focusId !== this.focusId)
        await this.messages.focus(focusId);
      else
        await this.messages.refresh({
          latestRoomSeq: this.room.state.latestRoomSeq,
        });
      this.focusId = focusId;
      this.threads = (
        await this.client.request("thread.list", { roomId: this.roomId })
      ).threads;
      const room = this.room.state.snapshot?.room;
      if (room?.kind === "direct") {
        // The sync snapshot owns history; room.list owns current private-box availability.
        const directory = await this.client.request("room.list", {
          workspaceId: room.workspaceId,
        });
        this.directRoom =
          directory.rooms.find((item) => item.roomId === this.roomId) ?? null;
        if (!this.directRoom) throw new Error("此私聊已不可访问");
      }
      return this.view();
    });
  }
  members(signal?: AbortSignal) {
    return this.serial(async () => {
      await this.room.syncUntilCurrent({ maxPages: 10, signal });
      const activity = await this.client.request(
        "room.agent.activity.list",
        { roomId: this.roomId },
        { signal },
      );
      return projectChannelMembers(
        this.roomId,
        this.room.state.snapshot?.members ?? [],
        activity.agents,
      );
    });
  }
  newer() {
    return this.serial(async () => {
      await this.messages.syncUntilCurrent({ limit: 50, maxPages: 1 });
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
    members: readonly Principal[];
    messages: OfficialMessage[];
    hasOlder: boolean;
    hasNewer: boolean;
    threads: readonly Thread[];
  } {
    return {
      hasNewer: !this.messages.state.complete,
      threads: this.threads,
      members: this.room.state.snapshot?.members ?? [],
      room:
        this.room.state.snapshot?.room.kind === "direct"
          ? this.directRoom
          : (this.room.state.snapshot?.room ?? null),
      messages: this.messages.state.items.map((item) =>
        item.kind === "message"
          ? toOfficialMessage(
              item.message,
              this.room.state.snapshot?.members ?? [],
            )
          : {
              id: `event:${item.notice.eventId}`,
              channelId: item.notice.roomId,
              seq: item.notice.roomSeq,
              senderId: "system",
              senderType: "user",
              messageType: "system",
              content: item.notice.text,
              createdAt: item.notice.createdAt,
            },
      ),
      hasOlder: this.messages.state.hasEarlier,
    };
  }
  send(
    body: string,
    onSettled?: (result: IntentOutcome<ClientMessageMutationResponse>) => void,
    attachmentIds: string[] = [],
  ) {
    return this.writes.submit({
      action: "message",
      payload: { body, attachmentIds: [...attachmentIds] },
      session: this.room,
      ...(onSettled ? { onSettled } : {}),
      send: (payload, basedOnRoomSeq, idempotencyKey) =>
        this.client.request("message.post", {
          roomId: this.roomId,
          body: payload.body,
          ...(payload.attachmentIds.length
            ? { attachmentIds: payload.attachmentIds }
            : {}),
          basedOnRoomSeq,
          idempotencyKey,
          recipients: [],
        }),
    });
  }
}
