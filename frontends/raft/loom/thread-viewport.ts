import type { Message } from "@rah-os/protocol";
import { visibleThreadFrontier } from "./thread-activity.ts";
/** Shared capture for viewport read and explicit unfollow. Virtualized overscan,
 * fetched-but-unrendered replies and the parent message are not visible evidence. */
export function captureThreadViewportFrontier(
  host: HTMLElement | null,
  messages: readonly Message[],
  roomId: string,
  threadId: string,
) {
  if (!host || document.hidden) return 0;
  const scroller = host.querySelector(
    '[data-testid="thread-message-scroller"]',
  );
  if (!scroller) return 0;
  const bounds = scroller.getBoundingClientRect();
  const top = Math.max(bounds.top, 0),
    bottom = Math.min(bounds.bottom, innerHeight);
  const ids = Array.from(
    scroller.querySelectorAll<HTMLElement>("[data-timeline-message-id]"),
  )
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return (
        bottom > top &&
        rect.height > 0 &&
        rect.bottom > top &&
        rect.top < bottom &&
        rect.right > 0 &&
        rect.left < innerWidth
      );
    })
    .map((node) => node.dataset.timelineMessageId!);
  return visibleThreadFrontier(messages, ids, roomId, threadId);
}
