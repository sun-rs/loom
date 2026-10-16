import { RoomSession } from "@rah-os/client-core";
import { WriteIntentSlot } from "@rah-os/client-core/write-intent";
import type { RahClient } from "@rah-os/client-sdk";
import type { AttachmentCommentPostRequest } from "@rah-os/protocol";
/** Existing RoomSession and write-intent owners; no optimistic comments or new message ledger. */
export class AttachmentCommentsClient {
  readonly room: RoomSession;
  readonly writes = new WriteIntentSlot();
  constructor(
    readonly client: RahClient,
    readonly roomId: string,
    readonly messageId: string,
    readonly attachmentId: string,
  ) {
    this.room = new RoomSession({
      client,
      roomId,
      consumerId: `loom-attachment:${attachmentId}`,
    });
  }
  async read(signal?: AbortSignal, beforeRoomSeq?: number) {
    const result = await this.client.request(
      "file.comments",
      {
        attachmentId: this.attachmentId,
        limit: 50,
        ...(beforeRoomSeq ? { beforeRoomSeq } : {}),
      },
      { signal },
    );
    if (result.roomId !== this.roomId || result.messageId !== this.messageId)
      throw Error("附件批注不属于此消息");
    await this.room.syncUntilCurrent({ signal, maxPages: 10 });
    return result;
  }
  send(
    body: string,
    anchor: AttachmentCommentPostRequest["anchor"],
    recipientIds: string[],
  ) {
    return new Promise<void>((resolve, reject) => {
      void this.writes
        .submit({
          action: "attachment-comment",
          session: this.room,
          payload: {
            attachmentId: this.attachmentId,
            body,
            anchor,
            recipientIds,
          },
          send: (payload, basedOnRoomSeq, idempotencyKey) =>
            this.client.request("file.comment", {
              ...payload,
              basedOnRoomSeq,
              idempotencyKey,
            }),
          onSettled: (outcome) => {
            if (outcome.kind === "ok") resolve();
            else if (outcome.kind === "rejected") reject(outcome.error);
          },
        })
        .then((outcome) => {
          if (outcome.kind === "busy") reject(Error("仍有未决批注"));
        })
        .catch(reject);
    });
  }
}
