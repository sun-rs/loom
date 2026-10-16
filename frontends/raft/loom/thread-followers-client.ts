import type { RahClient } from "@rah-os/client-sdk";
/** Existing authenticated Human endpoints. No retry: lost remove also loses its undo receipt. */
export class ThreadFollowersClient {
  readonly client: RahClient;
  readonly roomId: string;
  readonly threadId: string;
  constructor(client: RahClient, roomId: string, threadId: string) {
    this.client = client;
    this.roomId = roomId;
    this.threadId = threadId;
  }
  read(signal?: AbortSignal) {
    return this.client.request(
      "thread.followers",
      { roomId: this.roomId, threadId: this.threadId },
      { signal },
    );
  }
  remove(participantId: string) {
    return this.client.request("thread.follower.remove", {
      roomId: this.roomId,
      threadId: this.threadId,
      participantId,
    });
  }
  async restore(participantId: string, undoToken: string) {
    const result = await this.client.request("thread.follower.restore", {
      roomId: this.roomId,
      threadId: this.threadId,
      participantId,
      undoToken,
    });
    return result.restored;
  }
}
