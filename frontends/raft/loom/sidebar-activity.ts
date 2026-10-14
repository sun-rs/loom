import type { RahClient } from "@rah-os/client-sdk";
/** Bounded native message lookup: thread messages do not advance the channel read frontier. */
export async function markChannelActivity(
  client: RahClient,
  roomId: string,
  action: "read" | "unread",
) {
  let throughSeq = 0;
  if (action === "unread") {
    let beforeSeq: number | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await client.request("message.list", {
        roomId,
        limit: 100,
        ...(beforeSeq ? { beforeSeq } : {}),
      });
      const latest = result.messages.filter((m) => !m.threadId).at(-1);
      if (latest) {
        throughSeq = latest.roomSeq;
        break;
      }
      if (!result.hasMoreBefore) break;
      if (page === 9) throw new Error("频道最新消息尚未定位，未修改未读状态。");
      beforeSeq = result.cursorBefore;
    }
  }
  // No idempotency key is supported. Never replay after a lost result.
  return client.request("activity.mark", {
    roomId,
    action,
    throughSeq,
    source: "channel-list",
  });
}
