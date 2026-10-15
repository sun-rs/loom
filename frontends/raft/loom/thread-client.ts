import { MessageSession, RoomSession } from "@rah-os/client-core";
import {
  WriteIntentSlot,
  type IntentOutcome,
} from "@rah-os/client-core/write-intent";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  Message,
  Thread,
  ClientThreadCreateResponse,
} from "@rah-os/protocol";

/** Thread metadata is Kernel-owned; MessageSession owns bounded reply cursors. */
export class LoomThreadClient {
  readonly writes = new WriteIntentSlot();
  readonly room: RoomSession;
  private thread?: Thread;
  private messages?: MessageSession;
  private parent?: Message;
  private reading: Promise<unknown> = Promise.resolve();
  private sending = false;
  readonly client: RahClient;
  readonly roomId: string;
  readonly rootMessageId: string;
  constructor(client: RahClient, roomId: string, rootMessageId: string) {
    this.client = client;
    this.roomId = roomId;
    this.rootMessageId = rootMessageId;
    this.room = new RoomSession({
      client,
      roomId,
      consumerId: `loom-thread:${rootMessageId}`,
    });
  }
  private bind(thread: Thread) {
    if (
      thread.roomId !== this.roomId ||
      thread.rootMessageId !== this.rootMessageId
    )
      throw Error("消息列不属于此对话");
    if (this.thread && this.thread.threadId !== thread.threadId)
      throw Error("消息列身份发生变化，请重新打开");
    this.thread = thread;
    this.messages ??= new MessageSession({
      client: this.client,
      roomId: this.roomId,
      threadId: thread.threadId,
    });
  }
  private serial<T>(read: () => Promise<T>) {
    const result = this.reading.then(read, read);
    this.reading = result.catch(() => undefined);
    return result;
  }
  private focusId?: string;
  refresh(signal?: AbortSignal, focusId?: string) {
    return this.serial(async () => {
      const [context, catalog] = await Promise.all([
        this.client.request(
          "message.context",
          { roomId: this.roomId, messageId: this.rootMessageId },
          { signal },
        ),
        this.client.request("thread.list", { roomId: this.roomId }, { signal }),
        this.room.syncUntilCurrent({ maxPages: 10, signal }),
      ]);
      if (
        context.message.roomId !== this.roomId ||
        context.message.messageId !== this.rootMessageId ||
        context.message.threadId
      )
        throw Error("此消息不是所选对话的顶层消息");
      this.parent = context.message;
      const thread = catalog.threads.find(
        (t) => t.rootMessageId === this.rootMessageId,
      );
      if (thread) this.bind(thread);
      else if (this.thread) throw Error("消息列已不可用，请重新打开");
      if (!focusId && this.focusId && this.thread)
        this.messages = new MessageSession({
          client: this.client,
          roomId: this.roomId,
          threadId: this.thread.threadId,
        });
      if (this.messages && focusId && focusId !== this.focusId)
        await this.messages.focus(focusId, signal);
      else if (this.messages && (!focusId || this.messages.state.complete))
        await this.messages.syncUntilCurrent({
          limit: 50,
          maxPages: 2,
          signal,
        });
      this.focusId = focusId;
      return this.view();
    });
  }
  newer() {
    return this.serial(async () => {
      await this.messages?.syncUntilCurrent({ limit: 50, maxPages: 1 });
      return this.view();
    });
  }
  older() {
    return this.serial(async () => {
      await this.messages?.loadEarlier({ limit: 50 });
      return this.view();
    });
  }
  view() {
    return {
      parent: this.parent,
      thread: this.thread,
      members: this.room.state.snapshot?.members ?? [],
      room: this.room.state.snapshot?.room,
      messages: this.messages?.state.messages ?? [],
      hasOlder: this.messages?.state.hasEarlier ?? false,
      hasNewer: this.messages ? !this.messages.state.complete : false,
    };
  }
  async send(body: string, attachmentIds: string[] = []) {
    if (this.sending || this.writes.state !== "idle")
      throw Error("仍有未决回复");
    if (!this.parent) throw Error("请先读取消息列");
    this.sending = true;
    try {
      // Keep the composer's original send promise pending across unknown results.
      // Explicit verification settles that same intent; it never submits the body twice.
      if (!this.thread) {
        const result = await this.untilKnown<ClientThreadCreateResponse>(
          (done) =>
            this.writes.submit({
              action: "thread-create",
              session: this.room,
              payload: { rootMessageId: this.rootMessageId },
              send: (p, basedOnRoomSeq, idempotencyKey) =>
                this.client.request("thread.create", {
                  ...p,
                  roomId: this.roomId,
                  recipientIds: [],
                  basedOnRoomSeq,
                  idempotencyKey,
                }),
              onSettled: done,
            }),
        );
        this.bind(result.thread);
      }
      const threadId = this.thread!.threadId;
      await this.untilKnown((done) =>
        this.writes.submit({
          action: "thread-reply",
          session: this.room,
          payload: {
            threadId,
            body,
            ...(attachmentIds.length
              ? { attachmentIds: [...attachmentIds] }
              : {}),
          },
          send: (p, basedOnRoomSeq, idempotencyKey) =>
            this.client.request("thread.reply", {
              ...p,
              roomId: this.roomId,
              recipientIds: [],
              basedOnRoomSeq,
              idempotencyKey,
            }),
          onSettled: done,
        }),
      );
    } finally {
      this.sending = false;
    }
  }
  private untilKnown<T>(
    start: (done: (o: IntentOutcome<T>) => void) => Promise<unknown>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      void start((o) => {
        if (o.kind === "ok") resolve(o.result);
        else if (o.kind === "rejected") reject(o.error);
      }).catch(reject);
    });
  }
}
