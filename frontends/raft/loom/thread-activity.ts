import type { RahClient } from "@rah-os/client-sdk";
import type { Message } from "@rah-os/protocol";

export function visibleThreadFrontier(
  messages: Message[],
  visibleIds: string[],
  roomId: string,
  threadId: string,
) {
  const ids = new Set(visibleIds);
  return messages.reduce(
    (seq, m) =>
      m.roomId === roomId && m.threadId === threadId && ids.has(m.messageId)
        ? Math.max(seq, m.roomSeq)
        : seq,
    0,
  );
}
/** Human follow/read projections belong to Kernel. No write retries: these APIs have no idempotency keys. */
export class ThreadActivityClient {
  readonly client: RahClient;
  readonly roomId: string;
  readonly threadId: string;
  following: boolean | undefined;
  private busy = false;
  private attemptedRead = 0;
  constructor(client: RahClient, roomId: string, threadId: string) {
    this.client = client;
    this.roomId = roomId;
    this.threadId = threadId;
  }
  async refresh(signal?: AbortSignal) {
    try {
      const result = await this.client.request(
        "thread.followers",
        { roomId: this.roomId, threadId: this.threadId },
        { signal },
      );
      this.following = result.following;
      return result;
    } catch (error) {
      this.following = undefined;
      throw error;
    }
  }
  async follow(following: boolean) {
    if (this.busy || this.following === undefined)
      throw Error("请先重新读取关注状态");
    if (this.following === following) return;
    this.busy = true;
    try {
      try {
        const result = await this.client.request("activity.follow", {
          roomId: this.roomId,
          threadId: this.threadId,
          following,
        });
        this.following = result.following;
      } catch {
        await this.refresh();
      }
    } finally {
      this.busy = false;
    }
  }
  async markVisible(throughSeq: number) {
    if (throughSeq <= this.attemptedRead) return;
    this.attemptedRead = throughSeq;
    await this.client.request("activity.mark", {
      roomId: this.roomId,
      threadId: this.threadId,
      action: "read",
      source: "viewport",
      throughSeq,
    });
  }
}
