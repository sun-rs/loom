/** Loom route binding for Web 1.21.34's conversation-scoped search. */
export function scopedSearchLabel(
  roomId: string,
  catalog: readonly {
    channelId?: string | null;
    type: string;
    title: string;
  }[],
): string {
  const entity = catalog.find((row) => row.channelId === roomId);
  return entity
    ? `${entity.type === "channel" ? "#" : "@"}${entity.title.replace(/^[@#]/, "")}`
    : "此对话";
}
export function searchEverywhereParams(
  previous: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(previous);
  for (const key of [
    "channelId",
    "senderId",
    "scope",
    "scopes",
    "range",
    "sort",
    "room",
    "thread",
    "message",
    "detail",
  ])
    next.delete(key);
  next.set("presentation", "page");
  return next;
}
export function isScopedSearchIdle(
  roomId: string | undefined,
  query: string,
  filters: {
    senderIds?: readonly string[];
    senderKind?: unknown;
    mentionSelf?: boolean;
    after?: unknown;
  },
): boolean {
  return (
    !!roomId &&
    !query.trim() &&
    !filters.senderIds?.length &&
    !filters.senderKind &&
    !filters.mentionSelf &&
    !filters.after
  );
}
