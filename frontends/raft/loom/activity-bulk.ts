import type { HumanActivityMarkRequest } from "@rah-os/protocol";
type Page = {
  items: {
    key: string;
    roomId: string;
    threadId?: string;
    latestSeq: number;
  }[];
  total: number;
  nextCursor?: string;
};
/** Capture bounded durable frontiers before the first write. New arrivals stay unread. */
export async function captureUnreadActivity(
  read: (cursor?: string) => Promise<Page>,
): Promise<HumanActivityMarkRequest[]> {
  const seen = new Set<string>();
  const targets = new Map<string, HumanActivityMarkRequest>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const result = await read(cursor);
    for (const row of result.items)
      if (!targets.has(row.key))
        targets.set(row.key, {
          roomId: row.roomId,
          ...(row.threadId ? { threadId: row.threadId } : {}),
          throughSeq: row.latestSeq,
          action: "read",
        });
    if (!result.nextCursor) return [...targets.values()];
    if (seen.has(result.nextCursor)) break;
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw Error("未能完整读取未读动态，请刷新后重试；尚未修改已读状态。");
}
