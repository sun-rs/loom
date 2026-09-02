import type { MessageSession } from "@rah-os/client-core";

type ThreadHistorySession = Pick<MessageSession, "loadEarlier" | "state">;

export async function loadThreadHistoryPages(
  session: ThreadHistorySession,
  options: { limit: number },
) {
  let result = session.state;
  let pages = 0;
  if (result.hasEarlier) {
    result = await session.loadEarlier({ limit: options.limit });
    pages += 1;
  }
  return { hasEarlier: result.hasEarlier, messages: result.messages, pages };
}
