/** Local navigation target only. It confers no permission and contains no provider/session IDs. */
export function localMessagePermalink(
  origin: string,
  roomId: string,
  messageId: string,
  rootMessageId?: string | null,
) {
  const url = new URL("/", origin);
  url.searchParams.set("room", roomId);
  url.searchParams.set("message", messageId);
  if (rootMessageId) url.searchParams.set("thread", rootMessageId);
  return url.href;
}
